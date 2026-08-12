import math
from typing import Any


def compute_angle(
    a: dict[str, float],
    b: dict[str, float],
    c: dict[str, float],
) -> float:
    """
    Return the angle at vertex B (in degrees) formed by points A-B-C.
    Uses 2-D (x, y) coordinates only.
    """
    ba = (a["x"] - b["x"], a["y"] - b["y"])
    bc = (c["x"] - b["x"], c["y"] - b["y"])

    dot = ba[0] * bc[0] + ba[1] * bc[1]
    mag_ba = math.sqrt(ba[0] ** 2 + ba[1] ** 2)
    mag_bc = math.sqrt(bc[0] ** 2 + bc[1] ** 2)

    if mag_ba == 0 or mag_bc == 0:
        return 0.0

    cos_angle = max(-1.0, min(1.0, dot / (mag_ba * mag_bc)))
    return math.degrees(math.acos(cos_angle))


def analyze(
    landmarks: dict[str, dict[str, float]],
    exercise: dict[str, Any],
) -> dict[str, Any]:
    """
    Evaluate all rules in the exercise config against the detected landmarks.

    Returns:
        {
            "accuracy_pct": float,          # 0-100
            "passing_rules": [str],          # rule IDs that passed
            "failing_rules": [              # rules that failed
                {"id": str, "feedback": str, "severity": str, "angle": float}
            ],
            "joint_colors": {str: str},      # landmark_name -> "green" | "red"
            "angles": {str: float},          # rule_id -> computed angle
        }
    """
    rules = exercise.get("rules", [])
    passing: list[str] = []
    failing: list[dict] = []
    joint_colors: dict[str, str] = {}
    angles: dict[str, float] = {}

    for rule in rules:
        lm_names: list[str] = rule["landmarks"]

        # Skip rule if any landmark is missing or low-visibility
        if not all(lm_names[i] in landmarks for i in range(len(lm_names))):
            continue
        pts = [landmarks[n] for n in lm_names]
        if any(p["visibility"] < 0.4 for p in pts):
            continue

        angle = compute_angle(pts[0], pts[1], pts[2])
        angles[rule["id"]] = round(angle, 1)

        passed = rule["min_angle"] <= angle <= rule["max_angle"]

        # Color all landmarks involved in this rule
        for name in lm_names:
            # red overrides green
            if joint_colors.get(name) != "red":
                joint_colors[name] = "green" if passed else "red"

        if passed:
            passing.append(rule["id"])
        else:
            failing.append({
                "id": rule["id"],
                "feedback": rule["feedback_fail"],
                "severity": rule.get("severity", "minor"),
                "angle": round(angle, 1),
            })

    total = len(passing) + len(failing)
    accuracy_pct = round((len(passing) / total * 100) if total > 0 else 0.0, 1)

    return {
        "accuracy_pct": accuracy_pct,
        "passing_rules": passing,
        "failing_rules": failing,
        "joint_colors": joint_colors,
        "angles": angles,
    }
