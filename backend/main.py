import base64
import os
import sys
import time

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

# ── DB init ───────────────────────────────────────────────────────────────────
Base.metadata.create_all(bind=engine)

app = FastAPI(title="AI Posture Coach", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Static frontend ───────────────────────────────────────────────────────────
_frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend")

if os.path.isdir(_frontend_dir):
    app.mount("/static", StaticFiles(directory=_frontend_dir), name="static")


@app.get("/", include_in_schema=False)
def serve_index():
    index_path = os.path.join(_frontend_dir, "index.html")
    if os.path.isfile(index_path):
        return FileResponse(index_path)
    return JSONResponse({"message": "AI Posture Coach API"})


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    username: str
    password: str


class LoginRequest(BaseModel):
    username: str
    password: str


# ── Auth routes ───────────────────────────────────────────────────────────────

@app.post("/auth/register", status_code=201)
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    if db.query(User).filter(User.username == req.username).first():
        raise HTTPException(status_code=400, detail="Username already taken")
    if len(req.password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")
    user = User(username=req.username, hashed_password=hash_password(req.password))
    db.add(user)
    db.commit()
    db.refresh(user)
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


# ── Exercise catalogue ────────────────────────────────────────────────────────

@app.get("/exercises")
def get_exercises():
    return list_exercises()


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


# ── Progress routes ───────────────────────────────────────────────────────────

@app.get("/progress/summary")
def progress_summary(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Return per-exercise aggregated stats for the current user."""
    rows = (
        db.query(
            ExerciseSession.exercise_name,
            ExerciseSession.category,
            func.count(ExerciseSession.id).label("session_count"),
            func.avg(ExerciseSession.avg_accuracy_pct).label("avg_accuracy"),
            func.max(ExerciseSession.ended_at).label("last_session"),
        )
        .filter(
            ExerciseSession.user_id == current_user.id,
            ExerciseSession.ended_at.isnot(None),
        )
        .group_by(ExerciseSession.exercise_name, ExerciseSession.category)
        .all()
    )
    return [
        {
            "exercise_name": r.exercise_name,
            "category": r.category,
            "session_count": r.session_count,
            "avg_accuracy": round(r.avg_accuracy or 0, 1),
            "last_session": r.last_session.isoformat() if r.last_session else None,
        }
        for r in rows
    ]


@app.get("/progress/sessions")
def progress_sessions(
    exercise_name: str = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return list of sessions (optionally filtered by exercise name) with accuracy per session."""
    query = db.query(ExerciseSession).filter(
        ExerciseSession.user_id == current_user.id,
        ExerciseSession.ended_at.isnot(None),
    )
    if exercise_name:
        query = query.filter(ExerciseSession.exercise_name == exercise_name)
    sessions = query.order_by(ExerciseSession.started_at.desc()).limit(50).all()
    return [
        {
            "id": s.id,
            "exercise_name": s.exercise_name,
            "category": s.category,
            "started_at": s.started_at.isoformat(),
            "ended_at": s.ended_at.isoformat() if s.ended_at else None,
            "avg_accuracy_pct": s.avg_accuracy_pct,
            "rep_count": s.rep_count,
        }
        for s in sessions
    ]


# ── WebSocket: real-time pose analysis ───────────────────────────────────────

# One shared PoseDetector instance (MediaPipe is not thread-safe; WS runs in single event loop)
_detector = PoseDetector()


@app.websocket("/ws/analyze")
async def ws_analyze(websocket: WebSocket, exercise_id: str, token: str):
    """
    Binary WebSocket endpoint.
    Client sends raw JPEG frame bytes; server responds with JSON:
      { frame: <base64 JPEG>, analysis: {...}, feedback: {...}, rep_number: int }
    """
    # Authenticate
    username = decode_token(token)
    if not username:
        await websocket.close(code=4001)
        return

    await websocket.accept()

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == username).first()
        if not user:
            await websocket.close(code=4001)
            return

        # Load exercise config
        try:
            exercise = load_exercise(exercise_id)
        except ValueError:
            await websocket.send_json({"error": f"Unknown exercise: {exercise_id}"})
            await websocket.close(code=4003)
            return

        # Create session record
        ex_session = create_session(db, user.id, exercise)
        rep_number = 0
        last_processed = 0.0
        _THROTTLE_MS = 80  # skip frames faster than this

        while True:
            try:
                frame_bytes = await websocket.receive_bytes()
            except WebSocketDisconnect:
                break

            now = time.time() * 1000
            if now - last_processed < _THROTTLE_MS:
                # Return cached minimal ack to avoid stalling client
                continue
            last_processed = now

            # Detect pose
            landmarks = _detector.detect(frame_bytes)

            if landmarks is None:
                await websocket.send_json({
                    "frame": base64.b64encode(frame_bytes).decode(),
                    "pose_detected": False,
                    "feedback": {"messages": ["Stand in front of the camera — no pose detected"], "accuracy_pct": 0, "status": "poor"},
                    "analysis": None,
                    "rep_number": rep_number,
                })
                continue

            # Analyze posture
            analysis = analyze(landmarks, exercise)
            fb = generate_feedback(analysis, exercise)

            # Draw annotated skeleton
            annotated = _detector.draw_skeleton(frame_bytes, landmarks, analysis["joint_colors"])
            frame_b64 = base64.b64encode(annotated).decode()

            rep_number += 1
            log_rep(
                db,
                ex_session.id,
                rep_number,
                analysis["accuracy_pct"],
                [r["feedback"] for r in analysis["failing_rules"]],
            )

            await websocket.send_json({
                "frame": frame_b64,
                "pose_detected": True,
                "analysis": {
                    "accuracy_pct": analysis["accuracy_pct"],
                    "passing_rules": analysis["passing_rules"],
                    "failing_rules": analysis["failing_rules"],
                    "angles": analysis["angles"],
                },
                "feedback": fb,
                "rep_number": rep_number,
            })

    except WebSocketDisconnect:
        pass
    finally:
        # Finalize session
        try:
            closed = close_session(db, ex_session.id)
        except Exception:
            pass
        db.close()
