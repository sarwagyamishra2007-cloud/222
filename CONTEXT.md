# AI Posture Coach — Full Project Context

> This file is a single-document reference for the entire project.
> It contains the problem statement, architecture, all source code, exercise configs,
> environment setup, known fixes, and how to run the system.

---

## 1. Problem Statement

**Riya** recently started exercising at home. She follows online videos for yoga, gym exercises,
and physiotherapy movements but cannot tell whether her posture is correct.

**Goal:** Build an AI-powered Posture & Movement Analysis System that uses a camera to analyze a
person's body posture during yoga, gym exercises, or physiotherapy movements and provides
real-time feedback.

**Core Challenges:**
- Pose Detection — identify body joints and key points from camera/video input
- Posture Analysis — determine whether joints are appropriately aligned
- Real-Time Feedback — provide simple corrective guidance during exercise
- Movement Tracking — analyze whether the complete movement is performed correctly
- Exercise Recognition — allow selection of different exercises
- Progress Tracking — record posture accuracy and improvement over multiple sessions

**Disclaimer:** The system provides fitness/movement guidance only. It does NOT diagnose medical
conditions or replace a qualified physiotherapist or doctor.

---

## 2. Architecture

```
Browser Webcam
    │ Binary JPEG frames over WebSocket
    ▼
FastAPI Backend (uvicorn, port 8000)
    ├── /auth/register  POST  — create user
    ├── /auth/login     POST  — returns JWT
    ├── /auth/me        GET   — current user info
    ├── /exercises      GET   — list all 10 exercises
    ├── /progress/summary   GET — per-exercise accuracy stats
    ├── /progress/sessions  GET — session history
    ├── /ws/analyze     WS    — real-time pose pipeline
    └── /static/*             — serves frontend HTML/JS/CSS
         │
         ├── PoseDetector (MediaPipe PoseLandmarker Tasks API)
         │       └── detect(frame_bytes) → landmarks dict
         │       └── draw_skeleton(frame, landmarks, colors) → annotated JPEG
         │
         ├── PostureAnalyzer
         │       └── analyze(landmarks, exercise_config) → accuracy%, pass/fail, joint_colors
         │
         ├── FeedbackGenerator
         │       └── generate_feedback(analysis, exercise) → messages[], status
         │
         └── SessionLogger (SQLite via SQLAlchemy)
                 └── User, ExerciseSession, RepRecord tables

Frontend (Vanilla JS + Canvas API + Chart.js)
    ├── Auth view      — register / login
    ├── Exercise view  — 10 exercise cards with category filter
    ├── Camera view    — live canvas overlay + feedback panel
    └── Progress view  — Chart.js bar chart + session history table
```

---

## 3. Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Backend | Python / FastAPI | 0.115.0 |
| ASGI Server | Uvicorn | 0.32.0 |
| Pose Detection | MediaPipe (Tasks API) | 1.0.0 |
| Image Processing | OpenCV headless | 4.10.0.84 |
| Numerical | NumPy | 2.1.0 |
| Auth | JWT (python-jose) + bcrypt | 3.3.0 / 4.2.1 |
| Database | SQLite via SQLAlchemy | 2.0.36 |
| Env config | python-dotenv | 1.0.1 |
| Frontend | Vanilla JS + Canvas | — |
| Charts | Chart.js CDN | 4.4.0 |
| Python version | CPython | 3.13 |
| OS | Windows 10/11 | — |

---

## 4. Project Structure

