/* ============================================================
   AI Posture Coach — Frontend Application (v2)
   ============================================================ */

const API    = window.location.origin;
const WS_BASE = window.location.origin.replace(/^http/, "ws");

// ── Utilities ─────────────────────────────────────────────────────────────────

function $(id) { return document.getElementById(id); }

function showView(id) {
  ["auth-view","exercise-view","camera-view","progress-view"].forEach(v =>
    $(v).classList.toggle("hidden", v !== id)
  );
}

function showHeader(visible) {
  $("app-header").classList.toggle("hidden", !visible);
}

function setNavActive(name) {
  ["exercises","progress"].forEach(n =>
    $(`btn-nav-${n}`).classList.toggle("active", n === name)
  );
}

async function apiFetch(path, options = {}) {
  const token = Auth.getToken();
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Request failed");
  }
  return res.json();
}

// ── Theme ──────────────────────────────────────────────────────────────────────

const Theme = (() => {
  const key = "posture_theme";
  function apply(mode) {
    document.body.classList.toggle("light", mode === "light");
    $("btn-theme").textContent = mode === "light" ? "🌙" : "☀️";
    localStorage.setItem(key, mode);
  }
  function toggle() {
    apply(document.body.classList.contains("light") ? "dark" : "light");
  }
  function init() { apply(localStorage.getItem(key) || "dark"); }
  return { toggle, init };
})();

// ── Voice Feedback ─────────────────────────────────────────────────────────────

const Voice = (() => {
  let _lastMsg = "";
  let _lastSpoken = 0;
  const COOLDOWN = 4000;

  function speak(msg) {
    if (!$("voice-toggle") || !$("voice-toggle").checked) return;
    if (!window.speechSynthesis) return;
    const now = Date.now();
    if (msg === _lastMsg && now - _lastSpoken < COOLDOWN) return;
    _lastMsg = msg;
    _lastSpoken = now;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(msg);
    u.rate = 1.05; u.pitch = 1; u.volume = 0.9;
    window.speechSynthesis.speak(u);
  }
  return { speak };
})();

// ── Auth ───────────────────────────────────────────────────────────────────────

const Auth = (() => {
  const TOKEN_KEY = "posture_coach_token";

  function getToken()  { return localStorage.getItem(TOKEN_KEY); }
  function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
  function clearToken(){ localStorage.removeItem(TOKEN_KEY); }

  function showTab(tab) {
    $("form-login").classList.toggle("hidden", tab !== "login");
    $("form-register").classList.toggle("hidden", tab !== "register");
    $("tab-login").classList.toggle("active", tab === "login");
    $("tab-register").classList.toggle("active", tab === "register");
    $("auth-error").textContent = "";
  }

  async function login() {
    const username = $("login-username").value.trim();
    const password = $("login-password").value;
    $("auth-error").textContent = "";
    if (!username || !password) { $("auth-error").textContent = "Please enter username and password."; return; }
    try {
      const data = await apiFetch("/auth/login", { method:"POST", body: JSON.stringify({username, password}) });
      setToken(data.access_token);
      onLoggedIn();
    } catch(e) { $("auth-error").textContent = e.message; }
  }

  async function register() {
    const username = $("reg-username").value.trim();
    const password = $("reg-password").value;
    $("auth-error").textContent = "";
    if (!username || !password) { $("auth-error").textContent = "Please fill all fields."; return; }
    try {
      await apiFetch("/auth/register", { method:"POST", body: JSON.stringify({username, password}) });
      const data = await apiFetch("/auth/login",    { method:"POST", body: JSON.stringify({username, password}) });
      setToken(data.access_token);
      onLoggedIn();
    } catch(e) { $("auth-error").textContent = e.message; }
  }

  function logout() {
    clearToken();
    showHeader(false);
    showView("auth-view");
  }

  return { getToken, login, register, logout, showTab };
})();

// ── Navigation ─────────────────────────────────────────────────────────────────

function onLoggedIn() {
  showHeader(true);
  setNavActive("exercises");
  ExerciseSelector.load();
  showView("exercise-view");
}

