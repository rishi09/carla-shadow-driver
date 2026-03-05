#!/usr/bin/env python3
"""
grader.py - Automated visual quality grading for Shadow Driver gameplay screenshots.

Takes a directory of gameplay screenshots (PNG/JPEG) and produces a structured
quality report without requiring a running game server or browser.

Checks performed:
  1. Black frame detection     (mean pixel value < threshold)
  2. Frozen frame detection    (SSIM > 0.99 between consecutive frames)
  3. HUD element detection     (speedometer region has content above noise floor)
  4. Visual quality scoring    (sharpness via Laplacian variance, colorfulness,
                                contrast, brightness -- all no-reference metrics)

Dependencies:
  Required:  numpy, Pillow        (pip install numpy Pillow)
  Optional:  opencv-python        (pip install opencv-python)  -- enables SSIM

Usage:
  python3 grader.py /path/to/screenshots/                     # grade a directory
  python3 grader.py /path/to/screenshots/ --json              # JSON output only
  python3 grader.py /path/to/screenshots/ --html report.html  # HTML report
  python3 grader.py screenshot_001.png                        # grade a single file

Exit codes:
  0 = PASS  (quality_score >= 50, no critical failures)
  1 = FAIL  (quality_score < 50, or >50% black/frozen frames)
  2 = ERROR (bad input, missing files)
"""

import argparse
import json
import math
import os
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Optional

import numpy as np
from PIL import Image

# ---------------------------------------------------------------------------
# Optional OpenCV import (for SSIM)
# ---------------------------------------------------------------------------
try:
    import cv2
    CV2_AVAILABLE = True
except ImportError:
    CV2_AVAILABLE = False

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Black frame detection
BLACK_MEAN_THRESHOLD = 10       # mean pixel value below this = black frame
BLACK_NONBLACK_RATIO = 0.03    # fraction of pixels > 10 required to be non-black

# Frozen frame detection (SSIM threshold)
FROZEN_SSIM_THRESHOLD = 0.99   # SSIM > this between consecutive = frozen
# Fallback when no opencv: use normalized MAE
FROZEN_MAE_THRESHOLD = 1.5     # mean absolute pixel diff < this = frozen

# HUD detection regions (as fraction of image dimensions)
# These regions are where we expect HUD elements in Shadow Driver v3
HUD_REGIONS = {
    # Speedometer: bottom-left area (ArcSpeedometer component)
    "speedometer": {"x1": 0.02, "y1": 0.70, "x2": 0.18, "y2": 0.98},
    # Gap timer / lap info: top center
    "top_bar": {"x1": 0.30, "y1": 0.01, "x2": 0.70, "y2": 0.08},
    # Minimap: bottom-right corner
    "minimap": {"x1": 0.80, "y1": 0.70, "x2": 0.99, "y2": 0.99},
}

# Minimum edge density (Sobel magnitude) in a HUD region to consider it "has content"
HUD_EDGE_THRESHOLD = 15.0

# Quality scoring weights
QUALITY_WEIGHTS = {
    "sharpness": 0.30,     # Laplacian variance (higher = sharper)
    "colorfulness": 0.25,  # Hasler-Suesstrunk colorfulness metric
    "contrast": 0.20,      # RMS contrast
    "brightness": 0.15,    # Penalize too dark or too bright
    "saturation": 0.10,    # Color saturation
}


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class FrameGrade:
    """Quality assessment for a single screenshot."""
    filename: str
    is_black: bool = False
    is_frozen: bool = False            # relative to previous frame
    hud_visible: dict = field(default_factory=dict)  # region -> bool
    sharpness: float = 0.0             # Laplacian variance
    colorfulness: float = 0.0          # Hasler-Suesstrunk metric
    contrast: float = 0.0             # RMS contrast
    brightness: float = 0.0           # mean luminance (0-255)
    saturation: float = 0.0           # mean saturation (0-255)
    quality_score: float = 0.0        # composite 0-100
    notes: list = field(default_factory=list)


