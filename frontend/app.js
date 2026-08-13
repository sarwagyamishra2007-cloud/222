/* ============================================================
   AI Posture Coach — Frontend v3 (Unique Features Edition)
   ============================================================ */

const API     = window.location.origin;
const WS_BASE = window.location.origin.replace(/^http/, "ws");

// ── Utilities ─────────────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function showView(id) {
  ["auth-view","exercise-view","camera-view","progress-view","coach-view"].forEach(v =>
    $(v).classList.toggle("hidden", v !== id)
  );
}
function showHeader(v) { $("app-header").classList.toggle("hidden", !v); }
function setNavActive(n) {
  ["exercises","progress","coach"].forEach(k =>
    $(`btn-nav-${k}`)?.classList.toggle("active", k === n)
  );
}
async function apiFetch(path, opts = {}) {
  const token = Auth.getToken();
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { ...opts, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Request failed");
  }
  return res.json();
}

// ── Theme ──────────────────────────────────────────────────────────────────────
const Theme = (() => {
  const KEY = "posture_theme";
  function apply(m) { document.body.classList.toggle("light", m === "light"); $("btn-theme").textContent = m === "light" ? "🌙" : "☀️"; localStorage.setItem(KEY, m); }
  function toggle() { apply(document.body.classList.contains("light") ? "dark" : "light"); }
  function init()   { apply(localStorage.getItem(KEY) || "dark"); }
  return { toggle, init };
})();

// ── Voice Feedback ─────────────────────────────────────────────────────────────
const Voice = (() => {
  let _last = ""; let _t = 0; const CD = 5000;
  function speak(msg) {
    if (!$("voice-toggle")?.checked || !window.speechSynthesis) return;
    const now = Date.now();
    if (msg === _last && now - _t < CD) return;
    _last = msg; _t = now;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(msg);
    u.rate = 1.05; u.pitch = 1; u.volume = 0.9;
    window.speechSynthesis.speak(u);
  }
  return { speak };
})();

// ── Auth ───────────────────────────────────────────────────────────────────────
const Auth = (() => {
  const KEY = "posture_coach_token";
  function getToken()  { return localStorage.getItem(KEY); }
  function setToken(t) { localStorage.setItem(KEY, t); }
  function clearToken(){ localStorage.removeItem(KEY); }
  function showTab(tab) {
    $("form-login").classList.toggle("hidden", tab !== "login");
    $("form-register").classList.toggle("hidden", tab !== "register");
    $("tab-login").classList.toggle("active", tab === "login");
    $("tab-register").classList.toggle("active", tab === "register");
    $("auth-error").textContent = "";
  }
  async function login() {
    const username = $("login-username").value.trim(), password = $("login-password").value;
    $("auth-error").textContent = "";
    if (!username || !password) { $("auth-error").textContent = "Please enter username and password."; return; }
    try { const d = await apiFetch("/auth/login", { method:"POST", body: JSON.stringify({username,password}) }); setToken(d.access_token); onLoggedIn(); }
    catch(e) { $("auth-error").textContent = e.message; }
  }
  async function register() {
    const username = $("reg-username").value.trim(), password = $("reg-password").value;
    $("auth-error").textContent = "";
    if (!username || !password) { $("auth-error").textContent = "Please fill all fields."; return; }
    try {
      await apiFetch("/auth/register", { method:"POST", body: JSON.stringify({username,password}) });
      const d = await apiFetch("/auth/login", { method:"POST", body: JSON.stringify({username,password}) });
      setToken(d.access_token); onLoggedIn();
    } catch(e) { $("auth-error").textContent = e.message; }
  }
  function logout() { clearToken(); showHeader(false); showView("auth-view"); }
  return { getToken, login, register, logout, showTab };
})();

// ── Navigation ─────────────────────────────────────────────────────────────────
function onLoggedIn() {
  showHeader(true);
  setNavActive("exercises");
  ExerciseSelector.load();
  loadStreakBanner();
  showView("exercise-view");
}
$("btn-nav-exercises").addEventListener("click", () => { setNavActive("exercises"); showView("exercise-view"); });
$("btn-nav-progress").addEventListener("click",  () => { setNavActive("progress");  ProgressView.load(); showView("progress-view"); });
$("btn-nav-coach").addEventListener("click",     () => { setNavActive("coach");     CoachView.load(); showView("coach-view"); });
$("btn-logout").addEventListener("click", Auth.logout);
$("btn-theme").addEventListener("click",  Theme.toggle);