$("btn-nav-exercises").addEventListener("click", () => {
  setNavActive("exercises"); showView("exercise-view");
});
$("btn-nav-progress").addEventListener("click", () => {
  setNavActive("progress"); ProgressView.load(); showView("progress-view");
});
$("btn-logout").addEventListener("click", Auth.logout);
$("btn-theme").addEventListener("click", Theme.toggle);

// ── Exercise Selector ─────────────────────────────────────────────────────────

const ExerciseSelector = (() => {
  let _all = [];
  let _activeFilter = "all";

  const EMOJI = { yoga:"🧘", gym:"💪", physiotherapy:"🏥" };

  async function load() {
    try {
      _all = await apiFetch("/exercises");
      render();
    } catch(e) { console.error("Failed to load exercises", e); }
  }

  function filter(category, btn) {
    _activeFilter = category;
    document.querySelectorAll(".category-tabs button").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    render();
  }

  function render() {
    const grid = $("exercise-grid");
    const filtered = _activeFilter === "all" ? _all : _all.filter(e => e.category === _activeFilter);
    grid.innerHTML = filtered.map(ex => `
      <div class="exercise-card" onclick='CameraSession.start(${JSON.stringify(ex.id)}, ${JSON.stringify(ex)})'>
        <div class="ex-category badge-${ex.category}">${EMOJI[ex.category] || ""} ${ex.category}</div>
        <div class="ex-name">${ex.name}</div>
        <div class="ex-cues">${(ex.cues||[]).slice(0,2).map(c=>`• ${c}`).join("<br>")}</div>
        <div class="ex-arrow">→</div>
      </div>
    `).join("");
  }

  return { load, filter };
})();

// ── Camera Session ─────────────────────────────────────────────────────────────