@dataclass
class GradeReport:
    """Aggregate grading report for a set of screenshots."""
    directory: str
    total_frames: int = 0
    black_frames: int = 0
    frozen_frames: int = 0
    hud_visible_counts: dict = field(default_factory=dict)
    avg_quality_score: float = 0.0
    min_quality_score: float = 0.0
    max_quality_score: float = 0.0
    avg_sharpness: float = 0.0
    avg_colorfulness: float = 0.0
    avg_contrast: float = 0.0
    verdict: str = "UNKNOWN"           # PASS / FAIL / DEGRADED
    frames: list = field(default_factory=list)
    notes: list = field(default_factory=list)


# ---------------------------------------------------------------------------
# Image metrics (no-reference, numpy/Pillow only)
# ---------------------------------------------------------------------------

def compute_sharpness(gray_np: np.ndarray) -> float:
    """
    Sharpness via Laplacian variance.

    The Laplacian highlights edges. The variance of the Laplacian response
    correlates with image sharpness: blurry images have low variance (few
    strong edges), sharp images have high variance.

    Uses a 3x3 Laplacian kernel convolved via numpy (no opencv needed).
    Returns the variance of the Laplacian response (typical range 0-5000+
    for game screenshots).
    """
    if CV2_AVAILABLE:
        lap = cv2.Laplacian(gray_np, cv2.CV_64F)
        return float(lap.var())

    # Pure numpy fallback: convolve with Laplacian kernel
    # Kernel: [[0, 1, 0], [1, -4, 1], [0, 1, 0]]
    h, w = gray_np.shape
    if h < 3 or w < 3:
        return 0.0
    img = gray_np.astype(np.float64)
    # Pad to handle borders
    padded = np.pad(img, 1, mode='edge')
    lap = (padded[0:-2, 1:-1] + padded[2:, 1:-1] +
           padded[1:-1, 0:-2] + padded[1:-1, 2:] -
           4 * padded[1:-1, 1:-1])
    return float(np.var(lap))


def compute_colorfulness(rgb_np: np.ndarray) -> float:
    """
    Colorfulness metric from Hasler & Suesstrunk (2003).

    Measures how vivid/colorful an image is. Grayscale images score ~0,
    highly saturated images score 100+.

    Formula:
      rg = R - G
      yb = 0.5*(R + G) - B
      colorfulness = sqrt(sigma_rg^2 + sigma_yb^2) + 0.3 * sqrt(mu_rg^2 + mu_yb^2)
    """
    R = rgb_np[:, :, 0].astype(np.float64)
    G = rgb_np[:, :, 1].astype(np.float64)
    B = rgb_np[:, :, 2].astype(np.float64)

    rg = R - G
    yb = 0.5 * (R + G) - B

    sigma_rg = np.std(rg)
    sigma_yb = np.std(yb)
    mu_rg = np.mean(rg)
    mu_yb = np.mean(yb)

    colorfulness = math.sqrt(sigma_rg ** 2 + sigma_yb ** 2) + 0.3 * math.sqrt(mu_rg ** 2 + mu_yb ** 2)
    return float(colorfulness)


def compute_contrast(gray_np: np.ndarray) -> float:
    """
    RMS contrast: standard deviation of pixel intensities.
    Typical range: 0-80 for game screenshots.
    """
    return float(np.std(gray_np.astype(np.float64)))


def compute_brightness(gray_np: np.ndarray) -> float:
    """Mean luminance (0-255)."""
    return float(np.mean(gray_np))


def compute_saturation(rgb_np: np.ndarray) -> float:
    """
    Mean saturation from the HSV color space.
    Uses Pillow for the conversion (no opencv needed).
    """
    img = Image.fromarray(rgb_np)
    hsv = img.convert("HSV")
    hsv_np = np.array(hsv)
    return float(np.mean(hsv_np[:, :, 1]))


# ---------------------------------------------------------------------------
# SSIM (Structural Similarity Index)
# ---------------------------------------------------------------------------

