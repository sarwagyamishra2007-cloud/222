# AI Posture Coach

A browser-based AI system that uses your webcam to analyze body posture during yoga,
gym exercises, and physiotherapy movements, and provides real-time corrective feedback.

> **Disclaimer:** This system provides fitness and movement guidance only. It does **not**
> diagnose medical conditions and is **not** a substitute for a qualified physiotherapist,
> personal trainer, or doctor. Stop any exercise immediately if you feel pain or discomfort.

---

## Features

- 🎥 **Real-time pose detection** via MediaPipe Pose (33-landmark model)
- 🦴 **Skeleton overlay** with color-coded joints (green = correct, red = needs correction)
- 💬 **Live text feedback** — up to 3 prioritized corrective cues per frame
- 📊 **Accuracy score** with color-coded bar (green ≥ 80 %, yellow 50–79 %, red < 50 %)
- 👤 **User accounts** (register / login) with JWT authentication
- 📈 **Progress dashboard** — historical accuracy per exercise with bar chart + session table
- 10 built-in exercises: 5 yoga, 3 gym, 2 physiotherapy

---

## Exercise Library

| ID | Name | Category |
|----|------|----------|
| `warrior_ii` | Warrior II | Yoga |
| `tree_pose` | Tree Pose | Yoga |
| `mountain_pose` | Mountain Pose | Yoga |
| `chair_pose` | Chair Pose | Yoga |
| `cobra_pose` | Cobra Pose | Yoga |
| `squat` | Squat | Gym |
| `plank` | Plank | Gym |
| `deadlift` | Deadlift | Gym |
| `shoulder_roll` | Shoulder Roll | Physiotherapy |
| `hip_hinge` | Hip Hinge | Physiotherapy |

Each exercise is defined by a declarative JSON rule file in `backend/exercises/`. Joint angle
ranges are based on widely cited exercise biomechanics references and are intended as approximate
reference values for fitness guidance only.

---

## Prerequisites

- Python 3.10 or 3.11
- A webcam
- Modern browser (Chrome or Edge recommended for best WebRTC support)

---

## Installation

```bash
# 1. Clone / download the project
cd posture-coach

# 2. Create a virtual environment
python -m venv venv

# On Windows:
venv\Scripts\activate

# On macOS/Linux:
source venv/bin/activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Copy environment file
copy .env.example .env        # Windows
cp .env.example .env          # macOS/Linux

# 5. Edit .env and set a secure SECRET_KEY
```

---

## Running the App

```bash
# From the posture-coach/ directory, run from inside backend/
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Open your browser at **http://localhost:8000**

---

## Usage Guide

1. **Register** a new account or **Login** with existing credentials
2. Select a **category** tab (All / Yoga / Gym / Physiotherapy)
3. Click an **exercise card** to start a session
4. **Allow camera access** when prompted
5. Perform the exercise — the skeleton overlay and feedback panel update in real time
   - **Green joints** = correctly aligned
   - **Red joints** = need correction
   - Up to 3 corrective cues appear in the feedback panel
6. Click **Stop Session** when done — a summary card shows your average accuracy
7. Visit the **Progress** tab to see your accuracy history across all exercises

---

## Project Structure

```
posture-coach/
├── backend/
│   ├── main.py               # FastAPI app — auth, exercises, WebSocket, progress routes
│   ├── auth.py               # JWT + bcrypt auth helpers
│   ├── database.py           # SQLAlchemy engine + session factory
│   ├── models.py             # ORM: User, ExerciseSession, RepRecord
│   ├── pose_detector.py      # MediaPipe Pose wrapper + skeleton drawing
│   ├── posture_analyzer.py   # Angle computation + rule evaluation engine
│   ├── feedback.py           # Feedback message generator
│   ├── session_logger.py     # Session & rep persistence helpers
│   ├── exercise_loader.py    # Load exercise configs from JSON files
│   └── exercises/            # One JSON rule file per exercise
├── frontend/
│   ├── index.html            # Single-page app
│   ├── app.js                # Auth, exercise selector, camera session, progress
│   └── style.css             # Dark theme UI
├── requirements.txt
├── .env.example
└── README.md
```

---

## Adding a New Exercise

1. Create `backend/exercises/<exercise_id>.json` following the schema:

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
      "feedback_fail": "Corrective message shown when angle is outside range",
      "feedback_ok": "Positive message when angle is in range"
    }
  ]
}
```

2. The exercise appears automatically in the UI — no code changes required.

Available landmark names: `NOSE`, `LEFT_SHOULDER`, `RIGHT_SHOULDER`, `LEFT_ELBOW`,
`RIGHT_ELBOW`, `LEFT_WRIST`, `RIGHT_WRIST`, `LEFT_HIP`, `RIGHT_HIP`, `LEFT_KNEE`,
`RIGHT_KNEE`, `LEFT_ANKLE`, `RIGHT_ANKLE`, `LEFT_EAR`, `RIGHT_EAR`, and more.
Full list: https://developers.google.com/mediapipe/solutions/vision/pose_landmarker

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `SECRET_KEY` | `dev-secret-key-change-me` | JWT signing key — **change in production** |
| `DATABASE_URL` | `sqlite:///./posture_coach.db` | SQLAlchemy database URL |
| `TOKEN_EXPIRE_MINUTES` | `60` | JWT token validity in minutes |

---

## Deploying to GitHub + Render (free tier)

### Step 1 — Install prerequisites
- **Git**: https://git-scm.com/download/win
- **GitHub CLI**: https://cli.github.com/

### Step 2 — Authenticate GitHub CLI
```powershell
gh auth login
```

### Step 3 — Push to GitHub
Run these commands from inside the `posture-coach/` folder:

```powershell
git init
git add .
git commit -m "Initial commit: AI Posture Coach"

# Creates a public GitHub repo and pushes in one step
gh repo create posture-coach --public --source=. --remote=origin --push
```

### Step 4 — Deploy on Render (free)
1. Go to **https://render.com** → **New** → **Web Service**
2. Connect your GitHub account and select the `posture-coach` repo
3. Render auto-detects `render.yaml` — all settings are pre-configured
4. Click **Create Web Service** — your app will be live at `https://posture-coach.onrender.com`

> **Note:** The free Render tier spins down after 15 minutes of inactivity. The first request
> after idle may take ~30 seconds to cold-start.

> **Note:** SQLite is ephemeral on Render's free tier — the database resets on each deploy.
> For persistent data, upgrade to a paid plan and set `DATABASE_URL` to a PostgreSQL URL.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11, FastAPI, Uvicorn |
| Pose Detection | MediaPipe Pose |
| Image Processing | OpenCV (headless) |
| Database | SQLite via SQLAlchemy 2.0 |
| Auth | JWT (python-jose) + bcrypt (passlib) |
| Frontend | Vanilla JS, Canvas API |
| Charts | Chart.js 4 |
