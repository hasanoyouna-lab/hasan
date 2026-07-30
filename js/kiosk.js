// شاشة الكشك. ملاحظة مقصودة: ما في أي إشارة لحالة الاتصال بالواجهة —
// الموظف ما لازم يعرف ولا يهتم، الحفظ والمزامنة بيصيروا بالخلفية بصمت.

const app = document.getElementById("app");

let employees = [];
let settings = {};
let statusMap = {};

let tickInterval = null;     // مؤقت واحد للشاشة الحالية (بدل مؤقتات متفرقة)
let statusPoll = null;
let idleTimer = null;

const IDLE_MS = 30000;       // جهاز مشترك: رجوع تلقائي للرئيسية بعد سكون
const POLL_MS = 20000;

// ===================== أدوات =====================
function graceSec() { const v = Number(settings.breakStartDelaySec); return isNaN(v) ? 45 : v; }
// مهلة خاصة بالسبب إن وُجدت (مثلاً الحمام ٥ دقايق)، وإلا المهلة العامة.
// نفس منطق graceSecFor بالسيرفر بالضبط، حتى العدّاد المعروض يطابق الوقت المحفوظ.
function graceSecFor(reason) {
  try {
    const map = JSON.parse(settings.reasonGraceSec || "{}");
    const v = Number(map[reason]);
    if (!isNaN(v) && v >= 0) return v;
  } catch (e) { /* إعداد غير صالح — نرجع للعامة */ }
  return graceSec();
}
function maxBreakMin() { return Number(settings.maxBreakMinutes) || 30; }
function dailyLimitMin() { return Number(settings.dailyLimitMinutes) || 60; }

function fmtClock(d) {
  return d.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
}
function fmtDateLine(d) {
  return d.toLocaleDateString("ar-EG", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}
function mmss(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}
function fmtDuration(mins) {
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? `${h} س ${m} د` : `${m} د`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
// أخضر → أصفر → أحمر حسب نسبة الاستهلاك
function scaleColor(pct) {
  const p = Math.max(0, Math.min(1, pct));
  return `hsl(${(1 - p) * 125}, 72%, ${p > .8 ? 47 : 41}%)`;
}
function buzz(ms) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} }

setInterval(() => {
  const now = new Date();
  document.getElementById("clock").textContent = fmtClock(now);
  document.getElementById("dateLine").textContent = fmtDateLine(now);
}, 1000);

function showToast(msg, isError) {
  const t = document.createElement("div");
  t.className = "toast" + (isError ? " error" : "");
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// موجة ضغط + اهتزاز خفيف — إحساس لمس واضح على شاشة الكاشير
function attachPress(el, onTap) {
  el.addEventListener("pointerdown", ev => {
    const r = el.getBoundingClientRect();
    const size = Math.max(r.width, r.height);
    const dot = document.createElement("span");
    dot.className = "ripple";
    dot.style.width = dot.style.height = size + "px";
    dot.style.left = (ev.clientX - r.left - size / 2) + "px";
    dot.style.top = (ev.clientY - r.top - size / 2) + "px";
    el.appendChild(dot);
    setTimeout(() => dot.remove(), 560);
  });
  let busy = false;
  el.addEventListener("click", () => {
    if (busy) return;             // يمنع الضغط المزدوج من تسجيل مرتين
    busy = true;
    buzz(12);
    onTap();
    setTimeout(() => { busy = false; }, 700);
  });
}

// ===================== إدارة الشاشة =====================
function setView(html) {
  if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
  app.innerHTML = `<div class="view">${html}</div>`;
}
function stopPolling() { if (statusPoll) { clearInterval(statusPoll); statusPoll = null; } }

function armIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => goHome(), IDLE_MS);
}
function disarmIdle() { clearTimeout(idleTimer); }
["pointerdown", "keydown"].forEach(ev =>
  document.addEventListener(ev, () => { if (idleTimer) armIdle(); }, { passive: true }));