def compute_ssim(gray1: np.ndarray, gray2: np.ndarray) -> float:
    """
    Compute SSIM between two grayscale images.

    Uses opencv if available (fast, correct windowed SSIM).
    Falls back to simplified global SSIM via numpy.
    """
    if gray1.shape != gray2.shape:
        # Resize to match (can happen with different browser window sizes)
        h = min(gray1.shape[0], gray2.shape[0])
        w = min(gray1.shape[1], gray2.shape[1])
        gray1 = gray1[:h, :w]
        gray2 = gray2[:h, :w]

    if CV2_AVAILABLE:
        # Full mean SSIM with default 11x11 Gaussian window
        try:
            (score, _) = cv2.quality.QualitySSIM.compute(gray1, gray2)
            return float(score[0])
        except AttributeError:
            pass  # cv2.quality module may not be available

    # Numpy fallback: global SSIM (simplified, no windowing)
    # SSIM = (2*mu1*mu2 + C1)(2*sigma12 + C2) / ((mu1^2 + mu2^2 + C1)(sigma1^2 + sigma2^2 + C2))
    img1 = gray1.astype(np.float64)
    img2 = gray2.astype(np.float64)

    C1 = (0.01 * 255) ** 2
    C2 = (0.03 * 255) ** 2

    mu1 = np.mean(img1)
    mu2 = np.mean(img2)
    sigma1_sq = np.var(img1)
    sigma2_sq = np.var(img2)
    sigma12 = np.mean((img1 - mu1) * (img2 - mu2))

    ssim = ((2 * mu1 * mu2 + C1) * (2 * sigma12 + C2)) / \
           ((mu1 ** 2 + mu2 ** 2 + C1) * (sigma1_sq + sigma2_sq + C2))
    return float(ssim)


def compute_mae(gray1: np.ndarray, gray2: np.ndarray) -> float:
    """Mean absolute error between two grayscale images."""
    if gray1.shape != gray2.shape:
        h = min(gray1.shape[0], gray2.shape[0])
        w = min(gray1.shape[1], gray2.shape[1])
        gray1 = gray1[:h, :w]
        gray2 = gray2[:h, :w]
    return float(np.mean(np.abs(gray1.astype(np.float64) - gray2.astype(np.float64))))


# ---------------------------------------------------------------------------
# HUD detection
# ---------------------------------------------------------------------------

def detect_hud_region(gray_np: np.ndarray, region: dict) -> bool:
    """
    Check if a HUD region has meaningful content (not empty/transparent).

    Method: compute edge density via Sobel-like gradient magnitude.
    HUD elements (text, gauges, borders) produce strong edges.
    Empty/transparent areas have low edge density.

    region: dict with x1, y1, x2, y2 as fractions of image dimensions.
    Returns True if the region appears to contain HUD content.
    """
    h, w = gray_np.shape
    y1 = int(region["y1"] * h)
    y2 = int(region["y2"] * h)
    x1 = int(region["x1"] * w)
    x2 = int(region["x2"] * w)

    crop = gray_np[y1:y2, x1:x2].astype(np.float64)
    if crop.size == 0:
        return False

    # Compute gradient magnitude using simple Sobel-like differences
    if crop.shape[0] < 3 or crop.shape[1] < 3:
        return False

    # Horizontal gradient
    gx = crop[:, 2:] - crop[:, :-2]
    # Vertical gradient
    gy = crop[2:, :] - crop[:-2, :]

    # Trim to matching size
    min_h = min(gx.shape[0], gy.shape[0])
    min_w = min(gx.shape[1], gy.shape[1])
    gx = gx[:min_h, :min_w]
    gy = gy[:min_h, :min_w]

    magnitude = np.sqrt(gx ** 2 + gy ** 2)
    edge_density = np.mean(magnitude)

    return edge_density > HUD_EDGE_THRESHOLD


# ---------------------------------------------------------------------------
# Composite quality score
# ---------------------------------------------------------------------------