const CameraSession = (() => {
  let _ws            = null;
  let _stream        = null;
  let _captureInterval = null;
  let _timerInterval = null;
  let _currentExercise = null;
  let _repCount      = 0;
  let _accuracySum   = 0;
  let _accuracyCount = 0;
  let _bestAccuracy  = 0;
  let _startTime     = null;
  let _lastAngles    = {};
  let _exerciseRules = [];

  // Offscreen capture canvas
  const _capture = document.createElement("canvas");
  _capture.width = 640; _capture.height = 480;
  const _captureCtx = _capture.getContext("2d");

  // Hidden video element
  const _video = document.createElement("video");
  _video.autoplay = true; _video.playsInline = true; _video.muted = true;

  // Display canvas
  const _displayCanvas = $("display-canvas");
  const _displayCtx    = _displayCanvas.getContext("2d");

  // ── Accuracy ring helpers ──────────────────────────────────────────────────
  function updateRing(pct, status) {
    const circumference = 213.6;
    const offset = circumference - (pct / 100) * circumference;
    const ring = $("ring-path");
    if (!ring) return;
    ring.style.strokeDashoffset = offset;
    ring.style.stroke = status === "good" ? "var(--good)" : status === "needs_work" ? "var(--warn)" : "var(--bad)";
  }

  // ── Session timer ──────────────────────────────────────────────────────────
  function startTimer() {
    _startTime = Date.now();
    _timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - _startTime) / 1000);
      const m = String(Math.floor(elapsed / 60)).padStart(2, "0");
      const s = String(elapsed % 60).padStart(2, "0");
      $("session-timer").textContent = `${m}:${s}`;
    }, 1000);
  }

  function stopTimer() {
    clearInterval(_timerInterval);
  }

  function getElapsedStr() {
    if (!_startTime) return "0s";
    const elapsed = Math.floor((Date.now() - _startTime) / 1000);
    if (elapsed < 60) return `${elapsed}s`;
    return `${Math.floor(elapsed/60)}m ${elapsed%60}s`;
  }

  // ── Start ──────────────────────────────────────────────────────────────────
  async function start(exerciseId, exercise) {
    _currentExercise = exercise;
    _repCount = 0; _accuracySum = 0; _accuracyCount = 0; _bestAccuracy = 0;
    _exerciseRules = exercise.rules || [];

    $("camera-title").textContent = exercise.name;
    $("session-timer").textContent = "00:00";
    $("session-summary").classList.add("hidden");
    $("btn-stop").disabled = false;
    $("canvas-overlay").classList.remove("hidden");
    $("accuracy-value").textContent = "—";
    $("accuracy-status").textContent = "Waiting…";
    $("pose-confidence").textContent = "—";
    $("angles-list").innerHTML = '<span class="muted-text">Detecting pose…</span>';
    $("feedback-list").innerHTML = '<li class="ok">Waiting for pose detection…</li>';

    $("cues-list").innerHTML = (exercise.cues||[]).map(c=>`<li class="ok">${c}</li>`).join("");

    showView("camera-view");

    // Camera
    try {
      _stream = await navigator.mediaDevices.getUserMedia({ video: { width:640, height:480, facingMode:"user" } });
      _video.srcObject = _stream;
      await _video.play();
    } catch(e) {
      alert("Camera access denied. Please allow camera permission and try again.");
      showView("exercise-view"); return;
    }

    startTimer();

    // WebSocket
    const token = Auth.getToken();
    _ws = new WebSocket(`${WS_BASE}/ws/analyze?exercise_id=${exerciseId}&token=${encodeURIComponent(token)}`);
    _ws.binaryType = "arraybuffer";

    _ws.onopen = () => {
      $("canvas-overlay").classList.add("hidden");
      _captureInterval = setInterval(sendFrame, 100); // 10fps
    };

    _ws.onmessage = (event) => {
      try { handleServerMessage(JSON.parse(event.data)); } catch(e) {}
    };

    _ws.onclose = () => {
      clearInterval(_captureInterval);
      stopTimer();
      showSummary();
    };

    _ws.onerror = (e) => console.error("WS error", e);
  }

  // ── Send frame ─────────────────────────────────────────────────────────────
  function sendFrame() {
    if (!_ws || _ws.readyState !== WebSocket.OPEN) return;
    _captureCtx.drawImage(_video, 0, 0, 640, 480);
    _capture.toBlob(blob => {
      if (blob && _ws && _ws.readyState === WebSocket.OPEN)
        blob.arrayBuffer().then(buf => _ws.send(buf));
    }, "image/jpeg", 0.8);
  }

  // ── Handle server message ──────────────────────────────────────────────────
  function handleServerMessage(data) {
    // Draw annotated frame
    if (data.frame) {
      const img = new Image();
      img.onload = () => {
        _displayCanvas.width  = img.width  || 640;
        _displayCanvas.height = img.height || 480;
        _displayCtx.drawImage(img, 0, 0);
      };
      img.src = "data:image/jpeg;base64," + data.frame;
    }

    if (data.feedback) updateFeedbackPanel(data.feedback);
    if (data.analysis) updateAnglesPanel(data.analysis);
    if (data.analysis?.accuracy_pct != null) {
      _accuracySum += data.analysis.accuracy_pct;
      _accuracyCount++;
      if (data.analysis.accuracy_pct > _bestAccuracy) _bestAccuracy = data.analysis.accuracy_pct;
    }
    if (data.rep_number) _repCount = data.rep_number;

    // Pose confidence badge
    if (data.pose_detected === false) {
      $("pose-confidence").textContent = "No pose";
      $("pose-confidence").style.color = "var(--bad)";
    } else if (data.pose_detected === true) {
      $("pose-confidence").textContent = "Pose ✓";
      $("pose-confidence").style.color = "var(--good)";
    }
  }

  // ── Feedback panel ─────────────────────────────────────────────────────────
  function updateFeedbackPanel(feedback) {
    const { messages, accuracy_pct, status } = feedback;
    const pct = accuracy_pct || 0;

    $("accuracy-value").textContent = `${Math.round(pct)}%`;
    $("accuracy-value").className = `accuracy-value status-${status}`;
    $("accuracy-bar").style.width = `${pct}%`;
    $("accuracy-bar").style.background = status === "good" ? "var(--good)" : status === "needs_work" ? "var(--warn)" : "var(--bad)";
    $("accuracy-status").textContent = status === "good" ? "Great form! 🎉" : status === "needs_work" ? "Almost there!" : "Needs improvement";
    $("accuracy-status").className = `accuracy-status status-${status}`;

    updateRing(pct, status);

    if (messages && messages.length) {
      const failRules = (CameraSession._lastAnalysis?.failing_rules || []);
      $("feedback-list").innerHTML = messages.map((m, i) => {
        const severity = failRules[i]?.severity || "minor";
        const cls = severity === "major" ? "major" : "";
        return `<li class="${cls}">${m}</li>`;
      }).join("");

      // Voice: speak first major message
      if (status !== "good" && messages[0]) Voice.speak(messages[0]);
    } else {
      $("feedback-list").innerHTML = '<li class="ok">Great form! Keep it up!</li>';
    }
  }

  // ── Angles panel ───────────────────────────────────────────────────────────
  function updateAnglesPanel(analysis) {
    CameraSession._lastAnalysis = analysis;
    const angles  = analysis.angles  || {};
    const passing = new Set(analysis.passing_rules || []);

    if (!Object.keys(angles).length) {
      $("angles-list").innerHTML = '<span class="muted-text">Detecting pose…</span>';
      return;
    }

    // Build rule name map from exercise rules
    const ruleNames = {};
    (_exerciseRules || []).forEach(r => { ruleNames[r.id] = r.id.replace(/_/g," "); });

    $("angles-list").innerHTML = Object.entries(angles).map(([ruleId, angle]) => {
      const ok  = passing.has(ruleId);
      const pct = Math.min(100, Math.max(0, angle / 180 * 100));
      const cls = ok ? "angle-ok" : "angle-fail";
      const barColor = ok ? "var(--good)" : "var(--bad)";
      const label = ruleNames[ruleId] || ruleId.replace(/_/g," ");
      return `
        <div class="angle-row">
          <span class="angle-name">${label}</span>
          <div class="angle-bar-wrap"><div class="angle-bar" style="width:${pct}%;background:${barColor}"></div></div>
          <span class="angle-val ${cls}">${angle}°</span>
        </div>`;
    }).join("");
  }

  // ── Stop ───────────────────────────────────────────────────────────────────
  function stop() {
    if (_ws && _ws.readyState === WebSocket.OPEN) _ws.close();
    clearInterval(_captureInterval);
    stopTimer();
    if (_stream) { _stream.getTracks().forEach(t => t.stop()); _stream = null; }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  function showSummary() {
    const avg  = _accuracyCount > 0 ? Math.round(_accuracySum / _accuracyCount) : 0;
    const best = Math.round(_bestAccuracy);
    const grade = avg >= 90 ? "🏆 Excellent!" : avg >= 75 ? "🥇 Great job!" : avg >= 55 ? "👍 Good effort!" : "💪 Keep practicing!";

    $("summary-accuracy").textContent = `${avg}%`;
    $("summary-accuracy").className   = `summary-stat status-${avg>=80?"good":avg>=50?"needs_work":"poor"}`;
    $("summary-reps").textContent     = _repCount;
    $("summary-best").textContent     = `${best}%`;
    $("summary-duration").textContent = getElapsedStr();
    $("summary-grade").textContent    = grade;
    $("session-summary").classList.remove("hidden");
    $("btn-stop").disabled = true;

    Voice.speak(`Session complete. Average accuracy ${avg} percent. ${grade}`);
  }

  function back() {
    stop();
    setNavActive("exercises");
    showView("exercise-view");
  }

  return { start, stop, back, _lastAnalysis: null };
})();