```
posture-coach/
├── .env.example              ← copy to .env before running
├── requirements.txt          ← all Python dependencies
├── README.md
├── CONTEXT.md                ← this file
├── backend/
│   ├── main.py               ← FastAPI app: all routes + WebSocket
│   ├── auth.py               ← JWT + bcrypt auth helpers
│   ├── database.py           ← SQLAlchemy engine + get_db dependency
│   ├── models.py             ← ORM: User, ExerciseSession, RepRecord
│   ├── pose_detector.py      ← MediaPipe PoseLandmarker wrapper
│   ├── posture_analyzer.py   ← compute_angle() + rule engine analyze()
│   ├── feedback.py           ← generate_feedback() with severity sorting
│   ├── session_logger.py     ← create_session(), log_rep(), close_session()
│   ├── exercise_loader.py    ← load_exercise(id), list_exercises()
│   ├── pose_landmarker.task  ← MediaPipe model file (downloaded at setup)
│   └── exercises/
│       ├── warrior_ii.json
│       ├── tree_pose.json
│       ├── mountain_pose.json
│       ├── chair_pose.json
│       ├── cobra_pose.json
│       ├── squat.json
│       ├── plank.json
│       ├── deadlift.json
│       ├── shoulder_roll.json
│       └── hip_hinge.json
└── frontend/
    ├── index.html            ← single-page app (4 views)
    ├── app.js                ← Auth, ExerciseSelector, CameraSession, ProgressView
    └── style.css             ← dark theme UI
```

---

## 5. Setup & Run Instructions

### Prerequisites
- Python 3.10–3.13 (tested on 3.13)
- Webcam
- Chrome or Edge browser

### Step 1 — Install dependencies

```powershell
cd posture-coach
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

### Step 2 — Configure environment

```powershell
copy .env.example .env
```

Edit `.env`:
```
SECRET_KEY=any-long-random-string
DATABASE_URL=sqlite:///./posture_coach.db
TOKEN_EXPIRE_MINUTES=60
```

### Step 3 — Start the server

```powershell
cd backend
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Step 4 — Open in browser

```
http://localhost:8000
```

---

## 6. Known Issues & Fixes Applied

### Fix 1 — passlib incompatible with bcrypt 5.x
**Error:** `Internal Server Error` on `/auth/register` and `/auth/login`
**Root cause:** `passlib 1.7.4` reads `bcrypt.__about__.__version__` which was removed in bcrypt 5.0
**Fix:** Replaced passlib with direct `bcrypt` calls in `auth.py`:
```python
# OLD (broken)
from passlib.context import CryptContext
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
pwd_context.hash(plain)

# NEW (fixed)
import bcrypt
bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
```
Also downgraded `bcrypt` to `4.2.1` as a belt-and-suspenders fix.

### Fix 2 — MediaPipe 1.0.0 removed `mp.solutions` API
**Error:** `AttributeError: module 'mediapipe' has no attribute 'solutions'`
**Root cause:** MediaPipe 1.0.0 (required for Python 3.13) dropped the legacy `solutions` API entirely
**Fix:** Rewrote `pose_detector.py` to use the new `mp.tasks` API:
```python
# OLD
mp.solutions.pose.Pose(...)
results.pose_landmarks.landmark[i]

# NEW
from mediapipe.tasks.python import vision as mp_vision
from mediapipe.tasks import python as mp_tasks
mp_vision.PoseLandmarker.create_from_options(options)
result.pose_landmarks[0][idx]
```
Also downloaded the required model file `pose_landmarker_lite.task`.

### Fix 3 — PowerShell does not support `&&`
**Error:** `The token '&&' is not a valid statement separator`
**Fix:** Run commands one at a time in PowerShell (no `&&`).

---

## 7. Exercise Library (10 exercises)

| ID | Name | Category | Rules |
|---|---|---|---|
| `warrior_ii` | Warrior II | yoga | 4 rules |
| `tree_pose` | Tree Pose | yoga | 3 rules |
| `mountain_pose` | Mountain Pose | yoga | 3 rules |
| `chair_pose` | Chair Pose | yoga | 3 rules |
| `cobra_pose` | Cobra Pose | yoga | 3 rules |
| `squat` | Squat | gym | 3 rules |
| `plank` | Plank | gym | 3 rules |
| `deadlift` | Deadlift | gym | 3 rules |
| `shoulder_roll` | Shoulder Roll | physiotherapy | 3 rules |
| `hip_hinge` | Hip Hinge | physiotherapy | 3 rules |