def compute_quality_score(sharpness: float, colorfulness: float,
                          contrast: float, brightness: float,
                          saturation: float) -> float:
    """
    Compute a composite quality score (0-100) from individual metrics.

    Each metric is normalized to a 0-100 scale based on empirical ranges
    from typical game screenshots, then combined with weights.

    Scoring philosophy:
    - A normal game screenshot with clear video, visible HUD, and decent
      visual quality should score 60-80.
    - A black screen scores near 0.
    - A screenshot with compression artifacts or blur scores 30-50.
    - An excellent, sharp, colorful screenshot scores 80-100.
    """
    # Normalize each metric to 0-100
    # Sharpness: typical range 50-3000+ for game screenshots
    #   < 50 = very blurry, > 2000 = very sharp
    sharpness_norm = min(100, max(0, (sharpness - 20) / 20)) * 100
    sharpness_norm = min(100, sharpness_norm)

    # Colorfulness: typical range 0-100+ for game screenshots
    #   < 10 = nearly grayscale, > 60 = very colorful
    colorfulness_norm = min(100, max(0, colorfulness / 0.8))

    # Contrast: typical range 10-80
    #   < 15 = very low contrast, > 60 = high contrast
    contrast_norm = min(100, max(0, (contrast - 5) / 0.6))

    # Brightness: penalize too dark (<30) or too bright (>230)
    #   Ideal range: 60-180
    if brightness < 30:
        brightness_norm = brightness / 30 * 50
    elif brightness > 230:
        brightness_norm = (255 - brightness) / 25 * 50
    else:
        # Map 30-180 to 50-100, 180-230 to 100-50
        if brightness <= 180:
            brightness_norm = 50 + (brightness - 30) / 150 * 50
        else:
            brightness_norm = 100 - (brightness - 180) / 50 * 50
    brightness_norm = max(0, min(100, brightness_norm))

    # Saturation: typical range 20-120
    saturation_norm = min(100, max(0, saturation / 1.2))

    # Weighted combination
    score = (
        QUALITY_WEIGHTS["sharpness"] * sharpness_norm +
        QUALITY_WEIGHTS["colorfulness"] * colorfulness_norm +
        QUALITY_WEIGHTS["contrast"] * contrast_norm +
        QUALITY_WEIGHTS["brightness"] * brightness_norm +
        QUALITY_WEIGHTS["saturation"] * saturation_norm
    )

    return round(max(0, min(100, score)), 1)


# ---------------------------------------------------------------------------
# Single frame grading
# ---------------------------------------------------------------------------

def grade_frame(filepath: str, prev_gray: Optional[np.ndarray] = None) -> tuple[FrameGrade, np.ndarray]:
    """
    Grade a single screenshot.

    Args:
        filepath: path to PNG/JPEG screenshot
        prev_gray: grayscale numpy array of the previous frame (for frozen detection)

    Returns:
        (FrameGrade, gray_np) where gray_np can be passed as prev_gray to the next call
    """
    grade = FrameGrade(filename=os.path.basename(filepath))

    try:
        img = Image.open(filepath).convert("RGB")
    except Exception as e:
        grade.notes.append(f"Failed to open: {e}")
        grade.is_black = True
        return grade, np.zeros((1, 1), dtype=np.uint8)

    rgb_np = np.array(img)
    gray_np = np.array(img.convert("L"))

    # --- Black frame detection ---
    mean_val = float(np.mean(gray_np))
    non_black_count = np.sum(gray_np > 10)
    non_black_ratio = non_black_count / gray_np.size

    if mean_val < BLACK_MEAN_THRESHOLD or non_black_ratio < BLACK_NONBLACK_RATIO:
        grade.is_black = True
        grade.notes.append(f"Black frame (mean={mean_val:.1f}, non_black={non_black_ratio:.3f})")

    # --- Frozen frame detection ---
    if prev_gray is not None and not grade.is_black:
        if CV2_AVAILABLE or True:  # Always try SSIM first, fallback to MAE
            ssim = compute_ssim(gray_np, prev_gray)
            if ssim > FROZEN_SSIM_THRESHOLD:
                grade.is_frozen = True
                grade.notes.append(f"Frozen frame (SSIM={ssim:.4f})")
        else:
            mae = compute_mae(gray_np, prev_gray)
            if mae < FROZEN_MAE_THRESHOLD:
                grade.is_frozen = True
                grade.notes.append(f"Frozen frame (MAE={mae:.2f})")

    # --- HUD element detection ---
    for region_name, region_coords in HUD_REGIONS.items():
        visible = detect_hud_region(gray_np, region_coords)
        grade.hud_visible[region_name] = visible

    # --- Visual quality metrics ---
    grade.sharpness = compute_sharpness(gray_np)
    grade.colorfulness = compute_colorfulness(rgb_np)
    grade.contrast = compute_contrast(gray_np)
    grade.brightness = compute_brightness(gray_np)
    grade.saturation = compute_saturation(rgb_np)

    # --- Composite score ---
    grade.quality_score = compute_quality_score(
        grade.sharpness, grade.colorfulness,
        grade.contrast, grade.brightness, grade.saturation
    )

    # Penalize black/frozen frames
    if grade.is_black:
        grade.quality_score = 0.0
    elif grade.is_frozen:
        grade.quality_score = max(0, grade.quality_score - 30)
        grade.notes.append("Score penalized for frozen frame")

    return grade, gray_np