// ===================== الشاشة الرئيسية =====================
async function goHome() {
  disarmIdle();
  stopPolling();

  // نرسم فورًا من الكاش لو موجود (صفر انتظار)، وبعدين نحدّث بهدوء من السيرفر
  const cached = Local.cacheGet();
  if (cached && cached.employees && cached.employees.length) {
    employees = cached.employees;
    settings = cached.settings || {};
    statusMap = Local.statusCacheGet() || statusMap || {};
    mergeLocalOpenBreaks();
    renderHome();
  } else {
    setView(`<div class="grid">${'<div class="sk"></div>'.repeat(3)}</div>`);
  }

  try {
    const [emps, sets] = await Promise.all([Api.get("getEmployees"), Api.get("getSettings")]);
    employees = emps; settings = sets;
    Local.cacheSet(emps, sets);
  } catch (e) {
    if (!employees.length) {
      setView(`<p class="center muted">تعذّر تحميل البيانات.</p>
        <div class="center"><button class="btn" id="retry">إعادة المحاولة</button></div>`);
      document.getElementById("retry").onclick = goHome;
      return;
    }
  }

  await refreshStatus();
  renderHome();
  statusPoll = setInterval(async () => { await refreshStatus(); paintLive(); }, POLL_MS);
}

async function refreshStatus() {
  try {
    statusMap = await Api.get("getStatus");
    Local.statusCacheSet(statusMap);
  } catch (e) {
    statusMap = statusMap && Object.keys(statusMap).length ? statusMap : (Local.statusCacheGet() || {});
  }
  mergeLocalOpenBreaks();
}

// أي بريك اتسجل من هاد الجهاز بيبين "برا" فورًا، حتى لو لسا ما وصل للسيرفر
function mergeLocalOpenBreaks() {
  const locals = Local.getAllLocalOpenBreaks();
  Object.keys(locals).forEach(empId => {
    if (!statusMap[empId]) statusMap[empId] = { closedMinutes: 0 };
    statusMap[empId].openLog = locals[empId];
  });
}

function usedMinutes(empId) {
  const st = statusMap[empId];
  if (!st) return 0;
  let mins = Number(st.closedMinutes) || 0;
  if (st.openLog) mins += Math.max(0, (Date.now() - new Date(st.openLog.outAt).getTime()) / 60000);
  return mins;
}

function renderHome() {
  const anyOut = employees.some(e => statusMap[e.id] && statusMap[e.id].openLog);

  const tiles = employees.map((emp, i) => {
    const out = statusMap[emp.id] && statusMap[emp.id].openLog;
    return `
      <div class="tile ${out ? "is-out" : ""}" data-emp="${emp.id}" style="--i:${i}">
        <div class="avatar">${escapeHtml((emp.name || "؟").trim().charAt(0))}</div>
        <div class="name">${escapeHtml(emp.name)}</div>
        <div class="sub" id="sub-${emp.id}"></div>
        <div class="gauge-wrap"><div class="gauge-fill" id="g-${emp.id}"></div></div>
        <div class="gauge-label" id="gl-${emp.id}"></div>
      </div>`;
  }).join("");

  setView(`
    <div id="outStrip">${anyOut ? outStripHtml() : ""}</div>
    <p class="pick-hint">اختر اسمك</p>
    <div class="grid">${tiles}</div>
  `);

  app.querySelectorAll("[data-emp]").forEach(el => {
    const emp = employees.find(e => e.id === el.dataset.emp);
    attachPress(el, () => openEmployee(emp));
  });

  paintLive();
  tickInterval = setInterval(paintLive, 1000);
}

function outStripHtml() {
  const chips = employees
    .filter(e => statusMap[e.id] && statusMap[e.id].openLog)
    .map(e => `<span class="out-chip" data-chip="${e.id}">${escapeHtml(e.name)}</span>`)
    .join("");
  return `<div class="out-strip"><span class="lbl"><span class="live-dot"></span>برا الآن</span>${chips}</div>`;
}

