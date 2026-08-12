import json
import os
from typing import Any

_EXERCISES_DIR = os.path.join(os.path.dirname(__file__), "exercises")


def load_exercise(exercise_id: str) -> dict[str, Any]:
    """Load and return a single exercise config by ID. Raises ValueError if not found."""
    path = os.path.join(_EXERCISES_DIR, f"{exercise_id}.json")
    if not os.path.isfile(path):
        raise ValueError(f"Exercise '{exercise_id}' not found")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def list_exercises() -> list[dict[str, Any]]:
    """Return a summary list of all available exercises (id, name, category, cues)."""
    exercises = []
    for filename in sorted(os.listdir(_EXERCISES_DIR)):
        if filename.endswith(".json"):
            with open(os.path.join(_EXERCISES_DIR, filename), "r", encoding="utf-8") as f:
                data = json.load(f)
                exercises.append({
                    "id": data["id"],
                    "name": data["name"],
                    "category": data["category"],
                    "cues": data.get("cues", []),
                })
    return exercises