# ---------------------------------------------------------------------------
# Directory grading
# ---------------------------------------------------------------------------

def grade_directory(directory: str, pattern: str = "*.png") -> GradeReport:
    """
    Grade all screenshots in a directory.

    Supports PNG and JPEG. Files are sorted by name to ensure correct
    temporal ordering for frozen frame detection.

    Args:
        directory: path to screenshot directory
        pattern: glob pattern for screenshot files

    Returns:
        GradeReport with aggregate statistics
    """
    dir_path = Path(directory)
    if not dir_path.is_dir():
        # Maybe it's a single file
        if dir_path.is_file():
            return grade_single_file(str(dir_path))
        print(f"ERROR: {directory} is not a directory or file", file=sys.stderr)
        sys.exit(2)

    # Find all image files
    files = []
    for ext in ["*.png", "*.jpg", "*.jpeg"]:
        files.extend(sorted(dir_path.glob(ext)))

    if not files:
        print(f"ERROR: No image files found in {directory}", file=sys.stderr)
        sys.exit(2)

    report = GradeReport(directory=str(dir_path), total_frames=len(files))
    prev_gray = None

    for filepath in files:
        grade, gray_np = grade_frame(str(filepath), prev_gray)
        prev_gray = gray_np
        report.frames.append(grade)

        if grade.is_black:
            report.black_frames += 1
        if grade.is_frozen:
            report.frozen_frames += 1

        # Accumulate HUD visibility counts
        for region_name, visible in grade.hud_visible.items():
            if region_name not in report.hud_visible_counts:
                report.hud_visible_counts[region_name] = 0
            if visible:
                report.hud_visible_counts[region_name] += 1

    # Aggregate quality scores
    scores = [f.quality_score for f in report.frames]
    if scores:
        report.avg_quality_score = round(sum(scores) / len(scores), 1)
        report.min_quality_score = min(scores)
        report.max_quality_score = max(scores)

    sharpnesses = [f.sharpness for f in report.frames if not f.is_black]
    colorfulnesses = [f.colorfulness for f in report.frames if not f.is_black]
    contrasts = [f.contrast for f in report.frames if not f.is_black]
    if sharpnesses:
        report.avg_sharpness = round(sum(sharpnesses) / len(sharpnesses), 1)
    if colorfulnesses:
        report.avg_colorfulness = round(sum(colorfulnesses) / len(colorfulnesses), 1)
    if contrasts:
        report.avg_contrast = round(sum(contrasts) / len(contrasts), 1)

    # Determine verdict
    black_ratio = report.black_frames / report.total_frames if report.total_frames else 0
    frozen_ratio = report.frozen_frames / report.total_frames if report.total_frames else 0

    if black_ratio > 0.5:
        report.verdict = "FAIL"
        report.notes.append(f"CRITICAL: {report.black_frames}/{report.total_frames} frames are black")
    elif frozen_ratio > 0.5:
        report.verdict = "FAIL"
        report.notes.append(f"CRITICAL: {report.frozen_frames}/{report.total_frames} frames are frozen")
    elif report.avg_quality_score < 30:
        report.verdict = "FAIL"
        report.notes.append(f"Quality score {report.avg_quality_score} below threshold 30")
    elif report.avg_quality_score < 50:
        report.verdict = "DEGRADED"
        report.notes.append(f"Quality score {report.avg_quality_score} below ideal threshold 50")
    elif black_ratio > 0.1:
        report.verdict = "DEGRADED"
        report.notes.append(f"Warning: {report.black_frames} black frames detected")
    else:
        report.verdict = "PASS"

    # HUD visibility warnings
    for region_name, count in report.hud_visible_counts.items():
        non_black_frames = report.total_frames - report.black_frames
        if non_black_frames > 0 and count < non_black_frames * 0.3:
            report.notes.append(
                f"HUD '{region_name}' visible in only {count}/{non_black_frames} non-black frames"
            )

    return report


