const app = document.getElementById("app");
let employees = [];
let settings = {};
let selectedEmployee = null;
let timerInterval = null;

function fmtClock(d) {
  return d.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}
setInterval(() => { document.getElementById("clock").textContent = fmtClock(new Date()); }, 1000);

function updateOfflineBanner() {
  const banner = document.getElementById("offlineBanner");
  const pending = Local.pendingCount();
  if (!navigator.onLine) {
    banner.style.display = "block";
    banner.textContent = "أنت غير متصل بالإنترنت — البيانات بتتخزن على الجهاز وبتترفع تلقائيًا لما يرجع النت";
  } else if (pending > 0) {
    banner.style.display = "block";
    banner.textContent = `جاري رفع ${pending} سجل معلّق للسيرفر...`;
  } else {
    banner.style.display = "none";
  }
}
setInterval(updateOfflineBanner, 3000);
window.addEventListener("online", updateOfflineBanner);
window.addEventListener("offline", updateOfflineBanner);

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

async function loadHome() {
  selectedEmployee = null;
  if (timerInterval) clearInterval(timerInterval);
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
  renderHome();
  updateOfflineBanner();
}

function renderHome() {
  app.innerHTML = `
    <p class="center muted">اختر اسمك</p>
    <div class="grid" id="empGrid"></div>
  `;
  const grid = document.getElementById("empGrid");
  employees.forEach(emp => {
    const tile = document.createElement("div");
    tile.className = "tile";
    tile.textContent = emp.name;
    tile.onclick = () => openEmployee(emp);
    grid.appendChild(tile);
  });
}

async function openEmployee(emp) {
  selectedEmployee = emp;
  app.innerHTML = `<p class="center muted">جاري التحقق...</p>`;
  const openLog = await Local.getOpenBreak(emp.id, emp.name);
  if (openLog) renderOpenBreak(emp, openLog);
  else renderReasonPicker(emp);
}

function renderReasonPicker(emp) {
  const reasons = (settings.reasons || "حمام,صلاة,أكل,خارج المطعم,استراحة").split(",").map(s => s.trim()).filter(Boolean);
  app.innerHTML = `
    <span class="back-link" onclick="renderHome()">‹ رجوع</span>
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
  const msg = res.offline
    ? `تم الحفظ محليًا (${reason}) — بيترفع للسيرفر أول ما يرجع النت`
    : `تم تسجيل الخروج (${reason}) الساعة ${fmtClock(new Date(res.outAt))}`;
  showToast(msg, res.offline);
  updateOfflineBanner();
  setTimeout(renderHome, 1600);
}

function renderOpenBreak(emp, log) {
  const maxMinutes = Number(settings.maxBreakMinutes) || 30;
  app.innerHTML = `
    <span class="back-link" onclick="renderHome()">‹ رجوع</span>
    <h2 class="center">${emp.name}</h2>
    <p class="center muted">بريك مفتوح — السبب: ${log.reason}</p>
    <div class="timer" id="timerEl">00:00</div>
    <div class="center"><button class="btn danger" id="endBtn">تسجيل العودة</button></div>
  `;
  const outAt = new Date(log.outAt).getTime();
  const timerEl = document.getElementById("timerEl");
  function tick() {
    const elapsedMs = Date.now() - outAt;
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
  const msg = res.offline
    ? `تم حفظ العودة محليًا — بترفع للسيرفر أول ما يرجع النت`
    : (res.overLimit
      ? `تم تسجيل العودة — المدة ${fmtDuration(res.durationMin)} (تجاوزت الوقت المسموح)`
      : `تم تسجيل العودة — المدة ${fmtDuration(res.durationMin)}`);
  showToast(msg, res.offline || res.overLimit);
  updateOfflineBanner();
  setTimeout(renderHome, 1800);
}

loadHome();