### Exercise JSON Schema
```json
{
  "id": "exercise_id",
  "name": "Display Name",
  "category": "yoga | gym | physiotherapy",
  "cues": ["Tip 1", "Tip 2"],
  "rules": [
    {
      "id": "rule_id",
      "landmarks": ["LANDMARK_A", "LANDMARK_B", "LANDMARK_C"],
      "min_angle": 80,
      "max_angle": 100,
      "severity": "major | minor",
      "feedback_fail": "Message shown when angle is outside range",
      "feedback_ok": "Message shown when angle is in range"
    }
  ]
}
```

---

## 8. Source Code

### requirements.txt
```
fastapi==0.115.0
uvicorn[standard]==0.32.0
mediapipe==1.0.0
opencv-python-headless==4.10.0.84
numpy==2.1.0
python-jose[cryptography]==3.3.0
passlib[bcrypt]==1.7.4
sqlalchemy==2.0.36
python-dotenv==1.0.1
python-multipart==0.0.12
```
> Note: `bcrypt` is additionally pinned to `4.2.1` via `pip install bcrypt==4.2.1` due to passlib incompatibility with bcrypt 5.x

### .env.example
```
SECRET_KEY=change-me-to-a-long-random-string
DATABASE_URL=sqlite:///./posture_coach.db
TOKEN_EXPIRE_MINUTES=60
```

---

### backend/database.py
```python
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./posture_coach.db")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

---

### backend/models.py
```python
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Integer, Float, ForeignKey, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database import Base


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    sessions: Mapped[list["ExerciseSession"]] = relationship("ExerciseSession", back_populates="user")


class ExerciseSession(Base):
    __tablename__ = "exercise_sessions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    exercise_name: Mapped[str] = mapped_column(String(64), nullable=False)
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    avg_accuracy_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    rep_count: Mapped[int] = mapped_column(Integer, default=0)
    user: Mapped["User"] = relationship("User", back_populates="sessions")
    reps: Mapped[list["RepRecord"]] = relationship("RepRecord", back_populates="session")


class RepRecord(Base):
    __tablename__ = "rep_records"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    session_id: Mapped[int] = mapped_column(Integer, ForeignKey("exercise_sessions.id"), nullable=False)
    rep_number: Mapped[int] = mapped_column(Integer, nullable=False)
    accuracy_pct: Mapped[float] = mapped_column(Float, nullable=False)
    issues: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    session: Mapped["ExerciseSession"] = relationship("ExerciseSession", back_populates="reps")
```

---

### backend/auth.py
```python
import os
from datetime import datetime, timedelta
from typing import Optional

import bcrypt
from dotenv import load_dotenv
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from database import get_db
from models import User

load_dotenv()

SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key-change-me")
ALGORITHM = "HS256"
TOKEN_EXPIRE_MINUTES = int(os.getenv("TOKEN_EXPIRE_MINUTES", "60"))

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(username: str) -> str:
    expire = datetime.utcnow() + timedelta(minutes=TOKEN_EXPIRE_MINUTES)
    payload = {"sub": username, "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> Optional[str]:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload.get("sub")
    except JWTError:
        return None


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    username = decode_token(token)
    if not username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user
```

---

### backend/pose_detector.py
```python
import os
from typing import Optional

import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks.python import vision as mp_vision
from mediapipe.tasks import python as mp_tasks

_POSE_CONNECTIONS = [
    (11, 12), (11, 13), (13, 15), (12, 14), (14, 16),
    (11, 23), (12, 24), (23, 24),
    (23, 25), (25, 27), (24, 26), (26, 28),
    (27, 29), (27, 31), (28, 30), (28, 32),
]

_LANDMARK_NAMES = [lm.name for lm in mp_vision.PoseLandmark]

_MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "backend", "pose_landmarker.task")
if not os.path.isfile(_MODEL_PATH):
    _MODEL_PATH = os.path.join(os.path.dirname(__file__), "pose_landmarker.task")