// ── Streak banner on exercise screen ──────────────────────────────────────────
async function loadStreakBanner() {
  try {
    const s = await apiFetch("/progress/streak");
    const banner = $("streak-banner");
    if (s.current_streak >= 2) {
      banner.classList.remove("hidden");
      banner.innerHTML = `🔥 ${s.current_streak}-day streak! Keep it up! &nbsp;·&nbsp; Longest: ${s.longest_streak} days`;
    }
  } catch(e) {}
}

// ── Exercise Selector ─────────────────────────────────────────────────────────
const ExerciseSelector = (() => {
  let _all = []; let _filter = "all";
  const EMOJI = { yoga:"🧘", gym:"💪", physiotherapy:"🏥" };
  async function load() {
    try { _all = await apiFetch("/exercises"); render(); } catch(e) { console.error(e); }
  }
  function filter(cat, btn) {
    _filter = cat;
    document.querySelectorAll(".category-tabs button").forEach(b => b.classList.remove("active"));
    btn.classList.add("active"); render();
  }
  function render() {
    const filtered = _filter === "all" ? _all : _all.filter(e => e.category === _filter);
    $("exercise-grid").innerHTML = filtered.map(ex => `
      <div class="exercise-card" onclick='CameraSession.start(${JSON.stringify(ex.id)}, ${JSON.stringify(ex)})'>
        <div class="ex-category badge-${ex.category}">${EMOJI[ex.category]||""} ${ex.category}</div>
        <div class="ex-name">${ex.name}</div>
        <div class="ex-cues">${(ex.cues||[]).slice(0,2).map(c=>`• ${c}`).join("<br>")}</div>
        <div class="ex-arrow">→</div>
      </div>`).join("");
  }
  return { load, filter };
})();