// تحديث كل شي المتحرك بالشاشة الرئيسية كل ثانية
function paintLive() {
  const limit = dailyLimitMin();

  employees.forEach(emp => {
    const st = statusMap[emp.id];
    const open = st && st.openLog;

    const fill = document.getElementById("g-" + emp.id);
    if (!fill) return;
    const used = usedMinutes(emp.id);
    const pct = used / limit;
    fill.style.width = Math.min(100, pct * 100) + "%";
    fill.style.backgroundColor = scaleColor(pct);

    const gl = document.getElementById("gl-" + emp.id);
    if (gl) gl.textContent = `${Math.round(used)} / ${limit} دقيقة اليوم`;

    const sub = document.getElementById("sub-" + emp.id);
    if (sub) {
      if (open) {
        const elapsed = Date.now() - new Date(open.outAt).getTime();
        const label = elapsed < 0 ? `سماح ${mmss(-elapsed)}` : mmss(elapsed);
        sub.innerHTML = `${Icons.svg(open.reason, 17)}<span>${label}</span>`;
      } else {
        sub.innerHTML = "";
      }
    }

    const tile = document.querySelector(`[data-emp="${emp.id}"]`);
    if (tile) tile.classList.toggle("is-out", !!open);

    const chip = document.querySelector(`[data-chip="${emp.id}"]`);
    if (chip && open) {
      const elapsed = Date.now() - new Date(open.outAt).getTime();
      chip.textContent = `${emp.name} · ${elapsed < 0 ? "الآن" : mmss(elapsed)}`;
    }
  });

  // نعيد بناء الشريط بس لما تتغير قائمة اللي برا (مش كل ثانية)
  const strip = document.getElementById("outStrip");
  if (strip) {
    const nowOut = employees.filter(e => statusMap[e.id] && statusMap[e.id].openLog).map(e => e.id).join(",");
    if (strip.dataset.who !== nowOut) {
      strip.dataset.who = nowOut;
      strip.innerHTML = nowOut ? outStripHtml() : "";
    }
  }
}

// ===================== اختيار الموظف =====================
async function openEmployee(emp) {
  stopPolling();
  armIdle();
  const open = await Local.getOpenBreak(emp.id, emp.name);
  if (open) renderOpenBreak(emp, open);
  else renderReasonPicker(emp);
}

function renderReasonPicker(emp) {
  const reasons = (settings.reasons || "حمام,صلاة,أكل,الذهاب للخارج,استراحة")
    .split(",").map(s => s.trim()).filter(Boolean);

  setView(`
    <span class="back-link" id="back">‹ رجوع</span>
    <div class="screen-title">${escapeHtml(emp.name)}</div>
    <p class="screen-sub">وين رايح؟</p>
    <div class="reason-grid">
      ${reasons.map((r, i) => `
        <div class="reason-btn" data-reason="${escapeHtml(r)}" style="--i:${i}">
          <span class="icon-badge">${Icons.svg(r, 32)}</span>
          <span>${escapeHtml(r)}</span>
        </div>`).join("")}
    </div>
  `);

  attachPress(document.getElementById("back"), goHome);
  app.querySelectorAll("[data-reason]").forEach(el =>
    attachPress(el, () => startBreak(emp, el.dataset.reason)));
}

// ===================== بدء البريك =====================
function startBreak(emp, reason) {
  // التسجيل محلي وفوري — بننتقل للعدّاد بنفس اللحظة والشبكة تلحقنا بالخلفية
  const res = Local.startBreak(emp.id, emp.name, reason, graceSecFor(reason));
  if (!statusMap[emp.id]) statusMap[emp.id] = { closedMinutes: 0 };
  statusMap[emp.id].openLog = { reason, outAt: res.outAt };
  renderOpenBreak(emp, { id: res.id, reason, outAt: res.outAt });
}

// لو السيرفر رجّع وقت مختلف شوي، العدّاد المعروض يصحّح نفسه بهدوء
Local.onOutAtCorrected((id, outAt) => {
  if (currentBreak && currentBreak.id === id) currentBreak.outAt = outAt;
  Object.values(statusMap).forEach(st => {
    if (st.openLog && st.openLog.id === id) st.openLog.outAt = outAt;
  });
});

let currentBreak = null;

