"""
AI Driving Coach - Analyzes post-race telemetry and generates coaching tips.

Compares player vs AI sector split times, speeds, and collision data to
produce actionable improvement suggestions ordered by impact.
"""
from typing import List, Dict, Optional


# Severity thresholds (seconds lost vs AI in a single sector)
CRITICAL_THRESHOLD = 2.0   # Lost 2+ seconds in one sector
MAJOR_THRESHOLD = 1.0      # Lost 1-2 seconds
MINOR_THRESHOLD = 0.3      # Lost 0.3-1 seconds


def generate_coaching_tips(
    sector_times: Dict[str, List[float]],
    sector_speeds: Dict[str, List[float]],
    collision_sectors: Dict[int, int],
    player_max_speed: float,
    ai_max_speed: float,
    player_collisions: int,
) -> List[Dict]:
    """Generate 3-5 coaching tips based on post-race telemetry analysis.

    Analyzes sector-by-sector performance to identify where the player
    lost the most time relative to the AI, then generates specific
    improvement suggestions.

    Args:
        sector_times: {'player': [float, ...], 'ai': [float, ...]}
            Average time per sector for each racer.
        sector_speeds: {'player': [float, ...], 'ai': [float, ...]}
            Average speed at each checkpoint crossing.
        collision_sectors: {sector_index: collision_count}
            Which sectors the player had collisions in.
        player_max_speed: Player's top speed during the race.
        ai_max_speed: AI's top speed during the race.
        player_collisions: Total collision count.

    Returns:
        List of coaching tip dicts, sorted by impact (biggest delta first).
        Each dict has: sector, delta, tip, severity.
    """
    player_sectors = sector_times.get('player', [])
    ai_sectors = sector_times.get('ai', [])
    player_speeds = sector_speeds.get('player', [])
    ai_speeds = sector_speeds.get('ai', [])

    if not player_sectors or not ai_sectors:
        return []

    num_sectors = min(len(player_sectors), len(ai_sectors))
    if num_sectors == 0:
        return []

    # Compute per-sector deltas (positive = player slower than AI)
    sector_deltas: List[Dict] = []
    for i in range(num_sectors):
        p_time = player_sectors[i]
        a_time = ai_sectors[i]
        if p_time <= 0 or a_time <= 0:
            continue

        delta = p_time - a_time  # positive = player lost time here

        p_speed = player_speeds[i] if i < len(player_speeds) else 0.0
        a_speed = ai_speeds[i] if i < len(ai_speeds) else 0.0
        collisions_in_sector = collision_sectors.get(i, 0)

        sector_deltas.append({
            'sector': i + 1,  # 1-indexed for display
            'delta': round(delta, 2),
            'player_time': round(p_time, 2),
            'ai_time': round(a_time, 2),
            'player_speed': round(p_speed, 1),
            'ai_speed': round(a_speed, 1),
            'collisions': collisions_in_sector,
        })

    # Sort by delta descending (biggest time loss first)
    sector_deltas.sort(key=lambda s: s['delta'], reverse=True)

    tips: List[Dict] = []

    # Generate tips for the worst sectors
    for sector_data in sector_deltas:
        if len(tips) >= 5:
            break

        delta = sector_data['delta']
        sector = sector_data['sector']
        p_speed = sector_data['player_speed']
        a_speed = sector_data['ai_speed']
        collisions = sector_data['collisions']

        # Skip sectors where player was faster or very close
        if delta < MINOR_THRESHOLD:
            continue

        # Determine severity
        if delta >= CRITICAL_THRESHOLD:
            severity = 'critical'
        elif delta >= MAJOR_THRESHOLD:
            severity = 'major'
        else:
            severity = 'minor'

        # Generate tip text based on pattern analysis
        tip = _analyze_sector(delta, p_speed, a_speed, collisions, sector)

        tips.append({
            'sector': sector,
            'delta': round(delta, 1),
            'tip': tip,
            'severity': severity,
        })

    # If player had significantly fewer tips than expected but many collisions,
    # add a general collision tip
    if player_collisions >= 3 and len(tips) < 5:
        collision_tip = _collision_tip(player_collisions)
        if collision_tip and not any(t.get('_is_collision_general') for t in tips):
            tips.append(collision_tip)

    # If player's max speed is much lower than AI's, add a top speed tip
    if player_max_speed > 0 and ai_max_speed > 0:
        speed_ratio = player_max_speed / ai_max_speed
        if speed_ratio < 0.85 and len(tips) < 5:
            tips.append({
                'sector': 0,  # 0 = general tip, not sector-specific
                'delta': round(ai_max_speed - player_max_speed, 1),
                'tip': (f"Your top speed was {player_max_speed:.0f} km/h vs the AI's "
                        f"{ai_max_speed:.0f} km/h. Try using full throttle on straights "
                        f"and braking later into corners to carry more speed."),
                'severity': 'major',
            })

    # Add positive feedback if player gained time in some sectors
    gains = [s for s in sector_deltas if s['delta'] < -MINOR_THRESHOLD]
    if gains and len(tips) < 5:
        best_gain = gains[-1]  # Most negative delta = biggest gain
        tips.append({
            'sector': best_gain['sector'],
            'delta': round(best_gain['delta'], 1),
            'tip': (f"Great work in Sector {best_gain['sector']}! You were "
                    f"{abs(best_gain['delta']):.1f}s faster than the AI here. "
                    f"Try to replicate this technique in other sectors."),
            'severity': 'minor',
        })

    return tips[:5]  # Cap at 5 tips