class PoseDetector:
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

    def detect(self, frame_bytes: bytes) -> Optional[dict]:
        nparr = np.frombuffer(frame_bytes, np.uint8)
        bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if bgr is None:
            return None
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = self._landmarker.detect(mp_image)
        if not result.pose_landmarks or len(result.pose_landmarks) == 0:
            return None
        landmarks = {}
        for idx, pt in enumerate(result.pose_landmarks[0]):
            name = _LANDMARK_NAMES[idx]
            landmarks[name] = {
                "x": pt.x, "y": pt.y, "z": pt.z,
                "visibility": pt.visibility if pt.visibility is not None else 1.0,
            }
        return landmarks

    def draw_skeleton(self, frame_bytes: bytes, landmarks: dict, joint_colors: dict = None) -> bytes:
        nparr = np.frombuffer(frame_bytes, np.uint8)
        bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if bgr is None:
            return frame_bytes
        h, w = bgr.shape[:2]
        joint_colors = joint_colors or {}
        _COLOR_MAP = {"green": (0, 220, 0), "red": (0, 0, 220), "yellow": (0, 200, 200)}
        idx_to_name = {i: name for i, name in enumerate(_LANDMARK_NAMES)}
        for (si, ei) in _POSE_CONNECTIONS:
            sn, en = idx_to_name.get(si), idx_to_name.get(ei)
            if not sn or not en or sn not in landmarks or en not in landmarks:
                continue
            s, e = landmarks[sn], landmarks[en]
            if s["visibility"] < 0.4 or e["visibility"] < 0.4:
                continue
            cv2.line(bgr, (int(s["x"]*w), int(s["y"]*h)), (int(e["x"]*w), int(e["y"]*h)), (200,200,200), 2, cv2.LINE_AA)
        for name, pt in landmarks.items():
            if pt["visibility"] < 0.4:
                continue
            color = _COLOR_MAP.get(joint_colors.get(name, "green"), (0, 220, 0))
            cx, cy = int(pt["x"]*w), int(pt["y"]*h)
            cv2.circle(bgr, (cx, cy), 5, color, -1, cv2.LINE_AA)
            cv2.circle(bgr, (cx, cy), 5, (255,255,255), 1, cv2.LINE_AA)
        _, buf = cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, 80])
        return buf.tobytes()

    def close(self) -> None:
        self._landmarker.close()
```

---

### backend/posture_analyzer.py
```python
import math
from typing import Any


def compute_angle(a, b, c) -> float:
    """Angle at vertex B in degrees, using 2D x/y coords."""
    ba = (a["x"] - b["x"], a["y"] - b["y"])
    bc = (c["x"] - b["x"], c["y"] - b["y"])
    dot = ba[0]*bc[0] + ba[1]*bc[1]
    mag_ba = math.sqrt(ba[0]**2 + ba[1]**2)
    mag_bc = math.sqrt(bc[0]**2 + bc[1]**2)
    if mag_ba == 0 or mag_bc == 0:
        return 0.0
    return math.degrees(math.acos(max(-1.0, min(1.0, dot / (mag_ba * mag_bc)))))


def analyze(landmarks: dict, exercise: dict) -> dict:
    rules = exercise.get("rules", [])
    passing, failing, joint_colors, angles = [], [], {}, {}
    for rule in rules:
        lm_names = rule["landmarks"]
        if not all(n in landmarks for n in lm_names):
            continue
        pts = [landmarks[n] for n in lm_names]
        if any(p["visibility"] < 0.4 for p in pts):
            continue
        angle = compute_angle(pts[0], pts[1], pts[2])
        angles[rule["id"]] = round(angle, 1)
        passed = rule["min_angle"] <= angle <= rule["max_angle"]
        for name in lm_names:
            if joint_colors.get(name) != "red":
                joint_colors[name] = "green" if passed else "red"
        if passed:
            passing.append(rule["id"])
        else:
            failing.append({"id": rule["id"], "feedback": rule["feedback_fail"],
                            "severity": rule.get("severity", "minor"), "angle": round(angle, 1)})
    total = len(passing) + len(failing)
    return {
        "accuracy_pct": round((len(passing)/total*100) if total > 0 else 0.0, 1),
        "passing_rules": passing,
        "failing_rules": failing,
        "joint_colors": joint_colors,
        "angles": angles,
    }