function renderOpenBreak(emp, log) {
  currentBreak = log;
  armIdle();

  const R = 92, C = 2 * Math.PI * R;
  setView(`
    <span class="back-link" id="back">‹ رجوع</span>
    <div class="screen-title">${escapeHtml(emp.name)}</div>
    <p class="screen-sub">${Icons.svg(log.reason, 19)}<span>${escapeHtml(log.reason)}</span></p>

    <div class="ring-wrap">
      <svg class="ring" viewBox="0 0 200 200">
        <circle class="track" cx="100" cy="100" r="${R}"></circle>
        <circle class="bar" cx="100" cy="100" r="${R}"
                stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${C.toFixed(1)}"></circle>
      </svg>
      <div class="ring-center">
        <div class="ring-time" id="ringTime">00:00</div>
        <div class="ring-cap" id="ringCap">من أصل ${maxBreakMin()} دقيقة</div>
      </div>
    </div>

    <div class="center" id="graceBox"></div>
    <div class="center" style="margin-top:16px">
      <button class="btn danger big" id="endBtn">تسجيل العودة</button>
    </div>
  `);

  const bar = app.querySelector(".bar");
  const timeEl = document.getElementById("ringTime");
  const capEl = document.getElementById("ringCap");
  const graceBox = document.getElementById("graceBox");
  const maxMs = maxBreakMin() * 60000;

  function tick() {
    const elapsed = Date.now() - new Date(currentBreak.outAt).getTime();

    if (elapsed < 0) {
      // مهلة ما قبل الاحتساب: الحلقة بتفضى تنازليًا والعدّاد لسا صفر
      const total = graceSecFor(currentBreak.reason) * 1000;
      const p = Math.max(0, Math.min(1, -elapsed / total));
      bar.style.strokeDashoffset = (C * (1 - p)).toFixed(1);
      bar.style.stroke = "var(--yellow-deep)";
      timeEl.textContent = mmss(-elapsed);
      timeEl.classList.remove("over");
      capEl.textContent = "متبقٍ من فترة السماح";
      graceBox.innerHTML = `<span class="grace-note">فترة سماح — الاحتساب لسا ما بدأ</span>`;
      return;
    }

    graceBox.innerHTML = "";
    capEl.textContent = `من أصل ${maxBreakMin()} دقيقة`;
    const p = Math.min(1, elapsed / maxMs);
    bar.style.strokeDashoffset = (C * (1 - p)).toFixed(1);
    bar.style.stroke = scaleColor(p);
    timeEl.textContent = mmss(elapsed);
    timeEl.classList.toggle("over", elapsed > maxMs);
  }

  tick();
  tickInterval = setInterval(tick, 1000);

  attachPress(document.getElementById("back"), goHome);
  attachPress(document.getElementById("endBtn"), () => endBreak(emp, currentBreak));
}

// ===================== إنهاء البريك =====================
function endBreak(emp, log) {
  const res = Local.endBreak(log.id, maxBreakMin());
  currentBreak = null;

  // تحديث فوري للحالة المحلية حتى الشاشة الرئيسية تبين صح لما نرجعلها
  const st = statusMap[emp.id] || (statusMap[emp.id] = { closedMinutes: 0 });
  st.closedMinutes = (Number(st.closedMinutes) || 0) + res.durationMin;
  delete st.openLog;

  renderDone(emp, res);
}

function renderDone(emp, res) {
  disarmIdle();
  setView(`
    <div class="done-wrap">
      <svg class="done-mark ${res.overLimit ? "warn" : ""}" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="49"></circle>
        <path d="M38 62l15 15 30-32"></path>
      </svg>
      <div class="done-title">أهلاً برجوعك، ${escapeHtml(emp.name)}</div>
      <div class="done-meta ${res.overLimit ? "warn" : ""}">
        مدة البريك ${fmtDuration(res.durationMin)}${res.overLimit ? " — تجاوزت الوقت المسموح" : ""}
      </div>
      <div style="margin-top:20px"><button class="btn secondary" id="doneBtn">تمام</button></div>
    </div>
  `);
  attachPress(document.getElementById("doneBtn"), goHome);
  setTimeout(() => { if (document.getElementById("doneBtn")) goHome(); }, 3200);
}

goHome();
