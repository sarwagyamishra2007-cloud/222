import os
import urllib.request
from typing import Optional

import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks.python import vision as mp_vision
from mediapipe.tasks import python as mp_tasks

# ── Landmark connections for skeleton drawing ─────────────────────────────────
# Pairs of landmark indices to connect with lines
_POSE_CONNECTIONS = [
    (11, 12),  # shoulders
    (11, 13), (13, 15),  # left arm
    (12, 14), (14, 16),  # right arm
    (11, 23), (12, 24),  # torso sides
    (23, 24),            # hips
    (23, 25), (25, 27),  # left leg
    (24, 26), (26, 28),  # right leg
    (27, 29), (27, 31),  # left foot
    (28, 30), (28, 32),  # right foot
]

# Landmark index → name mapping
_LANDMARK_NAMES = [lm.name for lm in mp_vision.PoseLandmark]

# Path to the .task model file — download automatically if missing
_MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pose_landmarker.task")
_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_lite/float16/latest/pose_landmarker_lite.task"
)

if not os.path.isfile(_MODEL_PATH):
    print(f"Downloading pose_landmarker model to {_MODEL_PATH} ...")
    urllib.request.urlretrieve(_MODEL_URL, _MODEL_PATH)
    print("Model download complete.")


class PoseDetector:
    """Wraps MediaPipe PoseLandmarker (Tasks API) for frame-by-frame detection."""

    def __init__(self) -> None:
        base_options = mp_tasks.BaseOptions(model_asset_path=_MODEL_PATH)
        options = mp_vision.PoseLandmarkerOptions(
            base_options=base_options,
            running_mode=mp_vision.RunningMode.IMAGE,
            num_poses=1,
            min_pose_detection_confidence=0.6,
            min_pose_presence_confidence=0.6,
            min_tracking_confidence=0.5,
        )
        self._landmarker = mp_vision.PoseLandmarker.create_from_options(options)

    def detect(self, frame_bytes: bytes) -> Optional[dict[str, dict[str, float]]]:
        """
        Accept raw JPEG/PNG bytes, run MediaPipe PoseLandmarker, and return a dict of
        { landmark_name: {x, y, z, visibility} } in normalized [0,1] coordinates.
        Returns None if no pose is detected or frame cannot be decoded.
        """
        nparr = np.frombuffer(frame_bytes, np.uint8)
        bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if bgr is None:
            return None

        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = self._landmarker.detect(mp_image)

        if not result.pose_landmarks or len(result.pose_landmarks) == 0:
            return None

        landmarks: dict[str, dict[str, float]] = {}
        for idx, pt in enumerate(result.pose_landmarks[0]):
            name = _LANDMARK_NAMES[idx]
            landmarks[name] = {
                "x": pt.x,
                "y": pt.y,
                "z": pt.z,
                "visibility": pt.visibility if pt.visibility is not None else 1.0,
            }
        return landmarks

    def draw_skeleton(
        self,
        frame_bytes: bytes,
        landmarks: dict[str, dict[str, float]],
        joint_colors: Optional[dict[str, str]] = None,
    ) -> bytes:
        """
        Draw skeleton onto the frame with per-joint coloring.
        joint_colors: { landmark_name: "green" | "red" | "yellow" }
        Returns annotated JPEG bytes.
        """
        nparr = np.frombuffer(frame_bytes, np.uint8)
        bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if bgr is None:
            return frame_bytes

        h, w = bgr.shape[:2]
        joint_colors = joint_colors or {}

        _COLOR_MAP = {
            "green":  (0, 220, 0),
            "red":    (0, 0, 220),
            "yellow": (0, 200, 200),
        }

        # Build index → name for quick lookup
        idx_to_name = {i: name for i, name in enumerate(_LANDMARK_NAMES)}

        # Draw connections
        for (start_idx, end_idx) in _POSE_CONNECTIONS:
            s_name = idx_to_name.get(start_idx)
            e_name = idx_to_name.get(end_idx)
            if not s_name or not e_name:
                continue
            if s_name not in landmarks or e_name not in landmarks:
                continue
            s = landmarks[s_name]
            e = landmarks[e_name]
            if s["visibility"] < 0.4 or e["visibility"] < 0.4:
                continue
            sx, sy = int(s["x"] * w), int(s["y"] * h)
            ex, ey = int(e["x"] * w), int(e["y"] * h)
            cv2.line(bgr, (sx, sy), (ex, ey), (200, 200, 200), 2, cv2.LINE_AA)

        # Draw joints
        for name, pt in landmarks.items():
            if pt["visibility"] < 0.4:
                continue
            color_key = joint_colors.get(name, "green")
            color = _COLOR_MAP.get(color_key, (0, 220, 0))
            cx, cy = int(pt["x"] * w), int(pt["y"] * h)
            cv2.circle(bgr, (cx, cy), 5, color, -1, cv2.LINE_AA)
            cv2.circle(bgr, (cx, cy), 5, (255, 255, 255), 1, cv2.LINE_AA)

        _, buf = cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, 80])
        return buf.tobytes()

    def close(self) -> None:
        self._landmarker.close()