```

---

### backend/feedback.py
```python
from typing import Any


def generate_feedback(analysis: dict, exercise: dict) -> dict:
    accuracy = analysis["accuracy_pct"]
    sorted_failing = sorted(analysis["failing_rules"],
                            key=lambda r: (0 if r.get("severity") == "major" else 1))
    messages = [r["feedback"] for r in sorted_failing[:3]]
    if not messages:
        messages = [f"Great form! Keep it up — {exercise['name']} looks solid."]
    status = "good" if accuracy >= 80 else "needs_work" if accuracy >= 50 else "poor"
    return {"messages": messages, "accuracy_pct": accuracy, "status": status}
```

---

### backend/session_logger.py
```python
import json
from datetime import datetime
from typing import Any
from sqlalchemy.orm import Session
from models import ExerciseSession, RepRecord


def create_session(db, user_id, exercise):
    session = ExerciseSession(user_id=user_id, exercise_name=exercise["name"],
                              category=exercise["category"], started_at=datetime.utcnow())
    db.add(session); db.commit(); db.refresh(session)
    return session


def log_rep(db, session_id, rep_number, accuracy_pct, issues):
    record = RepRecord(session_id=session_id, rep_number=rep_number,
                       accuracy_pct=accuracy_pct, issues=json.dumps(issues),
                       timestamp=datetime.utcnow())
    db.add(record); db.commit(); db.refresh(record)
    return record


def close_session(db, session_id):
    session = db.query(ExerciseSession).filter(ExerciseSession.id == session_id).first()
    if not session:
        return None
    reps = db.query(RepRecord).filter(RepRecord.session_id == session_id).all()
    session.ended_at = datetime.utcnow()
    session.rep_count = len(reps)
    session.avg_accuracy_pct = round(sum(r.accuracy_pct for r in reps)/len(reps), 1) if reps else 0.0
    db.commit(); db.refresh(session)
    return session
```

---

### backend/exercise_loader.py
```python
import json, os
from typing import Any

_EXERCISES_DIR = os.path.join(os.path.dirname(__file__), "exercises")


def load_exercise(exercise_id: str) -> dict:
    path = os.path.join(_EXERCISES_DIR, f"{exercise_id}.json")
    if not os.path.isfile(path):
        raise ValueError(f"Exercise '{exercise_id}' not found")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def list_exercises() -> list:
    exercises = []
    for filename in sorted(os.listdir(_EXERCISES_DIR)):
        if filename.endswith(".json"):
            with open(os.path.join(_EXERCISES_DIR, filename), "r", encoding="utf-8") as f:
                data = json.load(f)
                exercises.append({"id": data["id"], "name": data["name"],
                                   "category": data["category"], "cues": data.get("cues", [])})
    return exercises
```

---

### backend/main.py
```python
import base64, os, sys, time
sys.path.insert(0, os.path.dirname(__file__))
from dotenv import load_dotenv
load_dotenv()

from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from auth import create_access_token, decode_token, get_current_user, hash_password, verify_password
from database import Base, engine, get_db, SessionLocal
from exercise_loader import list_exercises, load_exercise
from feedback import generate_feedback
from models import ExerciseSession, RepRecord, User
from pose_detector import PoseDetector
from posture_analyzer import analyze
from session_logger import close_session, create_session, log_rep

