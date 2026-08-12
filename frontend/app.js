/* ============================================================
   AI Posture Coach — Frontend Application
   ============================================================ */

const API = window.location.origin;
const WS_BASE = window.location.origin.replace(/^http/, "ws");

// ── Utility helpers ───────────────────────────────────────────────────────────

function $(id) { return document.getElementById(id); }

function showView(id) {
  ["auth-view", "exercise-view", "camera-view", "progress-view"].forEach(v => {
    $(v).classList.toggle("hidden", v !== id);
  });
}

function showHeader(visible) {
  $("app-header").classList.toggle("hidden", !visible);
}

function setNavActive(name) {
  ["exercises", "progress"].forEach(n => {
    $(`btn-nav-${n}`).classList.toggle("active", n === name);
  });
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

// ── Auth module ───────────────────────────────────────────────────────────────

const Auth = (() => {
  const TOKEN_KEY = "posture_coach_token";

  function getToken() { return localStorage.getItem(TOKEN_KEY); }
  function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
  function clearToken() { localStorage.removeItem(TOKEN_KEY); }

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
      const data = await apiFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      setToken(data.access_token);
      onLoggedIn();
    } catch (e) {
      $("auth-error").textContent = e.message;
    }
  }

  async function register() {
    const username = $("reg-username").value.trim();
    const password = $("reg-password").value;
    $("auth-error").textContent = "";
    if (!username || !password) { $("auth-error").textContent = "Please fill all fields."; return; }
    try {
      await apiFetch("/auth/register", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      // Auto-login after registration
      const data = await apiFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      setToken(data.access_token);
      onLoggedIn();
    } catch (e) {
      $("auth-error").textContent = e.message;
    }
  }

  function logout() {
    clearToken();
    showHeader(false);
    showView("auth-view");
  }

  return { getToken, login, register, logout, showTab };
})();

// ── Navigation ────────────────────────────────────────────────────────────────

function onLoggedIn() {
  showHeader(true);
  setNavActive("exercises");
  ExerciseSelector.load();
  showView("exercise-view");
}

$("btn-nav-exercises").addEventListener("click", () => {
  setNavActive("exercises");
  showView("exercise-view");
});

$("btn-nav-progress").addEventListener("click", () => {
  setNavActive("progress");
  ProgressView.load();
  showView("progress-view");
});

$("btn-logout").addEventListener("click", Auth.logout);

// ── Exercise Selector ─────────────────────────────────────────────────────────