// ── Camera Session ─────────────────────────────────────────────────────────────
const CameraSession = (() => {
  let _ws,_stream,_capIntvl,_timerIntvl,_exercise,_reps=0,_accSum=0,_accCnt=0,_best=0,_t0=null,_rules=[];
  let _lastAnalysis = null;
  let _accBuffer = [];

  const _cap = document.createElement("canvas"); _cap.width=640; _cap.height=480;
  const _capCtx = _cap.getContext("2d");
  const _video = document.createElement("video"); _video.autoplay=true; _video.playsInline=true; _video.muted=true;
  const _dc = $("display-canvas"), _dCtx = _dc.getContext("2d");

  function updateRing(pct, status) {
    // Big hero ring (314.2 circumference)
    const r = $("ring-path"); if(!r) return;
    r.style.strokeDashoffset = 314.2 - (pct/100)*314.2;
    // Hero ring always uses gradient via SVG — no stroke colour needed

    // HUD mini ring on video (138.2 circumference)
    const h = $("hud-ring-path"); if(h) {
      h.style.strokeDashoffset = 138.2 - (pct/100)*138.2;
      h.style.stroke = status==="good"?"var(--good)":status==="needs_work"?"var(--warn)":"var(--bad)";
    }
    const hudVal = $("hud-acc-val"); if(hudVal) hudVal.textContent = `${Math.round(pct)}%`;
    const hudLbl = $("hud-status-label"); if(hudLbl) {
      hudLbl.textContent = status==="good"?"Great!":status==="needs_work"?"Almost":"Fix form";
      hudLbl.style.color = status==="good"?"var(--good)":status==="needs_work"?"var(--warn)":"var(--bad)";
    }
    $("hud-accuracy").style.display="flex";
  }

  function startTimer() {
    _t0 = Date.now();
    _timerIntvl = setInterval(() => {
      const e = Math.floor((Date.now()-_t0)/1000);
      $("session-timer").textContent = `${String(Math.floor(e/60)).padStart(2,"0")}:${String(e%60).padStart(2,"0")}`;
    }, 1000);
  }
  function stopTimer() { clearInterval(_timerIntvl); }
  function elapsed() { if(!_t0) return "0s"; const e=Math.floor((Date.now()-_t0)/1000); return e<60?`${e}s`:`${Math.floor(e/60)}m ${e%60}s`; }

  async function start(exerciseId, exercise) {
    _exercise=exercise; _reps=0; _accSum=0; _accCnt=0; _best=0; _rules=exercise.rules||[]; _accBuffer=[];
    $("camera-title").textContent=exercise.name; $("session-timer").textContent="00:00";
    $("session-summary").classList.add("hidden"); $("btn-stop").disabled=false;
    $("canvas-overlay").classList.remove("hidden");
    $("accuracy-value").textContent="—"; $("accuracy-status").textContent="Waiting…"; $("pose-confidence").textContent="—";
    $("angles-list").innerHTML='<span class="muted-text">Detecting pose…</span>';
    $("feedback-list").innerHTML='<li class="ok">Waiting for pose detection…</li>';
    $("symmetry-card").style.display="none"; $("symmetry-overlay").style.display="none";
    $("cues-list").innerHTML=(exercise.cues||[]).map(c=>`<li class="ok">${c}</li>`).join("");
    showView("camera-view");

    try {
      _stream = await navigator.mediaDevices.getUserMedia({video:{width:640,height:480,facingMode:"user"}});
      _video.srcObject=_stream; await _video.play();
    } catch(e) { alert("Camera access denied."); showView("exercise-view"); return; }

    startTimer();
    const token = Auth.getToken();
    _ws = new WebSocket(`${WS_BASE}/ws/analyze?exercise_id=${exerciseId}&token=${encodeURIComponent(token)}`);
    _ws.binaryType = "arraybuffer";
    _ws.onopen = () => { $("canvas-overlay").classList.add("hidden"); _capIntvl = setInterval(sendFrame, 100); };
    _ws.onmessage = e => { try { handleMsg(JSON.parse(e.data)); } catch(_) {} };
    _ws.onclose = () => { clearInterval(_capIntvl); stopTimer(); showSummary(); };
    _ws.onerror = e => console.error("WS error", e);
  }

  function sendFrame() {
    if (!_ws || _ws.readyState !== WebSocket.OPEN) return;
    _capCtx.drawImage(_video,0,0,640,480);
    _cap.toBlob(b => { if(b && _ws?.readyState===WebSocket.OPEN) b.arrayBuffer().then(buf=>_ws.send(buf)); }, "image/jpeg", 0.8);
  }

  function handleMsg(data) {
    if (data.frame) {
      const img=new Image();
      img.onload=()=>{ _dc.width=img.width||640; _dc.height=img.height||480; _dCtx.drawImage(img,0,0); };
      img.src="data:image/jpeg;base64,"+data.frame;
    }
    if (data.feedback) updateFeedback(data.feedback);
    if (data.analysis) { updateAngles(data.analysis); _lastAnalysis=data.analysis; }
    if (data.analysis?.accuracy_pct != null) { _accSum+=data.analysis.accuracy_pct; _accCnt++; if(data.analysis.accuracy_pct>_best) _best=data.analysis.accuracy_pct; }
    if (data.rep_number) _reps = data.rep_number;
    if (data.symmetry)   updateSymmetry(data.symmetry);
    $("pose-confidence").textContent = data.pose_detected===false ? "No pose" : "Pose ✓";
    $("pose-confidence").style.color = data.pose_detected===false ? "var(--bad)" : "var(--good)";
  }

  function updateFeedback(fb) {
    const { messages, accuracy_pct: pct, status } = fb;
    const p = pct||0;

    // Hero number + sub-label
    $("accuracy-value").textContent = `${Math.round(p)}%`;
    $("accuracy-value").className = `acc-hero-num status-${status}`;
    $("accuracy-status").textContent = status==="good"?"Perfect":status==="needs_work"?"Close":"Fix form";
    $("accuracy-status").className = `acc-hero-sub status-${status}`;

    // Gradient bar (always gradient colour, width changes)
    $("accuracy-bar").style.width = `${p}%`;

    // Status pills — show passing/failing rule counts
    const passing = (_lastAnalysis?.passing_rules||[]).length;
    const failing  = (_lastAnalysis?.failing_rules||[]).length;
    const pillCls = status==="good"?"good":status==="needs_work"?"warn":"bad";
    $("acc-pills").innerHTML = [
      passing ? `<span class="acc-pill good">${passing} ✓</span>` : "",
      failing  ? `<span class="acc-pill bad">${failing} ✗</span>` : "",
      !passing && !failing ? `<span class="acc-pill muted">Detecting…</span>` : "",
    ].join("");

    updateRing(p, status);

    // Also update topbar confidence badge
    $("pose-confidence").textContent  = status==="good"?"✓ Good":status==="needs_work"?"~ Close":"✗ Fix";
    $("pose-confidence").style.color  = status==="good"?"var(--good)":status==="needs_work"?"var(--warn)":"var(--bad)";
    const pp = $("pose-confidence-panel");
    if(pp) { pp.textContent=$("pose-confidence").textContent; pp.style.color=$("pose-confidence").style.color; }

    if (messages?.length) {
      const fails = _lastAnalysis?.failing_rules || [];
      $("feedback-list").innerHTML = messages.map((m,i) => {
        const sev = fails[i]?.severity||"minor";
        return `<li class="${sev==="major"?"major":""}">${m}</li>`;
      }).join("");
      if (status !== "good" && messages[0]) Voice.speak(messages[0]);
    } else {
      $("feedback-list").innerHTML='<li class="ok">Great form! Keep it up!</li>';
    }
  }

  function updateAngles(analysis) {
    const angles=analysis.angles||{}, passing=new Set(analysis.passing_rules||[]);
    if (!Object.keys(angles).length) { $("angles-list").innerHTML='<span class="muted-text">Detecting pose…</span>'; return; }
    const names={}; (_rules||[]).forEach(r=>{names[r.id]=r.id.replace(/_/g," ");});
    $("angles-list").innerHTML = Object.entries(angles).map(([id,angle])=>{
      const ok=passing.has(id), pct=Math.min(100,Math.max(0,angle/180*100));
      const label=names[id]||id.replace(/_/g," ");
      return `<div class="angle-row">
        <span class="angle-name">${label}</span>
        <div class="angle-bar-wrap"><div class="angle-bar" style="width:${pct}%;background:${ok?"var(--good)":"var(--bad)"}"></div></div>
        <span class="angle-val ${ok?"angle-ok":"angle-fail"}">${angle}°</span>
      </div>`;
    }).join("");
  }

  // ── UNIQUE: Real-time body symmetry meter ──────────────────────────────────
  function updateSymmetry(sym) {
    $("symmetry-card").style.display="block";
    $("symmetry-overlay").style.display="block";
    const s=sym.score;
    const color = s>=75?"var(--good)":s>=50?"var(--warn)":"var(--bad)";
    const statusLabel = sym.status==="balanced"?"⚖️ Balanced":sym.status==="slight_imbalance"?"↔️ Slight imbalance":"⚠️ Imbalanced";
    // Overlay on video
    $("sym-value").textContent=`${Math.round(s)}%`;
    $("sym-value").style.color=color;
    $("sym-bar").style.width=`${s}%`;
    $("sym-bar").style.background=color;
    // Panel card
    $("sym-status-badge").textContent=statusLabel;
    $("sym-breakdown").innerHTML=(sym.breakdown||[]).map(b=>`
      <div class="sym-row">
        <span class="sym-name">${b.joint}</span>
        <span class="sym-score-val" style="color:${b.ok?"var(--good)":"var(--bad)"}">${Math.round(b.score)}%</span>
        <div class="sym-dot" style="background:${b.ok?"var(--good)":"var(--bad)"}"></div>
      </div>`).join("");
  }

  function stop() {
    if (_ws?.readyState===WebSocket.OPEN) _ws.close();
    clearInterval(_capIntvl); stopTimer();
    if (_stream) { _stream.getTracks().forEach(t=>t.stop()); _stream=null; }
  }

  // ── UNIQUE: Personal best detection with confetti ─────────────────────────
  async function showSummary() {
    const avg = _accCnt>0?Math.round(_accSum/_accCnt):0;
    const best = Math.round(_best);
    const grade = avg>=90?"🏆 Excellent!":avg>=75?"🥇 Great job!":avg>=55?"👍 Good effort!":"💪 Keep practicing!";
    $("summary-accuracy").textContent=`${avg}%`;
    $("summary-accuracy").className=`summary-stat status-${avg>=80?"good":avg>=50?"needs_work":"poor"}`;
    $("summary-reps").textContent=_reps;
    $("summary-best").textContent=`${best}%`;
    $("summary-duration").textContent=elapsed();
    $("summary-grade").textContent=grade;
    $("pb-badge").classList.add("hidden");

    // Check if this is a personal best
    try {
      const pbs = await apiFetch("/progress/personal-bests");
      const exPb = pbs.find(p=>p.exercise_name===_exercise?.name);
      if (avg > 0 && (!exPb || avg >= exPb.best_accuracy)) {
        $("pb-badge").classList.remove("hidden");
        if (typeof launchConfetti === "function") launchConfetti();
        Voice.speak(`New personal best! ${avg} percent!`);
      }
    } catch(_) {}

    $("session-summary").classList.remove("hidden");
    $("btn-stop").disabled=true;
    if (!$("pb-badge").classList.contains("hidden") === false)
      Voice.speak(`Session complete. Average accuracy ${avg} percent. ${grade}`);
  }

  function back() { stop(); setNavActive("exercises"); showView("exercise-view"); }
  return { start, stop, back };
})();

