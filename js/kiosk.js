const app = document.getElementById("app");
let employees = [];
let settings = {};
let statusMap = {};
let selectedEmployee = null;
let timerInterval = null;
let gaugeInterval = null;
let statusPollInterval = null;

function fmtClock(d) {
  return d.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
}
function fmtDateLine(d) {
  return d.toLocaleDateString("ar-EG", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}
setInterval(() => {
  const now = new Date();
  document.getElementById("clock").textContent = fmtClock(now);
  document.getElementById("dateLine").textContent = fmtDateLine(now);
}, 1000);

// ملاحظة: عمداً ما في أي إشارة لحالة الاتصال بالواجهة — الموظف ما لازم يعرف ولا يهتم.
// الحفظ والمزامنة بيصيروا بالخلفية بشكل صامت سواء في نت أو لأ.

function showToast(msg, isError) {
  const t = document.createElement("div");
  t.className = "toast" + (isError ? " error" : "");
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

function fmtDuration(mins) {
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? `${h} س ${m} د` : `${m} د`;
}

function stopHomePolling() {
  if (gaugeInterval) { clearInterval(gaugeInterval); gaugeInterval = null; }
  if (statusPollInterval) { clearInterval(statusPollInterval); statusPollInterval = null; }
}

async function loadHome() {
  selectedEmployee = null;
  if (timerInterval) clearInterval(timerInterval);
  stopHomePolling();
  app.innerHTML = `<p class="center muted">جاري التحميل...</p>`;
  try {
    [employees, settings] = await Promise.all([Api.get("getEmployees"), Api.get("getSettings")]);
    Local.cacheSet(employees, settings);
  } catch (e) {
    const cached = Local.cacheGet();
    if (cached) { employees = cached.employees; settings = cached.settings; }
    else {
      app.innerHTML = `<p class="center muted">تعذر تحميل البيانات: ${e.message}</p>
        <div class="center"><button class="btn" onclick="loadHome()">إعادة المحاولة</button></div>`;
      return;
    }
  }
  try {
    statusMap = await Api.get("getStatus");
    Local.statusCacheSet(statusMap);
  } catch (e) {
    statusMap = Local.statusCacheGet() || {}; // بدون نت: آخر حالة معروفة لنفس اليوم
  }
  mergeLocalOpenBreaks();
  renderHome();

  gaugeInterval = setInterval(updateGauges, 1000);
  statusPollInterval = setInterval(async () => {
    try {
      statusMap = await Api.get("getStatus");
      Local.statusCacheSet(statusMap);
    } catch (e) { /* بدون نت — نبقي آخر نسخة معروفة */ }
    mergeLocalOpenBreaks();
    updateGauges();
  }, 15000);
}

// بيضمن إنه أي بريك اتسجل من نفس الجهاز (سواء انرفع للسيرفر أو لسا محلي بس) يبين
// كـ"برا" بالشاشة الرئيسية والعداد، حتى لو ما قدرنا نجيب حالة السيرفر (بدون نت).
function mergeLocalOpenBreaks() {
  const localOpens = Local.getAllLocalOpenBreaks();
  Object.keys(localOpens).forEach(employeeId => {
    if (!statusMap[employeeId]) statusMap[employeeId] = { closedMinutes: 0 };
    statusMap[employeeId].openLog = localOpens[employeeId];
  });
}

function fmtElapsedHuman(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function gaugeColor(pct) {
  const p = Math.max(0, Math.min(1, pct));
  const hue = 120 - 120 * p; // 120=أخضر → 0=أحمر
  return `hsl(${hue}, 70%, 45%)`;
}

function employeeUsedMinutes(emp) {
  const st = statusMap[emp.id];
  if (!st) return 0;
  let mins = Number(st.closedMinutes) || 0;
  if (st.openLog) {
    const elapsed = (Date.now() - new Date(st.openLog.outAt).getTime()) / 60000;
    mins += Math.max(0, elapsed);
  }
  return mins;
}

function updateGauges() {
  const dailyLimit = Number(settings.dailyLimitMinutes) || 60;
  employees.forEach(emp => {
    const fill = document.getElementById("gauge-" + emp.id);
    const label = document.getElementById("gauge-label-" + emp.id);
    const elapsedEl = document.getElementById("elapsed-" + emp.id);
    if (!fill) return;
    const used = employeeUsedMinutes(emp);
    const pct = used / dailyLimit;
    fill.style.width = Math.min(100, pct * 100) + "%";
    fill.style.backgroundColor = gaugeColor(pct);
    if (label) label.textContent = `${Math.round(used)} / ${dailyLimit} د`;

    const st = statusMap[emp.id];
    if (elapsedEl && st && st.openLog) {
      const elapsedMs = Date.now() - new Date(st.openLog.outAt).getTime();
      elapsedEl.textContent = `بريك من ${fmtElapsedHuman(elapsedMs)} — ${st.openLog.reason}`;
    }
  });
}

function renderHome() {
  app.innerHTML = `
    <p class="center muted">اختر اسمك</p>
    <div class="grid" id="empGrid"></div>
  `;
  const grid = document.getElementById("empGrid");
  employees.forEach(emp => {
    const st = statusMap[emp.id];
    const isOut = !!(st && st.openLog);
    const tile = document.createElement("div");
    tile.className = "tile" + (isOut ? " open-break" : "");
    tile.innerHTML = `
      <div>${emp.name}</div>
      ${isOut ? `<div class="sub" id="elapsed-${emp.id}"></div>` : ""}
      <div class="gauge-wrap"><div class="gauge-fill" id="gauge-${emp.id}" style="width:0%;"></div></div>
      <div class="gauge-label" id="gauge-label-${emp.id}"></div>
    `;
    tile.onclick = () => openEmployee(emp);
    grid.appendChild(tile);
  });
  updateGauges();
}

async function openEmployee(emp) {
  selectedEmployee = emp;
  stopHomePolling();
  app.innerHTML = `<p class="center muted">جاري التحقق...</p>`;
  const openLog = await Local.getOpenBreak(emp.id, emp.name);
  if (openLog) renderOpenBreak(emp, openLog);
  else renderReasonPicker(emp);
}

function renderReasonPicker(emp) {
  const reasons = (settings.reasons || "حمام,صلاة,أكل,خارج المطعم,استراحة").split(",").map(s => s.trim()).filter(Boolean);
  app.innerHTML = `
    <span class="back-link" onclick="loadHome()">‹ رجوع</span>
    <h2 class="center">${emp.name}</h2>
    <p class="center muted">وين رايح؟</p>
    <div class="reason-grid" id="reasonGrid"></div>
  `;
  const grid = document.getElementById("reasonGrid");
  reasons.forEach(reason => {
    const b = document.createElement("div");
    b.className = "reason-btn";
    b.textContent = reason;
    b.onclick = () => startBreak(emp, reason);
    grid.appendChild(b);
  });
}

async function startBreak(emp, reason) {
  app.innerHTML = `<p class="center muted">جاري التسجيل...</p>`;
  const res = await Local.startBreak(emp.id, emp.name, reason);
  showToast(`تم تسجيل الخروج (${reason}) الساعة ${fmtClock(new Date(res.outAt))}`);
  setTimeout(renderHome, 1600);
}

function renderOpenBreak(emp, log) {
  const maxMinutes = Number(settings.maxBreakMinutes) || 30;
  app.innerHTML = `
    <span class="back-link" onclick="loadHome()">‹ رجوع</span>
    <h2 class="center">${emp.name}</h2>
    <p class="center muted">بريك — السبب: ${log.reason}</p>
    <div class="timer" id="timerEl">00:00</div>
    <div class="center"><button class="btn danger" id="endBtn">تسجيل العودة</button></div>
  `;
  const outAt = new Date(log.outAt).getTime();
  const timerEl = document.getElementById("timerEl");
  function tick() {
    const elapsedMs = Date.now() - outAt;
    if (elapsedMs < 0) {
      // لسا ما بلش الاحتساب الرسمي (أول دقيقة بعد الضغط) — نعرض عد تنازلي واضح بدل رقم سالب مربك
      const remainingSec = Math.ceil(-elapsedMs / 1000);
      timerEl.textContent = `يبدأ الاحتساب خلال 00:${String(remainingSec).padStart(2, "0")}`;
      timerEl.classList.remove("over");
      return;
    }
    const mins = Math.floor(elapsedMs / 60000);
    const secs = Math.floor((elapsedMs % 60000) / 1000);
    timerEl.textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    timerEl.classList.toggle("over", mins >= maxMinutes);
  }
  tick();
  timerInterval = setInterval(tick, 1000);

  document.getElementById("endBtn").onclick = () => endBreak(emp, log);
}

async function endBreak(emp, log) {
  if (timerInterval) clearInterval(timerInterval);
  app.innerHTML = `<p class="center muted">جاري التسجيل...</p>`;
  const res = await Local.endBreak(log.id);
  const msg = res.overLimit
    ? `تم تسجيل العودة — المدة ${fmtDuration(res.durationMin)} (تجاوزت الوقت المسموح)`
    : `تم تسجيل العودة — المدة ${fmtDuration(res.durationMin)}`;
  showToast(msg, res.overLimit);
  setTimeout(renderHome, 1800);
}

loadHome();
