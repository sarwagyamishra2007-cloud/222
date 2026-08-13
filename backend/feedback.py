from typing import Any


def generate_feedback(
    analysis: dict[str, Any],
    exercise: dict[str, Any],
) -> dict[str, Any]:
    """
    Build a prioritized, context-aware feedback payload from an analysis result.

    Returns:
        {
            "messages": [str],          # up to 3 corrective cues, major first
            "accuracy_pct": float,
            "status": "good" | "needs_work" | "poor"
        }
    """
    accuracy = analysis["accuracy_pct"]
    failing  = analysis["failing_rules"]   # already sorted: major first, worst score first

    # Enrich messages with angle deviation info when helpful
    messages = []
    for rule in failing[:3]:
        msg = rule["feedback"]
        deviation = rule.get("deviation")
        if deviation and rule.get("severity") == "major":
            msg = f"{msg} (angle is {deviation})"
        messages.append(msg)

    if not messages:
        # Vary positive messages based on accuracy
        if accuracy >= 95:
            messages = [f"Perfect form! {exercise['name']} looks excellent 🎯"]
        elif accuracy >= 85:
            messages = [f"Great form! Keep holding {exercise['name']} steady 💪"]
        else:
            messages = [f"Good work! {exercise['name']} form is on track ✓"]

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