def grade_single_file(filepath: str) -> GradeReport:
    """Grade a single screenshot file."""
    grade, _ = grade_frame(filepath)
    report = GradeReport(
        directory=os.path.dirname(filepath),
        total_frames=1,
        black_frames=1 if grade.is_black else 0,
        frozen_frames=0,
        avg_quality_score=grade.quality_score,
        min_quality_score=grade.quality_score,
        max_quality_score=grade.quality_score,
        avg_sharpness=grade.sharpness,
        avg_colorfulness=grade.colorfulness,
        avg_contrast=grade.contrast,
        verdict="PASS" if grade.quality_score >= 50 else "FAIL",
        frames=[grade],
    )
    return report


# ---------------------------------------------------------------------------
# Output formatting
# ---------------------------------------------------------------------------

def print_report(report: GradeReport):
    """Print a human-readable summary to stdout."""
    print()
    print("=" * 65)
    print("  SCREENSHOT QUALITY REPORT")
    print("=" * 65)
    print(f"  Directory:     {report.directory}")
    print(f"  Total frames:  {report.total_frames}")
    print(f"  Black frames:  {report.black_frames}")
    print(f"  Frozen frames: {report.frozen_frames}")
    print()
    print(f"  Quality Score: {report.avg_quality_score:.1f} / 100  "
          f"(min={report.min_quality_score:.1f}, max={report.max_quality_score:.1f})")
    print(f"  Sharpness:     {report.avg_sharpness:.1f}")
    print(f"  Colorfulness:  {report.avg_colorfulness:.1f}")
    print(f"  Contrast:      {report.avg_contrast:.1f}")
    print()

    # HUD visibility
    print("  HUD Visibility:")
    non_black = report.total_frames - report.black_frames
    for region_name, count in report.hud_visible_counts.items():
        pct = (count / non_black * 100) if non_black > 0 else 0
        bar = "#" * int(pct / 5) + "-" * (20 - int(pct / 5))
        print(f"    {region_name:15s}  [{bar}] {count}/{non_black} ({pct:.0f}%)")
    print()

    # Per-frame details (abbreviated)
    if len(report.frames) <= 20:
        print("  Per-frame:")
        for f in report.frames:
            flags = []
            if f.is_black:
                flags.append("BLACK")
            if f.is_frozen:
                flags.append("FROZEN")
            hud_str = ",".join(k for k, v in f.hud_visible.items() if v)
            flag_str = f" [{', '.join(flags)}]" if flags else ""
            print(f"    {f.filename:30s}  q={f.quality_score:5.1f}  "
                  f"sharp={f.sharpness:7.1f}  hud=[{hud_str}]{flag_str}")
    else:
        # Show first 5, last 5, and any flagged
        print(f"  Per-frame (showing first 5, last 5, and flagged):")
        flagged = [f for f in report.frames if f.is_black or f.is_frozen]
        shown = set()
        for f in report.frames[:5] + report.frames[-5:] + flagged:
            if f.filename in shown:
                continue
            shown.add(f.filename)
            flags = []
            if f.is_black:
                flags.append("BLACK")
            if f.is_frozen:
                flags.append("FROZEN")
            hud_str = ",".join(k for k, v in f.hud_visible.items() if v)
            flag_str = f" [{', '.join(flags)}]" if flags else ""
            print(f"    {f.filename:30s}  q={f.quality_score:5.1f}  "
                  f"sharp={f.sharpness:7.1f}  hud=[{hud_str}]{flag_str}")

    print()
    if report.notes:
        print("  Notes:")
        for note in report.notes:
            print(f"    - {note}")
        print()

    verdict_color = {"PASS": "PASS", "FAIL": "** FAIL **", "DEGRADED": "DEGRADED"}
    print(f"  Verdict: {verdict_color.get(report.verdict, report.verdict)}")
    print("=" * 65)