// ── Progress View ──────────────────────────────────────────────────────────────
const ProgressView = (() => {
  let _barChart=null, _trendChart=null, _summary=[], _sessions=[];

  async function load() {
    try {
      const [summary, sessions, streak, pbs] = await Promise.all([
        apiFetch("/progress/summary"),
        apiFetch("/progress/sessions"),
        apiFetch("/progress/streak"),
        apiFetch("/progress/personal-bests"),
      ]);
      _summary=summary; _sessions=sessions;
      renderStats(sessions, summary, streak);
      renderHeatmap(streak);
      renderBarChart(summary);
      renderPersonalBests(pbs);
      populateFilters(sessions);
      renderTable(sessions);
      loadTrend();
    } catch(e) { console.error(e); }
  }

  function renderStats(sessions, summary, streak) {
    $("stat-total-sessions").textContent = sessions.length;
    const bestAcc = summary.length ? Math.max(...summary.map(s=>s.avg_accuracy)) : 0;
    $("stat-best-accuracy").textContent = sessions.length ? `${Math.round(bestAcc)}%` : "—";
    $("stat-streak").textContent = streak.current_streak ? `${streak.current_streak} 🔥` : "0";
    $("longest-streak-badge").textContent = `Longest: ${streak.longest_streak} days`;
    const topEx = summary.length ? summary.reduce((a,b)=>a.avg_accuracy>b.avg_accuracy?a:b).exercise_name : "—";
    $("stat-top-exercise").textContent = topEx.split(" ")[0];
  }

  // ── UNIQUE FEATURE: GitHub-style activity heatmap ─────────────────────────
  function renderHeatmap(streak) {
    const grid = $("heatmap-grid"); grid.innerHTML="";
    const heatmap = {};
    (streak.heatmap||[]).forEach(h => { heatmap[h.date]=h.count; });
    const today = new Date(); today.setHours(0,0,0,0);
    for (let i=89; i>=0; i--) {
      const d = new Date(today); d.setDate(d.getDate()-i);
      const iso = d.toISOString().split("T")[0];
      const cnt = heatmap[iso]||0;
      const level = cnt===0?0:cnt===1?1:cnt===2?2:cnt===3?3:4;
      const cell = document.createElement("div");
      cell.className = `heatmap-cell${level>0?" active-"+level:""}`;
      cell.title = cnt>0?`${iso}: ${cnt} session${cnt>1?"s":""}`:iso;
      grid.appendChild(cell);
    }
  }

  // ── UNIQUE FEATURE: Accuracy trend line chart ──────────────────────────────
  async function loadTrend() {
    const ex = $("trend-exercise-filter")?.value||"";
    try {
      const url = "/progress/trend" + (ex?`?exercise_name=${encodeURIComponent(ex)}`:"");
      const trend = await apiFetch(url);
      const ctx = $("trend-chart").getContext("2d");
      if (_trendChart) _trendChart.destroy();
      if (!trend.length) { ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height); return; }
      _trendChart = new Chart(ctx, {
        type: "line",
        data: {
          labels: trend.map(t=>t.date),
          datasets:[{
            label:"Avg Accuracy (%)", data: trend.map(t=>t.avg_accuracy),
            borderColor:"#4f8ef7", backgroundColor:"rgba(79,142,247,.12)",
            borderWidth:2, tension:.4, fill:true, pointRadius:4, pointBackgroundColor:"#4f8ef7",
          }],
        },
        options:{
          responsive:true,
          plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label: c=>` ${c.raw}% accuracy` }} },
          scales:{
            y:{ beginAtZero:true, max:100, grid:{color:"rgba(46,50,68,.6)"}, ticks:{color:"#8892a4",callback:v=>v+"%"} },
            x:{ grid:{display:false}, ticks:{color:"#8892a4",maxTicksLimit:10} },
          },
        },
      });
    } catch(e) {}
  }

  function renderBarChart(summary) {
    const labels=summary.map(r=>r.exercise_name), data=summary.map(r=>r.avg_accuracy);
    const colors=data.map(v=>v>=80?"#22c55e":v>=50?"#f59e0b":"#ef4444");
    const ctx=$("progress-chart").getContext("2d");
    if (_barChart) _barChart.destroy();
    _barChart = new Chart(ctx, {
      type:"bar",
      data:{ labels, datasets:[{ label:"Avg Accuracy (%)", data, backgroundColor:colors.map(c=>c+"cc"), borderColor:colors, borderWidth:2, borderRadius:8 }] },
      options:{
        responsive:true,
        plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:c=>` ${c.raw}% avg`, afterLabel:c=>` ${summary[c.dataIndex]?.session_count} session(s)` }} },
        scales:{
          y:{ beginAtZero:true, max:100, grid:{color:"rgba(46,50,68,.6)"}, ticks:{color:"#8892a4",callback:v=>v+"%"} },
          x:{ grid:{display:false}, ticks:{color:"#8892a4",maxRotation:30} },
        },
      },
    });
  }

  // ── UNIQUE FEATURE: Personal bests cards ──────────────────────────────────
  function renderPersonalBests(pbs) {
    const grid = $("personal-bests-grid");
    if (!pbs.length) { grid.innerHTML='<span class="muted-text">No sessions yet.</span>'; return; }
    grid.innerHTML = pbs.map(p=>{
      const date = p.achieved_on ? new Date(p.achieved_on).toLocaleDateString(undefined,{month:"short",day:"numeric"}) : "—";
      const impTxt = p.improvement>0 ? `+${p.improvement}% improvement` : "";
      return `<div class="pb-card">
        <div class="pb-card-badge">${p.badge}</div>
        <div class="pb-card-name">${p.exercise_name}</div>
        <div class="pb-card-acc">${p.best_accuracy}%</div>
        <div class="pb-card-meta">${p.attempts} attempt${p.attempts!==1?"s":""} · ${date}</div>
        ${impTxt?`<div class="pb-card-improvement">↑ ${impTxt}</div>`:""}
      </div>`;
    }).join("");
  }

  function populateFilters(sessions) {
    const names=[...new Set(sessions.map(s=>s.exercise_name))];
    const opts='<option value="">All Exercises</option>'+names.map(n=>`<option value="${n}">${n}</option>`).join("");
    $("filter-exercise").innerHTML=opts;
    $("trend-exercise-filter").innerHTML=opts;
  }

  function filterSessions() {
    const val=$("filter-exercise").value;
    renderTable(val?_sessions.filter(s=>s.exercise_name===val):_sessions);
  }

  function renderTable(sessions) {
    const tbody=$("sessions-tbody");
    if (!sessions.length) { tbody.innerHTML='<tr><td colspan="5" style="color:var(--muted);text-align:center;padding:24px">No sessions yet.</td></tr>'; return; }
    const EM={yoga:"🧘",gym:"💪",physiotherapy:"🏥"};
    tbody.innerHTML=sessions.map(s=>{
      const date=s.started_at?new Date(s.started_at).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}):"—";
      const acc=s.avg_accuracy_pct!=null?`${Math.round(s.avg_accuracy_pct)}%`:"—";
      const cls=s.avg_accuracy_pct>=80?"good":s.avg_accuracy_pct>=50?"needs_work":"poor";
      return `<tr>
        <td style="font-weight:600">${s.exercise_name}</td>
        <td style="color:var(--muted)">${EM[s.category]||""} ${s.category}</td>
        <td style="color:var(--muted)">${date}</td>
        <td class="status-${cls}" style="font-weight:700">${acc}</td>
        <td style="color:var(--muted)">${s.rep_count}</td>
      </tr>`;
    }).join("");
  }
  return { load, filterSessions, loadTrend };
})();