def _analyze_sector(
    delta: float,
    player_speed: float,
    ai_speed: float,
    collisions: int,
    sector: int,
) -> str:
    """Generate a specific coaching tip for a single sector based on telemetry patterns.

    Looks at speed differential, collision count, and time loss to
    determine the most likely cause and suggest a remedy.
    """
    # Pattern 1: Collisions in this sector
    if collisions >= 2:
        return (f"You lost {delta:.1f}s in Sector {sector} with {collisions} collisions. "
                f"Try a wider entry line and brake earlier to stay in control.")
    if collisions == 1:
        return (f"You lost {delta:.1f}s in Sector {sector} after a collision. "
                f"A smoother line through this section will save you time.")

    speed_diff = ai_speed - player_speed

    # Pattern 2: High speed but slow sector = missing the apex
    if player_speed > 0 and ai_speed > 0:
        if player_speed >= ai_speed * 0.95 and delta >= MAJOR_THRESHOLD:
            return (f"You lost {delta:.1f}s in Sector {sector} despite similar speed "
                    f"({player_speed:.0f} vs {ai_speed:.0f} km/h). "
                    f"You may be taking a wider line -- try hitting the apex tighter "
                    f"to shorten your path.")

    # Pattern 3: Much slower speed = braking too early or not enough throttle
    if speed_diff > 20:
        return (f"You lost {delta:.1f}s in Sector {sector}. Your speed was "
                f"{player_speed:.0f} km/h vs the AI's {ai_speed:.0f} km/h. "
                f"Try braking later and getting on the throttle earlier out of the corner.")

    if speed_diff > 10:
        return (f"You lost {delta:.1f}s in Sector {sector}. You were "
                f"{speed_diff:.0f} km/h slower than the AI. "
                f"Carry more speed through this section by braking less aggressively.")

    # Pattern 4: Consistently slow overall
    if player_speed < 40 and ai_speed > 60:
        return (f"You lost {delta:.1f}s in Sector {sector}. Your speed dropped to "
                f"{player_speed:.0f} km/h while the AI maintained {ai_speed:.0f} km/h. "
                f"Try staying on the throttle longer before braking for the corner.")

    # Pattern 5: General time loss with similar speeds
    if delta >= CRITICAL_THRESHOLD:
        return (f"You lost {delta:.1f}s in Sector {sector}. Try braking later into "
                f"the corner and carrying more speed through. The AI takes a tighter "
                f"line here -- aim for the inside edge.")

    # Default tip for moderate time loss
    return (f"You lost {delta:.1f}s in Sector {sector}. "
            f"Focus on a smooth racing line and progressive throttle application "
            f"to reduce your time through this section.")


def _collision_tip(collision_count: int) -> Optional[Dict]:
    """Generate a general tip about collisions."""
    if collision_count >= 5:
        return {
            'sector': 0,
            'delta': 0,
            'tip': (f"You had {collision_count} collisions during the race. "
                    f"Each collision costs speed and disrupts your line. "
                    f"Focus on clean, smooth driving -- it's faster than pushing "
                    f"too hard and hitting walls."),
            'severity': 'major',
            '_is_collision_general': True,
        }
    elif collision_count >= 3:
        return {
            'sector': 0,
            'delta': 0,
            'tip': (f"You had {collision_count} collisions. Try leaving a bit more "
                    f"margin on corner entries -- a clean lap is usually faster than "
                    f"an aggressive one with wall contact."),
            'severity': 'minor',
            '_is_collision_general': True,
        }
    return None
