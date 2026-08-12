from typing import Any


def generate_feedback(
    analysis: dict[str, Any],
    exercise: dict[str, Any],
) -> dict[str, Any]:
    """
    Build a prioritized feedback payload from an analysis result.

    Returns:
        {
            "messages": [str],          # up to 3 corrective cues, major severity first
            "accuracy_pct": float,
            "status": "good" | "needs_work" | "poor"
        }
    """
    accuracy = analysis["accuracy_pct"]
    failing = analysis["failing_rules"]

    # Sort: major first, then minor
    sorted_failing = sorted(
        failing,
        key=lambda r: (0 if r.get("severity") == "major" else 1),
    )

    messages = [r["feedback"] for r in sorted_failing[:3]]

    if not messages:
        messages = [f"Great form! Keep it up — {exercise['name']} looks solid."]

    if accuracy >= 80:
        status = "good"
    elif accuracy >= 50:
        status = "needs_work"
    else:
        status = "poor"

    return {
        "messages": messages,
        "accuracy_pct": accuracy,
        "status": status,
    }