def report_to_json(report: GradeReport) -> dict:
    """Convert report to a JSON-serializable dict."""

    def _sanitize(obj):
        """Convert numpy types to native Python types for JSON serialization."""
        if isinstance(obj, dict):
            return {k: _sanitize(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [_sanitize(v) for v in obj]
        if isinstance(obj, (np.bool_,)):
            return bool(obj)
        if isinstance(obj, (np.integer,)):
            return int(obj)
        if isinstance(obj, (np.floating,)):
            return float(obj)
        return obj

    data = {
        "directory": report.directory,
        "total_frames": report.total_frames,
        "black_frames": report.black_frames,
        "frozen_frames": report.frozen_frames,
        "hud_visible_counts": report.hud_visible_counts,
        "avg_quality_score": report.avg_quality_score,
        "min_quality_score": report.min_quality_score,
        "max_quality_score": report.max_quality_score,
        "avg_sharpness": report.avg_sharpness,
        "avg_colorfulness": report.avg_colorfulness,
        "avg_contrast": report.avg_contrast,
        "verdict": report.verdict,
        "notes": report.notes,
        "frames": [_sanitize(asdict(f)) for f in report.frames],
    }
    return data


def generate_html_report(report: GradeReport, output_path: str):
    """
    Generate a self-contained HTML report with embedded screenshot thumbnails
    and quality metrics charts.
    """
    import base64

    frames_html = []
    for f in report.frames:
        # Try to load thumbnail
        img_path = os.path.join(report.directory, f.filename)
        thumb_html = ""
        if os.path.exists(img_path):
            try:
                img = Image.open(img_path)
                img.thumbnail((320, 180))
                import io
                buf = io.BytesIO()
                img.save(buf, format="JPEG", quality=60)
                b64 = base64.b64encode(buf.getvalue()).decode()
                thumb_html = f'<img src="data:image/jpeg;base64,{b64}" style="border-radius:4px;">'
            except Exception:
                thumb_html = '<div style="width:320px;height:180px;background:#333;border-radius:4px;"></div>'

        flags = []
        if f.is_black:
            flags.append('<span style="color:#f44;">BLACK</span>')
        if f.is_frozen:
            flags.append('<span style="color:#fa4;">FROZEN</span>')

        hud_items = []
        for k, v in f.hud_visible.items():
            color = "#4f4" if v else "#f44"
            hud_items.append(f'<span style="color:{color}">{k}</span>')

        frames_html.append(f"""
        <div style="display:inline-block;margin:8px;padding:8px;background:#1a1a2e;border-radius:8px;vertical-align:top;width:340px;">
            {thumb_html}
            <div style="margin-top:4px;font-size:12px;">
                <b>{f.filename}</b> | q={f.quality_score:.1f}
                {' | '.join(flags) if flags else ''}
            </div>
            <div style="font-size:11px;color:#aaa;">
                sharp={f.sharpness:.0f} color={f.colorfulness:.0f} contrast={f.contrast:.0f}
            </div>
            <div style="font-size:11px;">HUD: {' '.join(hud_items)}</div>
        </div>
        """)

    # Quality score chart data (simple bar chart via CSS)
    chart_bars = []
    for i, f in enumerate(report.frames):
        h = max(1, f.quality_score)
        color = "#4f4" if f.quality_score >= 60 else "#fa4" if f.quality_score >= 30 else "#f44"
        if f.is_black:
            color = "#333"
        chart_bars.append(
            f'<div title="{f.filename}: {f.quality_score:.1f}" '
            f'style="display:inline-block;width:{max(2, 600 // len(report.frames))}px;'
            f'height:{h}px;background:{color};margin:0 1px;vertical-align:bottom;"></div>'
        )

    verdict_color = {"PASS": "#4f4", "FAIL": "#f44", "DEGRADED": "#fa4"}.get(report.verdict, "#aaa")

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Shadow Driver - Quality Report</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0d0d1a; color: #e0e0e0; margin: 20px; }}
  .header {{ text-align: center; padding: 20px; }}
  .stats {{ display: flex; gap: 20px; justify-content: center; flex-wrap: wrap; margin: 20px 0; }}
  .stat {{ background: #1a1a2e; padding: 16px 24px; border-radius: 8px; text-align: center; }}
  .stat .value {{ font-size: 28px; font-weight: bold; }}
  .stat .label {{ font-size: 12px; color: #888; margin-top: 4px; }}
  .chart {{ background: #1a1a2e; padding: 16px; border-radius: 8px; margin: 20px 0; }}
  .frames {{ margin: 20px 0; }}
  .notes {{ background: #2a1a1a; padding: 12px 16px; border-radius: 8px; margin: 16px 0; }}
</style>
</head>
<body>
<div class="header">
    <h1>Shadow Driver v3 - Quality Report</h1>
    <p style="color:#888;">{report.directory}</p>
    <div style="font-size:36px;font-weight:bold;color:{verdict_color};margin:16px 0;">
        {report.verdict}
    </div>
</div>

<div class="stats">
    <div class="stat">
        <div class="value">{report.avg_quality_score:.1f}</div>
        <div class="label">Quality Score</div>
    </div>
    <div class="stat">
        <div class="value">{report.total_frames}</div>
        <div class="label">Total Frames</div>
    </div>
    <div class="stat">
        <div class="value" style="color:{'#f44' if report.black_frames > 0 else '#4f4'};">{report.black_frames}</div>
        <div class="label">Black Frames</div>
    </div>
    <div class="stat">
        <div class="value" style="color:{'#fa4' if report.frozen_frames > 0 else '#4f4'};">{report.frozen_frames}</div>
        <div class="label">Frozen Frames</div>
    </div>
    <div class="stat">
        <div class="value">{report.avg_sharpness:.0f}</div>
        <div class="label">Avg Sharpness</div>
    </div>
    <div class="stat">
        <div class="value">{report.avg_colorfulness:.0f}</div>
        <div class="label">Avg Colorfulness</div>
    </div>
</div>

<div class="chart">
    <h3>Quality Score per Frame</h3>
    <div style="height:100px;display:flex;align-items:flex-end;">
        {''.join(chart_bars)}
    </div>
</div>

{'<div class="notes"><h3>Notes</h3><ul>' + ''.join(f"<li>{n}</li>" for n in report.notes) + '</ul></div>' if report.notes else ''}

<div class="frames">
    <h3>All Frames</h3>
    {''.join(frames_html)}
</div>

</body>
</html>"""

    with open(output_path, 'w') as f:
        f.write(html)
    print(f"HTML report saved: {output_path}")


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main():
    global BLACK_MEAN_THRESHOLD, FROZEN_SSIM_THRESHOLD

    parser = argparse.ArgumentParser(
        description="Grade Shadow Driver gameplay screenshots for visual quality",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python3 grader.py ./test-results/20260223_143000/screenshots/
  python3 grader.py ./test-results/20260223_143000/screenshots/ --json
  python3 grader.py ./test-results/20260223_143000/screenshots/ --html report.html
  python3 grader.py screenshot_001.png
        """
    )
    parser.add_argument("path", help="Directory of screenshots or single image file")
    parser.add_argument("--json", action="store_true", help="Output JSON only (no human-readable report)")
    parser.add_argument("--html", metavar="FILE", help="Generate HTML report to FILE")
    parser.add_argument("--save-json", metavar="FILE", help="Save JSON report to FILE")
    parser.add_argument("--black-threshold", type=float, default=BLACK_MEAN_THRESHOLD,
                        help=f"Mean pixel value below which a frame is 'black' (default: {BLACK_MEAN_THRESHOLD})")
    parser.add_argument("--frozen-threshold", type=float, default=FROZEN_SSIM_THRESHOLD,
                        help=f"SSIM above which consecutive frames are 'frozen' (default: {FROZEN_SSIM_THRESHOLD})")

    args = parser.parse_args()

    # Apply custom thresholds
    BLACK_MEAN_THRESHOLD = args.black_threshold
    FROZEN_SSIM_THRESHOLD = args.frozen_threshold

    # Grade
    report = grade_directory(args.path)

    # Output
    if args.json:
        print(json.dumps(report_to_json(report), indent=2))
    else:
        print_report(report)

    if args.save_json:
        with open(args.save_json, 'w') as f:
            json.dump(report_to_json(report), f, indent=2)
        print(f"JSON report saved: {args.save_json}")

    if args.html:
        generate_html_report(report, args.html)

    # Exit code
    sys.exit(0 if report.verdict == "PASS" else 1)


if __name__ == "__main__":
    main()