const ExerciseSelector = (() => {
  let _all = [];
  let _activeFilter = "all";

  async function load() {
    try {
      _all = await apiFetch("/exercises");
      render();
    } catch (e) {
      console.error("Failed to load exercises", e);
    }
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
      <div class="exercise-card" onclick="CameraSession.start('${ex.id}', ${JSON.stringify(ex).replace(/"/g, '&quot;')})">
        <div class="ex-category badge-${ex.category}">${ex.category}</div>
        <div class="ex-name">${ex.name}</div>
        <div class="ex-cues">${(ex.cues || []).slice(0, 2).map(c => `• ${c}`).join("<br>")}</div>
      </div>
    `).join("");
  }

  return { load, filter };
})();

// ── Camera Session ────────────────────────────────────────────────────────────

const CameraSession = (() => {
  let _ws = null;
  let _stream = null;
  let _captureInterval = null;
  let _currentExercise = null;
  let _repCount = 0;
  let _accuracySum = 0;
  let _accuracyCount = 0;

  // Offscreen canvas used to capture frames from the video element
  const _capture = document.createElement("canvas");
  _capture.width = 640;
  _capture.height = 480;
  const _ctx = _capture.getContext("2d");

  // Hidden video element for getUserMedia
  const _video = document.createElement("video");
  _video.autoplay = true;
  _video.playsInline = true;
  _video.muted = true;

  // Display canvas
  const _displayCanvas = $("display-canvas");
  const _displayCtx = _displayCanvas.getContext("2d");

  async function start(exerciseId, exercise) {
    _currentExercise = exercise;
    _repCount = 0;
    _accuracySum = 0;
    _accuracyCount = 0;

    $("camera-title").textContent = exercise.name;
    $("session-summary").classList.add("hidden");
    $("btn-stop").disabled = false;

    // Populate exercise cues
    $("cues-list").innerHTML = (exercise.cues || [])
      .map(c => `<li class="ok">${c}</li>`).join("");

    showView("camera-view");

    // Request camera
    try {
      _stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      _video.srcObject = _stream;
      await _video.play();
    } catch (e) {
      alert("Camera access denied. Please allow camera permission and try again.");
      showView("exercise-view");
      return;
    }

    // Connect WebSocket
    const token = Auth.getToken();
    const wsUrl = `${WS_BASE}/ws/analyze?exercise_id=${exerciseId}&token=${encodeURIComponent(token)}`;
    _ws = new WebSocket(wsUrl);
    _ws.binaryType = "arraybuffer";

    _ws.onopen = () => {
      // Start sending frames at ~12fps
      _captureInterval = setInterval(sendFrame, 83);
    };

    _ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleServerMessage(data);
      } catch (e) { /* ignore malformed */ }
    };

    _ws.onclose = () => {
      clearInterval(_captureInterval);
      showSummary();
    };

    _ws.onerror = (e) => {
      console.error("WebSocket error", e);
    };
  }

  function sendFrame() {
    if (!_ws || _ws.readyState !== WebSocket.OPEN) return;
    _ctx.drawImage(_video, 0, 0, 640, 480);
    _capture.toBlob(blob => {
      if (blob && _ws.readyState === WebSocket.OPEN) {
        blob.arrayBuffer().then(buf => _ws.send(buf));
      }
    }, "image/jpeg", 0.8);
  }

  function handleServerMessage(data) {
    // Draw annotated frame onto display canvas
    if (data.frame) {
      const img = new Image();
      img.onload = () => {
        _displayCanvas.width = img.width || 640;
        _displayCanvas.height = img.height || 480;
        _displayCtx.drawImage(img, 0, 0);
      };
      img.src = "data:image/jpeg;base64," + data.frame;
    }

    if (data.feedback) {
      updateFeedbackPanel(data.feedback);
    }

    if (data.analysis && data.analysis.accuracy_pct !== undefined) {
      _accuracySum += data.analysis.accuracy_pct;
      _accuracyCount++;
    }

    if (data.rep_number) _repCount = data.rep_number;
  }

  function updateFeedbackPanel(feedback) {
    const { messages, accuracy_pct, status } = feedback;

    // Accuracy value
    const accEl = $("accuracy-value");
    accEl.textContent = accuracy_pct != null ? `${Math.round(accuracy_pct)}%` : "—";
    accEl.className = `accuracy-value status-${status || "poor"}`;

    // Accuracy bar
    const bar = $("accuracy-bar");
    bar.style.width = `${accuracy_pct || 0}%`;
    bar.style.background = status === "good" ? "var(--good)" : status === "needs_work" ? "var(--warn)" : "var(--bad)";

    // Messages
    const list = $("feedback-list");
    if (messages && messages.length) {
      list.innerHTML = messages.map(m =>
        `<li>${m}</li>`
      ).join("");
    }
  }

  function stop() {
    if (_ws && _ws.readyState === WebSocket.OPEN) {
      _ws.close();
    }
    clearInterval(_captureInterval);
    if (_stream) {
      _stream.getTracks().forEach(t => t.stop());
      _stream = null;
    }
  }

  function showSummary() {
    const avg = _accuracyCount > 0 ? Math.round(_accuracySum / _accuracyCount) : 0;
    $("summary-accuracy").textContent = `${avg}%`;
    $("summary-accuracy").className = `summary-stat status-${avg >= 80 ? "good" : avg >= 50 ? "needs_work" : "poor"}`;
    $("summary-reps").textContent = _repCount;
    $("session-summary").classList.remove("hidden");
    $("btn-stop").disabled = true;
  }

  function back() {
    stop();
    setNavActive("exercises");
    showView("exercise-view");
  }

  return { start, stop, back };
})();

// ── Progress View ──────────────────────────────────────────────────────────────

const ProgressView = (() => {
  let _chart = null;

  async function load() {
    try {
      const [summary, sessions] = await Promise.all([
        apiFetch("/progress/summary"),
        apiFetch("/progress/sessions"),
      ]);
      renderChart(summary);
      renderTable(sessions);
    } catch (e) {
      console.error("Failed to load progress", e);
    }
  }

  function renderChart(summary) {
    const labels = summary.map(r => r.exercise_name);
    const data = summary.map(r => r.avg_accuracy);
    const colors = data.map(v => v >= 80 ? "#22c55e" : v >= 50 ? "#f59e0b" : "#ef4444");

    const ctx = $("progress-chart").getContext("2d");
    if (_chart) _chart.destroy();

    _chart = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: "Avg Accuracy (%)",
          data,
          backgroundColor: colors,
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true,
        scales: {
          y: {
            beginAtZero: true, max: 100,
            grid: { color: "#2e3244" },
            ticks: { color: "#8892a4" },
          },
          x: {
            grid: { display: false },
            ticks: { color: "#8892a4" },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.raw}% avg accuracy`,
            },
          },
        },
      },
    });
  }

  function renderTable(sessions) {
    const tbody = $("sessions-tbody");
    if (!sessions.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="color:var(--muted);text-align:center;padding:20px">No sessions yet — complete an exercise to see your history.</td></tr>';
      return;
    }
    tbody.innerHTML = sessions.map(s => {
      const date = s.started_at ? new Date(s.started_at).toLocaleDateString() : "—";
      const acc = s.avg_accuracy_pct != null ? `${Math.round(s.avg_accuracy_pct)}%` : "—";
      const cls = s.avg_accuracy_pct >= 80 ? "good" : s.avg_accuracy_pct >= 50 ? "needs_work" : "poor";
      return `<tr>
        <td>${s.exercise_name}</td>
        <td style="color:var(--muted)">${s.category}</td>
        <td style="color:var(--muted)">${date}</td>
        <td class="status-${cls}">${acc}</td>
        <td style="color:var(--muted)">${s.rep_count}</td>
      </tr>`;
    }).join("");
  }

  return { load };
})();

// ── Boot ──────────────────────────────────────────────────────────────────────

(function boot() {
  if (Auth.getToken()) {
    onLoggedIn();
  }
  // Allow Enter key on auth forms
  ["login-username", "login-password"].forEach(id => {
    $(id) && $(id).addEventListener("keydown", e => { if (e.key === "Enter") Auth.login(); });
  });
  ["reg-username", "reg-password"].forEach(id => {
    $(id) && $(id).addEventListener("keydown", e => { if (e.key === "Enter") Auth.register(); });
  });
})();