// ── AI Coach View ──────────────────────────────────────────────────────────────
const CoachView = (() => {
  const MUSCLE_MAP = {
    yoga:   [["🧘","Core","Stability & balance"],["🦵","Legs","Hip flexors & hamstrings"],["💪","Arms","Shoulder mobility"],["🧠","Mind","Focus & breath control"]],
    gym:    [["🦵","Quads","Primary squat muscle"],["🍑","Glutes","Hip drive & power"],["🏋️","Back","Spinal erectors"],["💪","Core","Bracing & stability"]],
    physiotherapy:[["🦴","Joints","Range of motion"],["⚖️","Balance","Proprioception"],["🌊","Flow","Smooth movement patterns"],["😮‍💨","Breath","Diaphragm & posture"]],
  };

  async function load() {
    try {
      const [tip, pbs, summary] = await Promise.all([
        apiFetch("/coach/tip"),
        apiFetch("/progress/personal-bests"),
        apiFetch("/progress/summary"),
      ]);
      renderTip(tip);
      renderMuscleGuide(tip, pbs);
      renderImprovementPlan(summary, pbs);
    } catch(e) { console.error(e); }
  }

  function renderTip(tip) {
    $("coach-emoji").textContent = tip.emoji || "💡";
    $("coach-tip-text").textContent = tip.tip;
    $("coach-focus").textContent = tip.focus_exercise
      ? `Focus exercise: ${tip.focus_exercise} · Current avg: ${tip.avg_accuracy}%`
      : "";
  }

  function renderMuscleGuide(tip, pbs) {
    const weakPb = pbs.length ? pbs[pbs.length-1] : null;
    const cat = weakPb?.category || "yoga";
    const muscles = MUSCLE_MAP[cat] || MUSCLE_MAP.yoga;
    $("muscle-guide").innerHTML = muscles.map(([icon,name,desc])=>`
      <div class="muscle-row">
        <span class="muscle-icon">${icon}</span>
        <span class="muscle-name">${name}</span>
        <span class="muscle-level">${desc}</span>
      </div>`).join("");
  }

  // ── UNIQUE: Generate personalised improvement plan from data ───────────────
  function renderImprovementPlan(summary, pbs) {
    const plan = $("improvement-plan");
    if (!summary.length) { plan.innerHTML='<div class="muted-text">Complete sessions to unlock your plan.</div>'; return; }

    const steps = [];
    const sorted = [...summary].sort((a,b)=>a.avg_accuracy-b.avg_accuracy);
    const weakest = sorted[0], strongest = sorted[sorted.length-1];

    if (weakest) steps.push(`Practice <strong>${weakest.exercise_name}</strong> daily — your average is ${weakest.avg_accuracy}%. Aim for 80%+ in 5 sessions.`);

    const needsWork = summary.filter(s=>s.avg_accuracy>=50&&s.avg_accuracy<80);
    if (needsWork.length) steps.push(`You're close on <strong>${needsWork.map(s=>s.exercise_name).join(", ")}</strong> — small adjustments will push you over 80%.`);

    if (strongest && strongest.avg_accuracy >= 80) steps.push(`Maintain your <strong>${strongest.exercise_name}</strong> form (${strongest.avg_accuracy}%) and try increasing session duration.`);

    const totalSessions = summary.reduce((s,r)=>s+r.session_count,0);
    if (totalSessions < 10) steps.push(`Build consistency — you've done <strong>${totalSessions}</strong> sessions. Aim for 3 sessions per week.`);
    else steps.push(`Excellent consistency with <strong>${totalSessions}</strong> sessions! Try all 10 exercises to unlock full-body analysis.`);

    plan.innerHTML = steps.map((s,i)=>`
      <div class="plan-step">
        <div class="plan-step-num">${i+1}</div>
        <div class="plan-step-text">${s}</div>
      </div>`).join("");
  }
  return { load };
})();

// ── Boot ───────────────────────────────────────────────────────────────────────
(function boot() {
  Theme.init();
  if (Auth.getToken()) onLoggedIn();
  ["login-username","login-password"].forEach(id => $(id)?.addEventListener("keydown", e=>{ if(e.key==="Enter") Auth.login(); }));
  ["reg-username","reg-password"].forEach(id =>   $(id)?.addEventListener("keydown", e=>{ if(e.key==="Enter") Auth.register(); }));
})();