Base.metadata.create_all(bind=engine)
app = FastAPI(title="AI Posture Coach", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

_frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.isdir(_frontend_dir):
    app.mount("/static", StaticFiles(directory=_frontend_dir), name="static")

@app.get("/", include_in_schema=False)
def serve_index():
    index_path = os.path.join(_frontend_dir, "index.html")
    return FileResponse(index_path) if os.path.isfile(index_path) else JSONResponse({"message": "AI Posture Coach API"})

class RegisterRequest(BaseModel):
    username: str
    password: str

class LoginRequest(BaseModel):
    username: str
    password: str

@app.post("/auth/register", status_code=201)
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    if db.query(User).filter(User.username == req.username).first():
        raise HTTPException(status_code=400, detail="Username already taken")
    if len(req.password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")
    user = User(username=req.username, hashed_password=hash_password(req.password))
    db.add(user); db.commit(); db.refresh(user)
    return {"message": "User created", "username": user.username}

@app.post("/auth/login")
def login(req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == req.username).first()
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    return {"access_token": create_access_token(user.username), "token_type": "bearer"}

@app.get("/auth/me")
def me(current_user: User = Depends(get_current_user)):
    return {"username": current_user.username, "created_at": current_user.created_at}

@app.get("/exercises")
def get_exercises():
    return list_exercises()

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/progress/summary")
def progress_summary(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = (db.query(ExerciseSession.exercise_name, ExerciseSession.category,
                     func.count(ExerciseSession.id).label("session_count"),
                     func.avg(ExerciseSession.avg_accuracy_pct).label("avg_accuracy"),
                     func.max(ExerciseSession.ended_at).label("last_session"))
            .filter(ExerciseSession.user_id == current_user.id, ExerciseSession.ended_at.isnot(None))
            .group_by(ExerciseSession.exercise_name, ExerciseSession.category).all())
    return [{"exercise_name": r.exercise_name, "category": r.category,
             "session_count": r.session_count, "avg_accuracy": round(r.avg_accuracy or 0, 1),
             "last_session": r.last_session.isoformat() if r.last_session else None} for r in rows]

@app.get("/progress/sessions")
def progress_sessions(exercise_name: str = None, current_user: User = Depends(get_current_user),
                      db: Session = Depends(get_db)):
    query = db.query(ExerciseSession).filter(ExerciseSession.user_id == current_user.id,
                                              ExerciseSession.ended_at.isnot(None))
    if exercise_name:
        query = query.filter(ExerciseSession.exercise_name == exercise_name)
    sessions = query.order_by(ExerciseSession.started_at.desc()).limit(50).all()
    return [{"id": s.id, "exercise_name": s.exercise_name, "category": s.category,
             "started_at": s.started_at.isoformat(),
             "ended_at": s.ended_at.isoformat() if s.ended_at else None,
             "avg_accuracy_pct": s.avg_accuracy_pct, "rep_count": s.rep_count} for s in sessions]

_detector = PoseDetector()

@app.websocket("/ws/analyze")
async def ws_analyze(websocket: WebSocket, exercise_id: str, token: str):
    username = decode_token(token)
    if not username:
        await websocket.close(code=4001); return
    await websocket.accept()
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == username).first()
        if not user:
            await websocket.close(code=4001); return
        try:
            exercise = load_exercise(exercise_id)
        except ValueError:
            await websocket.send_json({"error": f"Unknown exercise: {exercise_id}"})
            await websocket.close(code=4003); return
        ex_session = create_session(db, user.id, exercise)
        rep_number = 0
        last_processed = 0.0
        while True:
            try:
                frame_bytes = await websocket.receive_bytes()
            except WebSocketDisconnect:
                break
            now = time.time() * 1000
            if now - last_processed < 80:
                continue
            last_processed = now
            landmarks = _detector.detect(frame_bytes)
            if landmarks is None:
                await websocket.send_json({
                    "frame": base64.b64encode(frame_bytes).decode(),
                    "pose_detected": False,
                    "feedback": {"messages": ["Stand in front of the camera — no pose detected"],
                                 "accuracy_pct": 0, "status": "poor"},
                    "analysis": None, "rep_number": rep_number})
                continue
            analysis = analyze(landmarks, exercise)
            fb = generate_feedback(analysis, exercise)
            annotated = _detector.draw_skeleton(frame_bytes, landmarks, analysis["joint_colors"])
            rep_number += 1
            log_rep(db, ex_session.id, rep_number, analysis["accuracy_pct"],
                    [r["feedback"] for r in analysis["failing_rules"]])
            await websocket.send_json({
                "frame": base64.b64encode(annotated).decode(),
                "pose_detected": True,
                "analysis": {"accuracy_pct": analysis["accuracy_pct"],
                             "passing_rules": analysis["passing_rules"],
                             "failing_rules": analysis["failing_rules"],
                             "angles": analysis["angles"]},
                "feedback": fb, "rep_number": rep_number})
    except WebSocketDisconnect:
        pass
    finally:
        try:
            close_session(db, ex_session.id)
        except Exception:
            pass
        db.close()
```

---

## 9. API Reference

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | No | Create new user account |
| POST | `/auth/login` | No | Login, returns JWT |
| GET | `/auth/me` | JWT | Get current user info |
| GET | `/exercises` | No | List all 10 exercises |
| GET | `/health` | No | Server health check |
| GET | `/progress/summary` | JWT | Per-exercise accuracy aggregates |
| GET | `/progress/sessions` | JWT | Session history (filter by exercise_name) |
| WS | `/ws/analyze?exercise_id=&token=` | JWT in query | Real-time pose analysis stream |

---

## 10. WebSocket Protocol

**Client → Server:** raw binary JPEG frame bytes (640×480, ~12fps)

**Server → Client:** JSON message per processed frame:
```json
{
  "frame": "<base64 encoded annotated JPEG>",
  "pose_detected": true,
  "analysis": {
    "accuracy_pct": 78.5,
    "passing_rules": ["spine_straight"],
    "failing_rules": [
      {"id": "knee_depth", "feedback": "Squat deeper", "severity": "major", "angle": 120.3}
    ],
    "angles": {"knee_depth": 120.3, "spine_straight": 172.1}
  },
  "feedback": {
    "messages": ["Squat deeper — aim for thighs parallel to the floor"],
    "accuracy_pct": 78.5,
    "status": "needs_work"
  },
  "rep_number": 42
}
```

**Frame throttle:** 80ms minimum between processed frames (~12fps max).

---

## 11. Database Schema

```
users
  id           INTEGER PK
  username     VARCHAR(64) UNIQUE
  hashed_password VARCHAR(128)
  created_at   DATETIME

exercise_sessions
  id              INTEGER PK
  user_id         INTEGER FK → users.id
  exercise_name   VARCHAR(64)
  category        VARCHAR(32)
  started_at      DATETIME
  ended_at        DATETIME
  avg_accuracy_pct FLOAT
  rep_count       INTEGER

rep_records
  id           INTEGER PK
  session_id   INTEGER FK → exercise_sessions.id
  rep_number   INTEGER
  accuracy_pct FLOAT
  issues       TEXT  (JSON array of feedback strings)
  timestamp    DATETIME
```

---

## 12. Adding a New Exercise

1. Create `backend/exercises/<id>.json` — no code changes needed
2. Use landmark names from MediaPipe PoseLandmark enum:
   `NOSE, LEFT/RIGHT_EYE, LEFT/RIGHT_EAR, LEFT/RIGHT_SHOULDER,
    LEFT/RIGHT_ELBOW, LEFT/RIGHT_WRIST, LEFT/RIGHT_HIP,
    LEFT/RIGHT_KNEE, LEFT/RIGHT_ANKLE, LEFT/RIGHT_HEEL, LEFT/RIGHT_FOOT_INDEX`
3. The exercise appears automatically in the UI on next server start

---

*Generated: AI Posture Coach Project — Python 3.13 / MediaPipe 1.0.0 / FastAPI 0.115.0*
