import math
from typing import Any, Optional


def compute_angle(
    a: dict[str, float],
    b: dict[str, float],
    c: dict[str, float],
) -> float:
    """Return the angle at vertex B (degrees) formed by A-B-C using 2-D x,y coords."""
    ba = (a["x"] - b["x"], a["y"] - b["y"])
    bc = (c["x"] - b["x"], c["y"] - b["y"])
    dot = ba[0] * bc[0] + ba[1] * bc[1]
    mag_ba = math.sqrt(ba[0] ** 2 + ba[1] ** 2)
    mag_bc = math.sqrt(bc[0] ** 2 + bc[1] ** 2)
    if mag_ba == 0 or mag_bc == 0:
        return 0.0
    cos_angle = max(-1.0, min(1.0, dot / (mag_ba * mag_bc)))
    return math.degrees(math.acos(cos_angle))


def _rule_score(angle: float, min_angle: float, max_angle: float) -> float:
    """
    Return a 0-100 partial score for how well the angle sits within the target range.
    - 100 if perfectly centred
    - Decreases linearly toward 0 as angle moves further outside the range
    """
    mid = (min_angle + max_angle) / 2
    half_range = (max_angle - min_angle) / 2

    if min_angle <= angle <= max_angle:
        # Inside range: full score scaled by distance from centre
        deviation = abs(angle - mid)
        return round(100.0 - (deviation / max(half_range, 1)) * 20, 1)

    # Outside range: score drops by 2 pts per degree outside
    overshoot = min(abs(angle - min_angle), abs(angle - max_angle))
    score = max(0.0, 100.0 - overshoot * 2.5)
    return round(score, 1)


def analyze(
    landmarks: dict[str, dict[str, float]],
    exercise: dict[str, Any],
) -> dict[str, Any]:
    """
    Evaluate all rules in the exercise config against detected landmarks.

    Returns:
        {
            "accuracy_pct": float,           # 0-100 weighted score
            "passing_rules": [str],
            "failing_rules": [{"id", "feedback", "severity", "angle", "deviation"}],
            "joint_colors": {landmark_name: "green"|"red"|"yellow"},
            "angles": {rule_id: float},
            "rule_scores": {rule_id: float},  # 0-100 per-rule partial score
        }
    """
    rules = exercise.get("rules", [])
    passing: list[str] = []
    failing: list[dict] = []
    joint_colors: dict[str, str] = {}
    angles: dict[str, float] = {}
    rule_scores: dict[str, float] = {}

    weight_sum = 0.0
    weighted_score_sum = 0.0

    # Severity weights
    SEVERITY_WEIGHT = {"major": 3.0, "minor": 1.0}

    for rule in rules:
        lm_names: list[str] = rule["landmarks"]

        # Skip if any landmark missing or low-visibility
        if not all(n in landmarks for n in lm_names):
            continue
        pts = [landmarks[n] for n in lm_names]
        if any(p.get("visibility", 1.0) < 0.35 for p in pts):
            continue

        angle = compute_angle(pts[0], pts[1], pts[2])
        angles[rule["id"]] = round(angle, 1)

        passed = rule["min_angle"] <= angle <= rule["max_angle"]
        score = _rule_score(angle, rule["min_angle"], rule["max_angle"])
        rule_scores[rule["id"]] = score

        weight = SEVERITY_WEIGHT.get(rule.get("severity", "minor"), 1.0)
        weight_sum += weight
        weighted_score_sum += score * weight

        # Colour joints: yellow = borderline (score 60-80), green = good, red = fail
        color = "green" if passed else ("yellow" if score >= 55 else "red")
        for name in lm_names:
            if joint_colors.get(name) != "red":
                joint_colors[name] = color

        if passed:
            passing.append(rule["id"])
        else:
            # Calculate how far outside the range
            if angle < rule["min_angle"]:
                deviation = round(rule["min_angle"] - angle, 1)
                direction = f"{deviation}° too low"
            else:
                deviation = round(angle - rule["max_angle"], 1)
                direction = f"{deviation}° too high"

            failing.append({
                "id": rule["id"],
                "feedback": rule["feedback_fail"],
                "severity": rule.get("severity", "minor"),
                "angle": round(angle, 1),
                "deviation": direction,
                "score": score,
            })

    # Weighted accuracy
    accuracy_pct = round((weighted_score_sum / weight_sum) if weight_sum > 0 else 0.0, 1)

    # Sort failing by severity then score (worst first)
    failing.sort(key=lambda r: (0 if r["severity"] == "major" else 1, r.get("score", 0)))

    return {
        "accuracy_pct": accuracy_pct,
        "passing_rules": passing,
        "failing_rules": failing,
        "joint_colors": joint_colors,
        "angles": angles,
        "rule_scores": rule_scores,
    }


def compute_symmetry(landmarks: dict[str, dict[str, float]]) -> Optional[dict]:
    """
    Unique feature: compute left/right body symmetry score.
    Compares paired landmarks (shoulders, hips, knees, elbows, wrists, ankles).
    Returns a 0-100 symmetry score + per-pair breakdown.
    """
    PAIRS = [
        ("LEFT_SHOULDER",  "RIGHT_SHOULDER"),
        ("LEFT_HIP",       "RIGHT_HIP"),
        ("LEFT_KNEE",      "RIGHT_KNEE"),
        ("LEFT_ELBOW",     "RIGHT_ELBOW"),
        ("LEFT_WRIST",     "RIGHT_WRIST"),
        ("LEFT_ANKLE",     "RIGHT_ANKLE"),
    ]

    scores = []
    breakdown = []

    for left_name, right_name in PAIRS:
        if left_name not in landmarks or right_name not in landmarks:
            continue
        l = landmarks[left_name]
        r = landmarks[right_name]
        if l.get("visibility", 0) < 0.4 or r.get("visibility", 0) < 0.4:
            continue

        # Compare Y position (height) — symmetric body parts should be at same height
        y_diff = abs(l["y"] - r["y"])
        # 0 diff = 100%, 0.1 diff (10% frame height) = ~0%
        pair_score = max(0.0, 100.0 - y_diff * 1000)

        joint_name = left_name.replace("LEFT_", "").replace("_", " ").title()
        breakdown.append({
            "joint": joint_name,
            "score": round(pair_score, 1),
            "ok": pair_score >= 70,
        })
        scores.append(pair_score)

    if not scores:
        return None

    overall = round(sum(scores) / len(scores), 1)
    return {
        "score": overall,
        "status": "balanced" if overall >= 75 else "slight_imbalance" if overall >= 50 else "imbalanced",
        "breakdown": breakdown,
    }
