import json
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from models import ExerciseSession, RepRecord


def create_session(db: Session, user_id: int, exercise: dict[str, Any]) -> ExerciseSession:
    """Create and persist a new exercise session row."""
    session = ExerciseSession(
        user_id=user_id,
        exercise_name=exercise["name"],
        category=exercise["category"],
        started_at=datetime.utcnow(),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def log_rep(
    db: Session,
    session_id: int,
    rep_number: int,
    accuracy_pct: float,
    issues: list[str],
) -> RepRecord:
    """Append a rep record to an existing session."""
    record = RepRecord(
        session_id=session_id,
        rep_number=rep_number,
        accuracy_pct=accuracy_pct,
        issues=json.dumps(issues),
        timestamp=datetime.utcnow(),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def close_session(db: Session, session_id: int) -> ExerciseSession:
    """
    Mark the session as ended. Compute avg_accuracy_pct and rep_count from stored RepRecords.
    """
    session = db.query(ExerciseSession).filter(ExerciseSession.id == session_id).first()
    if not session:
        return None

    reps = db.query(RepRecord).filter(RepRecord.session_id == session_id).all()
    session.ended_at = datetime.utcnow()
    session.rep_count = len(reps)
    if reps:
        session.avg_accuracy_pct = round(sum(r.accuracy_pct for r in reps) / len(reps), 1)
    else:
        session.avg_accuracy_pct = 0.0

    db.commit()
    db.refresh(session)
    return session
