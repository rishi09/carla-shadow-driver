#!/usr/bin/env python3
"""AV1 vs H.264 NVENC Codec Benchmark for Shadow Driver v3.

Encodes synthetic 1080p frames with h264_nvenc, av1_nvenc, hevc_nvenc, and
libsvtav1 (software). Measures encode latency, bitrate, and PSNR per codec.
Gracefully skips unavailable encoders.

Usage: python3 av1_codec_benchmark.py [--frames 90] [--width 1920] [--height 1080]
"""
import argparse, json, os, subprocess, sys, tempfile, time
from pathlib import Path

def encoder_available(name):
    try:
        r = subprocess.run(["ffmpeg","-hide_banner","-encoders"], capture_output=True, text=True, timeout=10)
        return name in r.stdout
    except Exception: return False

def gen_frames(w, h, n):
    """Generate synthetic BGRA test frames using numpy."""
    import numpy as np
    frames = bytearray()
    for f in range(n):
        sc = (f * 8) % h
        y = (np.arange(h).reshape(-1,1) + sc) % h
        x = np.arange(w).reshape(1,-1)
        b = ((y*73 + x*31 + f*17) & 0xFF).astype(np.uint8)
        g = ((y*47 + x*53 + f*11) & 0xFF).astype(np.uint8)
        r = ((y*29 + x*67 + f*23) & 0xFF).astype(np.uint8)
        a = np.full((h,w), 255, dtype=np.uint8)
        road = (np.arange(h) > h*0.6) & (np.arange(h) < h*0.9)
        r[road] = np.clip(r[road]//2+40, 0, 255)
        g[road] = np.clip(g[road]//2+40, 0, 255)
        b[road] = np.clip(b[road]//2+40, 0, 255)
        frames.extend(np.stack([b,g,r,a], axis=-1).tobytes())
    return bytes(frames)

def build_cmd(enc, w, h, fps, br, outfile):
    """Build ffmpeg command for the given encoder."""
    base = ["ffmpeg","-y","-hide_banner","-loglevel","error",
            "-f","rawvideo","-pix_fmt","bgra","-s",f"{w}x{h}","-r",str(fps),"-i","pipe:0"]
    ext = {"h264_nvenc":"h264","av1_nvenc":"av1","hevc_nvenc":"hevc","libsvtav1":"av1"}[enc]
    if "nvenc" in enc:
        base += ["-c:v",enc,"-preset","p1","-tune","ull","-rc","cbr","-b:v",br,
                 "-bf","0","-rc-lookahead","0","-zerolatency","1","-g",str(fps*2)]
    else:
        base += ["-c:v","libsvtav1","-preset","12","-crf","35",
                 "-svtav1-params","tune=0:film-grain=0","-g",str(fps*2)]
    base += ["-f",ext,str(outfile)]
    return base

def measure_psnr(raw, encoded, w, h, fps):
    """Decode encoded file and compute PSNR against raw frames."""
    with tempfile.NamedTemporaryFile(suffix=".raw", delete=False) as tmp:
        tmp.write(raw); rawf = tmp.name
    try:
        r = subprocess.run(
            ["ffmpeg","-hide_banner","-loglevel","error","-f","rawvideo","-pix_fmt","bgra",
             "-s",f"{w}x{h}","-r",str(fps),"-i",rawf,"-i",encoded,
             "-lavfi","[0:v]format=yuv420p[a];[1:v]format=yuv420p[b];[a][b]psnr",
             "-f","null","-"], capture_output=True, text=True, timeout=60)
        for line in (r.stderr + r.stdout).split("\n"):
            if "average" in line.lower():
                for p in line.split():
                    if p.startswith("average:"):
                        try: return float(p.split(":")[1])
                        except ValueError: pass
    except Exception: pass
    finally: os.unlink(rawf)
    return 0.0

def run_benchmark(enc, label, raw, w, h, n, fps, br, outdir):
    """Encode frames, measure latency and output size. Returns result dict."""
    res = {"codec":label,"encoder":enc,"available":False,"error":"","frames":0,
           "avg_ms":0,"p99_ms":0,"bitrate_mbps":0,"output_kb":0,"psnr":0,"file":""}
    if not encoder_available(enc):
        res["error"] = f"{enc} not in ffmpeg"; return res
    ext = {"h264_nvenc":"h264","av1_nvenc":"av1","hevc_nvenc":"hevc","libsvtav1":"av1"}[enc]
    outfile = outdir / f"sample_{label}.{ext}"
    cmd = build_cmd(enc, w, h, fps, br, outfile)
    try:
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0)
        time.sleep(0.3)
        if proc.poll() is not None:
            res["error"] = proc.stderr.read().decode()[:200]; return res
        fsz = w*h*4; lats = []
        for i in range(n):
            t0 = time.monotonic()
            proc.stdin.write(raw[i*fsz:(i+1)*fsz]); proc.stdin.flush()
            lats.append((time.monotonic()-t0)*1000)
        proc.stdin.close(); proc.wait(timeout=30)
        if proc.returncode != 0:
            res["error"] = proc.stderr.read().decode()[:200]; return res
    except Exception as e:
        res["error"] = str(e); return res
    res["available"] = True; res["frames"] = n
    res["avg_ms"] = round(sum(lats)/len(lats), 2)
    sl = sorted(lats); res["p99_ms"] = round(sl[max(0,int(len(sl)*0.99)-1)], 2)
    if outfile.exists():
        sz = outfile.stat().st_size; dur = n/fps
        res["output_kb"] = round(sz/1024, 1)
        res["bitrate_mbps"] = round(sz*8/(dur*1e6), 3)
        res["file"] = str(outfile)
    return res

def main():
    ap = argparse.ArgumentParser(description="AV1 vs H.264 NVENC Codec Benchmark")
    ap.add_argument("--frames", type=int, default=90)
    ap.add_argument("--width", type=int, default=1920)
    ap.add_argument("--height", type=int, default=1080)
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--bitrate", default="8M")
    ap.add_argument("--output-dir", default="")
    ap.add_argument("--skip-psnr", action="store_true")
    ap.add_argument("--skip-svt", action="store_true")
    a = ap.parse_args()
    od = Path(a.output_dir) if a.output_dir else Path(tempfile.mkdtemp(prefix="av1bench_"))
    od.mkdir(parents=True, exist_ok=True)

    print(f"Config: {a.width}x{a.height} @ {a.fps}fps, {a.frames} frames, bitrate={a.bitrate}")
    try:
        v = subprocess.run(["ffmpeg","-version"], capture_output=True, text=True, timeout=5)
        print(f"FFmpeg: {v.stdout.split(chr(10))[0]}")
    except FileNotFoundError: print("ERROR: ffmpeg not found"); sys.exit(1)
    try:
        g = subprocess.run(["nvidia-smi","--query-gpu=name","--format=csv,noheader"],
                           capture_output=True, text=True, timeout=5)
        print(f"GPU: {g.stdout.strip()}")
    except FileNotFoundError: print("GPU: not detected")

    print(f"\nGenerating {a.frames} synthetic frames...")
    raw = gen_frames(a.width, a.height, a.frames)
    print(f"  {len(raw)/(1024*1024):.0f} MB raw data\n")

    encs = [("h264_nvenc","h264_nvenc"),("av1_nvenc","av1_nvenc"),("hevc_nvenc","hevc_nvenc")]
    if not a.skip_svt: encs.append(("svt_av1","libsvtav1"))

    results = []
    for label, enc in encs:
        print(f"--- {label} ---")
        r = run_benchmark(enc, label, raw, a.width, a.height, a.frames, a.fps, a.bitrate, od)
        if r["available"] and not a.skip_psnr:
            r["psnr"] = round(measure_psnr(raw, r["file"], a.width, a.height, a.fps), 2)
        st = "OK" if r["available"] else "SKIP"
        print(f"  [{st}] avg={r['avg_ms']}ms p99={r['p99_ms']}ms "
              f"bitrate={r['bitrate_mbps']}Mbps psnr={r['psnr']}dB")
        if r["error"]: print(f"  Error: {r['error'][:80]}")
        results.append(r)

    # Also wrap samples in MP4 containers for browser <video> playback testing
    for r in results:
        if r["available"] and r["file"]:
            mp4 = od / f"test_{r['codec']}.mp4"
            subprocess.run(["ffmpeg","-y","-hide_banner","-loglevel","error",
                            "-i",r["file"],"-c","copy","-t","1","-movflags","+faststart",
                            str(mp4)], capture_output=True, timeout=15)

    # Print table
    print(f"\n{'='*80}")
    print(f"{'Codec':<14} {'Avail':<7} {'Avg ms':<9} {'P99 ms':<9} "
          f"{'Mbps':<9} {'KB/frame':<10} {'PSNR':<8}")
    print(f"{'-'*80}")
    for r in results:
        if r["available"]:
            kpf = round(r["output_kb"]/max(r["frames"],1), 1)
            psnr = f"{r['psnr']:.1f}" if r["psnr"]>0 else "--"
            print(f"{r['codec']:<14} {'YES':<7} {r['avg_ms']:<9} {r['p99_ms']:<9} "
                  f"{r['bitrate_mbps']:<9} {kpf:<10} {psnr:<8}")
        else:
            print(f"{r['codec']:<14} {'NO':<7} {'--':<9} {'--':<9} "
                  f"{'--':<9} {'--':<10} {'--':<8}  {r['error'][:30]}")
    print(f"{'='*80}")

    # Relative comparison
    h = next((r for r in results if r["codec"]=="h264_nvenc" and r["available"]), None)
    if h:
        print("\nRelative to H.264 NVENC:")
        for r in results:
            if r["available"] and r["codec"] != "h264_nvenc" and h["bitrate_mbps"]>0:
                br = (r["bitrate_mbps"]-h["bitrate_mbps"])/h["bitrate_mbps"]*100
                la = (r["avg_ms"]-h["avg_ms"])/h["avg_ms"]*100 if h["avg_ms"]>0 else 0
                print(f"  {r['codec']}: {br:+.0f}% bitrate, {la:+.0f}% latency")

    with open(od/"benchmark_results.json","w") as f:
        json.dump({"config":vars(a),"results":results}, f, indent=2)
    print(f"\nOutput: {od}")
    print(f"Browser test: serve with 'python3 -m http.server' and open av1_decode_test.html")

if __name__ == "__main__":
    main()
