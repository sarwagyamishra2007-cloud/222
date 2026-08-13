import json
import os
import sys
import time
from datetime import datetime, timedelta

# Ensure backend/ is on sys.path regardless of working directory
_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _BACKEND_DIR)

from dotenv import load_dotenv
load_dotenv()

from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import func, desc
from sqlalchemy.orm import Session

from auth import create_access_token, decode_token, get_current_user, hash_password, verify_password
from database import Base, engine, get_db, SessionLocal
from exercise_loader import list_exercises, load_exercise
from feedback import generate_feedback
from models import ExerciseSession, RepRecord, User
from pose_detector import PoseDetector
from posture_analyzer import analyze, compute_symmetry
from session_logger import close_session, create_session, log_rep

# ── DB init ───────────────────────────────────────────────────────────────────
Base.metadata.create_all(bind=engine)

app = FastAPI(title="AI Posture Coach", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Static frontend ───────────────────────────────────────────────────────────
_frontend_dir = os.path.abspath(os.path.join(_BACKEND_DIR, "..", "frontend"))
if os.path.isdir(_frontend_dir):
    app.mount("/static", StaticFiles(directory=_frontend_dir), name="static")


@app.get("/", include_in_schema=False)
def serve_index():
    index_path = os.path.join(_frontend_dir, "index.html")
    if os.path.isfile(index_path):
        return FileResponse(index_path)
    return JSONResponse({"message": "AI Posture Coach API v2"})


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
    rows = (
        db.query(
            ExerciseSession.exercise_name,
            ExerciseSession.category,
            func.count(ExerciseSession.id).label("session_count"),
            func.avg(ExerciseSession.avg_accuracy_pct).label("avg_accuracy"),
            func.max(ExerciseSession.avg_accuracy_pct).label("best_accuracy"),
            func.max(ExerciseSession.ended_at).label("last_session"),
        )
        .filter(ExerciseSession.user_id == current_user.id, ExerciseSession.ended_at.isnot(None))
        .group_by(ExerciseSession.exercise_name, ExerciseSession.category)
        .all()
    )
    return [
        {
            "exercise_name": r.exercise_name,
            "category": r.category,
            "session_count": r.session_count,
            "avg_accuracy": round(r.avg_accuracy or 0, 1),
            "best_accuracy": round(r.best_accuracy or 0, 1),
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


# ── 🔥 UNIQUE FEATURE 1: Streak tracker ───────────────────────────────────────
@app.get("/progress/streak")
def get_streak(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Returns the user's current daily streak, longest streak, and a
    calendar heatmap of activity for the last 90 days.
    """
    sessions = (
        db.query(ExerciseSession.started_at)
        .filter(ExerciseSession.user_id == current_user.id, ExerciseSession.ended_at.isnot(None))
        .all()
    )
    if not sessions:
        return {"current_streak": 0, "longest_streak": 0, "heatmap": [], "total_days": 0}

    # Build set of unique active days
    active_days = sorted({s.started_at.date() for s in sessions}, reverse=True)
    today = datetime.utcnow().date()

    # Current streak
    current_streak = 0
    check = today
    for day in active_days:
        if day == check or day == check - timedelta(days=1):
            current_streak += 1
            check = day
        elif day < check - timedelta(days=1):
            break

    # Longest streak
    longest = 1
    run = 1
    sorted_days = sorted(active_days)
    for i in range(1, len(sorted_days)):
        if (sorted_days[i] - sorted_days[i-1]).days == 1:
            run += 1
            longest = max(longest, run)
        else:
            run = 1

    # Last 90-day heatmap (date -> session count)
    heatmap = {}
    cutoff = today - timedelta(days=89)
    for day in active_days:
        if day >= cutoff:
            heatmap[day.isoformat()] = heatmap.get(day.isoformat(), 0) + 1

    return {
        "current_streak": current_streak,
        "longest_streak": longest,
        "heatmap": [{"date": k, "count": v} for k, v in sorted(heatmap.items())],
        "total_days": len(active_days),
    }


# ── 🏆 UNIQUE FEATURE 2: Personal bests per exercise ─────────────────────────
@app.get("/progress/personal-bests")
def personal_bests(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Returns all-time personal best accuracy for each exercise,
    plus the date it was achieved and improvement trend.
    """
    rows = (
        db.query(
            ExerciseSession.exercise_name,
            ExerciseSession.category,
            func.max(ExerciseSession.avg_accuracy_pct).label("best"),
            func.min(ExerciseSession.avg_accuracy_pct).label("first"),
            func.count(ExerciseSession.id).label("attempts"),
        )
        .filter(ExerciseSession.user_id == current_user.id, ExerciseSession.ended_at.isnot(None))
        .group_by(ExerciseSession.exercise_name, ExerciseSession.category)
        .all()
    )

    result = []
    for r in rows:
        # Get date of best session
        best_session = (
            db.query(ExerciseSession)
            .filter(
                ExerciseSession.user_id == current_user.id,
                ExerciseSession.exercise_name == r.exercise_name,
                ExerciseSession.avg_accuracy_pct == r.best,
            )
            .order_by(desc(ExerciseSession.ended_at))
            .first()
        )
        improvement = round((r.best or 0) - (r.first or 0), 1)
        result.append({
            "exercise_name": r.exercise_name,
            "category": r.category,
            "best_accuracy": round(r.best or 0, 1),
            "improvement": improvement,
            "attempts": r.attempts,
            "achieved_on": best_session.ended_at.isoformat() if best_session and best_session.ended_at else None,
            "badge": "🥇" if (r.best or 0) >= 90 else "🥈" if (r.best or 0) >= 75 else "🥉" if (r.best or 0) >= 60 else "💪",
        })

    return sorted(result, key=lambda x: x["best_accuracy"], reverse=True)


# ── 💡 UNIQUE FEATURE 3: AI Coach tip of the day ─────────────────────────────
@app.get("/coach/tip")
def coach_tip(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Analyses the user's weakest exercise and returns a targeted tip.
    No LLM required — pure logic-based personalised coaching.
    """
    rows = (
        db.query(
            ExerciseSession.exercise_name,
            ExerciseSession.category,
            func.avg(ExerciseSession.avg_accuracy_pct).label("avg_acc"),
            func.count(ExerciseSession.id).label("cnt"),
        )
        .filter(ExerciseSession.user_id == current_user.id, ExerciseSession.ended_at.isnot(None))
        .group_by(ExerciseSession.exercise_name, ExerciseSession.category)
        .order_by(func.avg(ExerciseSession.avg_accuracy_pct))
        .limit(1)
        .first()
    )

    # Most common issue from rep records
    if rows:
        reps = (
            db.query(RepRecord.issues)
            .join(ExerciseSession, RepRecord.session_id == ExerciseSession.id)
            .filter(
                ExerciseSession.user_id == current_user.id,
                ExerciseSession.exercise_name == rows.exercise_name,
                RepRecord.issues.isnot(None),
            )
            .limit(100)
            .all()
        )
        issue_counts: dict[str, int] = {}
        for rep in reps:
            try:
                issues = json.loads(rep.issues or "[]")
                for issue in issues:
                    issue_counts[issue] = issue_counts.get(issue, 0) + 1
            except Exception:
                pass

        top_issue = max(issue_counts, key=issue_counts.get) if issue_counts else None

        TIPS = {
            "yoga": "Try practising in front of a mirror to align your body before the camera session.",
            "gym": "Warm up your joints for 2 minutes before each gym exercise to improve range of motion.",
            "physiotherapy": "Breathe steadily throughout — holding your breath tenses muscles and reduces joint range.",
        }
        category_tip = TIPS.get(rows.category, "Consistency beats intensity — short daily sessions build muscle memory fast.")

        return {
            "focus_exercise": rows.exercise_name,
            "avg_accuracy": round(rows.avg_acc or 0, 1),
            "top_issue": top_issue,
            "tip": f"Your weakest exercise is {rows.exercise_name} ({round(rows.avg_acc or 0, 1)}% avg). {category_tip}",
            "emoji": "💡",
        }

    return {
        "focus_exercise": None,
        "tip": "Complete your first exercise session to unlock personalised coaching tips!",
        "emoji": "🚀",
    }


# ── 📊 UNIQUE FEATURE 4: Accuracy trend over time ────────────────────────────
@app.get("/progress/trend")
def accuracy_trend(
    exercise_name: str = None,
    days: int = 30,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Returns daily average accuracy for chart trend line."""
    cutoff = datetime.utcnow() - timedelta(days=days)
    query = db.query(ExerciseSession).filter(
        ExerciseSession.user_id == current_user.id,
        ExerciseSession.ended_at.isnot(None),
        ExerciseSession.started_at >= cutoff,
    )
    if exercise_name:
        query = query.filter(ExerciseSession.exercise_name == exercise_name)
    sessions = query.order_by(ExerciseSession.started_at).all()

    # Group by day
    by_day: dict[str, list[float]] = {}
    for s in sessions:
        day = s.started_at.date().isoformat()
        if s.avg_accuracy_pct is not None:
            by_day.setdefault(day, []).append(s.avg_accuracy_pct)

    return [
        {"date": day, "avg_accuracy": round(sum(vals) / len(vals), 1), "sessions": len(vals)}
        for day, vals in sorted(by_day.items())
    ]


# ── WebSocket: real-time pose analysis ───────────────────────────────────────
_detector: PoseDetector = None

def _get_detector() -> PoseDetector:
    global _detector
    if _detector is None:
        _detector = PoseDetector()
    return _detector


@app.websocket("/ws/analyze")
async def ws_analyze(websocket: WebSocket, exercise_id: str, token: str):
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

        try:
            exercise = load_exercise(exercise_id)
        except ValueError:
            await websocket.send_json({"error": f"Unknown exercise: {exercise_id}"})
            await websocket.close(code=4003)
            return

        ex_session = create_session(db, user.id, exercise)
        rep_number = 0
        last_processed = 0.0
        _THROTTLE_MS = 80  # ~12fps analysis — display is handled client-side at 60fps

        # Smoothing buffer for accuracy (rolling avg over last 5 frames)
        accuracy_buffer: list[float] = []

        while True:
            try:
                frame_bytes = await websocket.receive_bytes()
            except WebSocketDisconnect:
                break

            now = time.time() * 1000
            if now - last_processed < _THROTTLE_MS:
                continue
            last_processed = now

            landmarks = _get_detector().detect(frame_bytes)

            if landmarks is None:
                await websocket.send_json({
                    "pose_detected": False,
                    "feedback": {"messages": ["Stand in front of the camera — no pose detected"], "accuracy_pct": 0, "status": "poor"},
                    "analysis": None,
                    "rep_number": rep_number,
                    "symmetry": None,
                    "landmarks": None,
                })
                continue

            analysis = analyze(landmarks, exercise)
            fb = generate_feedback(analysis, exercise)

            # Smooth accuracy over rolling window
            accuracy_buffer.append(analysis["accuracy_pct"])
            if len(accuracy_buffer) > 5:
                accuracy_buffer.pop(0)
            smoothed_accuracy = round(sum(accuracy_buffer) / len(accuracy_buffer), 1)

            # Compute left/right body symmetry score
            symmetry = compute_symmetry(landmarks)

            rep_number += 1
            log_rep(db, ex_session.id, rep_number, smoothed_accuracy, [r["feedback"] for r in analysis["failing_rules"]])

            # Send landmarks as normalized coords — client draws skeleton (no server frame encode)
            lm_payload = {
                name: {"x": pt["x"], "y": pt["y"], "visibility": pt["visibility"]}
                for name, pt in landmarks.items()
            }

            await websocket.send_json({
                "pose_detected": True,
                "landmarks": lm_payload,
                "joint_colors": analysis["joint_colors"],
                "analysis": {
                    "accuracy_pct": smoothed_accuracy,
                    "raw_accuracy_pct": analysis["accuracy_pct"],
                    "passing_rules": analysis["passing_rules"],
                    "failing_rules": analysis["failing_rules"],
                    "angles": analysis["angles"],
                    "rule_scores": analysis.get("rule_scores", {}),
                },
                "feedback": {**fb, "accuracy_pct": smoothed_accuracy},
                "rep_number": rep_number,
                "symmetry": symmetry,
            })

    except WebSocketDisconnect:
        pass
    finally:
        try:
            close_session(db, ex_session.id)
        except Exception:
            pass
        db.close()