// ── Progress View ──────────────────────────────────────────────────────────────

const ProgressView = (() => {
  let _chart   = null;
  let _summary = [];
  let _sessions= [];

  async function load() {
    try {
      [_summary, _sessions] = await Promise.all([
        apiFetch("/progress/summary"),
        apiFetch("/progress/sessions"),
      ]);
      renderStats();
      renderChart(_summary);
      populateFilter();
      renderTable(_sessions);
    } catch(e) { console.error("Failed to load progress", e); }
  }

  function renderStats() {
    const totalSessions = _sessions.length;
    const bestAcc = _summary.length ? Math.max(..._summary.map(s => s.avg_accuracy)) : 0;
    const uniqueEx = new Set(_sessions.map(s => s.exercise_name)).size;
    const topEx = _summary.length
      ? _summary.reduce((a, b) => a.avg_accuracy > b.avg_accuracy ? a : b).exercise_name
      : "—";

    $("stat-total-sessions").textContent = totalSessions;
    $("stat-best-accuracy").textContent  = totalSessions ? `${Math.round(bestAcc)}%` : "—";
    $("stat-total-time").textContent     = uniqueEx;
    $("stat-top-exercise").textContent   = topEx.length > 12 ? topEx.split(" ")[0] : topEx;
  }

  function renderChart(summary) {
    const labels = summary.map(r => r.exercise_name);
    const data   = summary.map(r => r.avg_accuracy);
    const colors = data.map(v => v >= 80 ? "#22c55e" : v >= 50 ? "#f59e0b" : "#ef4444");
    const counts = summary.map(r => r.session_count);

    const ctx = $("progress-chart").getContext("2d");
    if (_chart) _chart.destroy();

    _chart = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: "Avg Accuracy (%)",
          data,
          backgroundColor: colors.map(c => c + "cc"),
          borderColor: colors,
          borderWidth: 2,
          borderRadius: 8,
        }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.raw}% avg accuracy`,
              afterLabel: ctx => ` ${counts[ctx.dataIndex]} session(s)`,
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true, max: 100,
            grid: { color: "rgba(46,50,68,.6)" },
            ticks: { color: "#8892a4", callback: v => v + "%" },
          },
          x: {
            grid: { display: false },
            ticks: { color: "#8892a4", maxRotation: 30 },
          },
        },
      },
    });
  }

  function populateFilter() {
    const sel = $("filter-exercise");
    const names = [...new Set(_sessions.map(s => s.exercise_name))];
    sel.innerHTML = '<option value="">All Exercises</option>' +
      names.map(n => `<option value="${n}">${n}</option>`).join("");
  }

  function filterSessions() {
    const val = $("filter-exercise").value;
    const filtered = val ? _sessions.filter(s => s.exercise_name === val) : _sessions;
    renderTable(filtered);
  }

  function renderTable(sessions) {
    const tbody = $("sessions-tbody");
    if (!sessions.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="color:var(--muted);text-align:center;padding:24px">No sessions yet — complete an exercise to see your history.</td></tr>';
      return;
    }
    tbody.innerHTML = sessions.map(s => {
      const date = s.started_at ? new Date(s.started_at).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}) : "—";
      const acc  = s.avg_accuracy_pct != null ? `${Math.round(s.avg_accuracy_pct)}%` : "—";
      const cls  = s.avg_accuracy_pct >= 80 ? "good" : s.avg_accuracy_pct >= 50 ? "needs_work" : "poor";
      const badge = { yoga:"🧘", gym:"💪", physiotherapy:"🏥" }[s.category] || "";
      return `<tr>
        <td style="font-weight:600">${s.exercise_name}</td>
        <td style="color:var(--muted)">${badge} ${s.category}</td>
        <td style="color:var(--muted)">${date}</td>
        <td class="status-${cls}" style="font-weight:700">${acc}</td>
        <td style="color:var(--muted)">${s.rep_count}</td>
      </tr>`;
    }).join("");
  }

  return { load, filterSessions };
})();

// ── Boot ───────────────────────────────────────────────────────────────────────

(function boot() {
  Theme.init();
  if (Auth.getToken()) onLoggedIn();
  ["login-username","login-password"].forEach(id =>
    $(id)?.addEventListener("keydown", e => { if (e.key === "Enter") Auth.login(); })
  );
  ["reg-username","reg-password"].forEach(id =>
    $(id)?.addEventListener("keydown", e => { if (e.key === "Enter") Auth.register(); })
  );
})();
