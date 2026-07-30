const app = document.getElementById("app");

// اللوحة ما بتحفظ جلسة أبدًا: كلمة السر بتنطلب كل مرة تُفتح الصفحة، وبتنقفل
// لحالها بعد سكون. جهاز الكاشير مشترك، فأي لوحة ضلت مفتوحة = بيانات مكشوفة.
const LOCK_AFTER_MS = 90000;
let lockTimer = null;

function lockNow() {
  clearTimeout(lockTimer);
  lockTimer = null;
  if (nowRefreshTimer) { clearInterval(nowRefreshTimer); nowRefreshTimer = null; }
  renderLogin("انقفلت لعدم الاستخدام");
}
function armLock() {
  clearTimeout(lockTimer);
  lockTimer = setTimeout(lockNow, LOCK_AFTER_MS);
}
["pointerdown", "keydown"].forEach(ev =>
  document.addEventListener(ev, () => { if (lockTimer) armLock(); }, { passive: true }));
// الرجوع من الخلفية بعد غياب = إقفال فوري
document.addEventListener("visibilitychange", () => {
  if (document.hidden && lockTimer) lockNow();
});

function fmtTime(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", hour12: true });
}
function fmtDuration(mins) {
  if (mins === "" || mins === null || mins === undefined) return "-";
  const n = Number(mins);
  const h = Math.floor(n / 60), m = n % 60;
  return h > 0 ? `${h}س ${m}د` : `${m}د`;
}
function todayStr() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

async function boot() {
  sessionStorage.removeItem("mt_admin_ok"); // ينظّف جلسات النسخة القديمة اللي كانت بتضل مفتوحة
  renderLogin();
}

function renderLogin(note) {
  clearTimeout(lockTimer);
  lockTimer = null;
  app.innerHTML = `
    <div class="panel" style="max-width:380px; margin:40px auto;">
      <p class="center" style="font-weight:800;font-size:18px;margin-top:0">كلمة السر</p>
      ${note ? `<p class="center muted" style="margin-top:-6px">${note}</p>` : ""}
      <div class="row center" style="justify-content:center;">
        <input type="password" id="pw" inputmode="numeric" autocomplete="off" style="width:160px;" />
        <button class="btn" id="loginBtn">دخول</button>
      </div>
      <p class="center" id="loginErr" style="display:none; color:var(--danger-deep); font-weight:700;">كلمة سر غلط</p>
      <div class="center" style="margin-top:14px">
        <a href="index.html" style="color:var(--muted);font-size:14px;font-weight:700">‹ رجوع لشاشة الموظفين</a>
      </div>
    </div>
  `;
  const btn = document.getElementById("loginBtn");
  const doLogin = async () => {
    const pw = document.getElementById("pw").value;
    btn.disabled = true;
    try {
      const res = await Api.post("adminLogin", { password: pw });
      if (res.ok) { armLock(); renderDashboard(); }
      else {
        document.getElementById("loginErr").style.display = "block";
        document.getElementById("pw").value = "";
        btn.disabled = false;
      }
    } catch (e) {
      alert(e.message);
      btn.disabled = false;
    }
  };
  btn.onclick = doLogin;
  document.getElementById("pw").addEventListener("keydown", ev => { if (ev.key === "Enter") doLogin(); });
  document.getElementById("pw").focus();
}

async function renderDashboard() {
  app.innerHTML = `
    <div class="row" style="margin-bottom:16px;">
      <button class="btn secondary" data-tab="now">مين برا الآن</button>
      <button class="btn secondary" data-tab="report">التقرير</button>
      <button class="btn secondary" data-tab="employees">الموظفين</button>
      <button class="btn secondary" data-tab="settings">الإعدادات</button>
      <button class="btn danger" id="lockBtn" style="margin-inline-start:auto;">قفل</button>
      <a href="index.html" class="btn secondary" style="text-decoration:none;">الكشك</a>
    </div>
    <div id="tabBody"></div>
  `;
  document.getElementById("lockBtn").onclick = lockNow;
  app.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => loadTab(b.dataset.tab));
  loadTab("now");
}

let nowRefreshTimer = null;
async function loadTab(tab) {
  if (nowRefreshTimer) { clearInterval(nowRefreshTimer); nowRefreshTimer = null; }
  const body = document.getElementById("tabBody");
  body.innerHTML = `<p class="muted center">جاري التحميل...</p>`;
  if (tab === "now") return renderNow(body);
  if (tab === "report") return renderReport(body);
  if (tab === "employees") return renderEmployees(body);
  if (tab === "settings") return renderSettings(body);
}

// ==================== مين برا الآن ====================
async function renderNow(body) {
  try {
    const [openLogs, settings] = await Promise.all([Api.get("getOpenLogs"), Api.get("getSettings")]);
    const maxMinutes = Number(settings.maxBreakMinutes) || 30;
    if (!openLogs.length) {
      body.innerHTML = `<div class="panel center muted">ما في حدا برا هلق — الكل موجود ✅</div>`;
    } else {
      const rows = openLogs.map(l => {
        const elapsed = Math.floor((Date.now() - new Date(l.outAt).getTime()) / 60000);
        const cls = elapsed >= maxMinutes ? "overlimit" : "open";
        // تجاوز الضِعف = على الأغلب نسي يسجّل عودته، منميّزه حتى ما يضيع بين الباقي
        const stale = elapsed > maxMinutes * 2 ? " ⚠ غالبًا نسي العودة" : "";
        return `<tr class="${cls}">
          <td>${l.employeeName}</td>
          <td><span style="display:inline-flex;align-items:center;gap:6px;justify-content:center">
            ${Icons.svg(l.reason, 16)}${l.reason}</span></td>
          <td>${fmtTime(l.outAt)}</td>
          <td>${elapsed >= 0 ? elapsed + " د" : "-"}${stale}</td>
          <td><button class="btn danger" style="padding:6px 12px;font-size:13px"
                data-end="${l.id}" data-mins="${Math.max(0, elapsed)}">إنهاء</button></td>
        </tr>`;
      }).join("");
      body.innerHTML = `
        <div class="panel">
          <table>
            <thead><tr><th>الموظف</th><th>السبب</th><th>خرج الساعة</th><th>المدة الحالية</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <p class="muted" style="margin-top:10px; font-size:12px;">
            "إنهاء" بتسكّر بريك نسي صاحبه يضغط عودة — بتحدّد إنت المدة الصحيحة
          </p>
        </div>
      `;
      body.querySelectorAll("[data-end]").forEach(btn => btn.onclick = async () => {
        const val = prompt("مدة البريك بالدقائق:", btn.dataset.mins);
        if (val === null) return;
        const mins = Number(val);
        if (isNaN(mins) || mins < 0) { alert("رقم غير صالح"); return; }
        btn.disabled = true;
        try {
          await Api.post("forceEndBreak", { id: btn.dataset.end, durationMin: mins });
          renderNow(body);
        } catch (e) {
          alert("تعذّر الإنهاء: " + e.message);
          btn.disabled = false;
        }
      });
    }
    nowRefreshTimer = setInterval(() => renderNow(body), 10000);
  } catch (e) {
    body.innerHTML = `<p class="center muted">خطأ: ${e.message}</p>`;
  }
}

// ==================== التقرير ====================
async function renderReport(body, start, end) {
  start = start || todayStr();
  end = end || todayStr();
  try {
    const logs = await Api.get("getReport", { start, end });
    const isTrue = v => v === true || v === "TRUE";
    const rows = logs.map(l => {
      const cls = l.status === "open" ? "open" : (isTrue(l.overLimit) ? "overlimit" : "");
      const outMark = isTrue(l.outOffline) ? " 📱" : "";
      const inMark = isTrue(l.inOffline) ? " 📱" : "";
      const adjMark = isTrue(l.adjusted) ? ` <span title="معدّلة يدويًا">✎</span>` : "";
      return `<tr class="${cls}">
        <td>${l.employeeName}</td>
        <td><span style="display:inline-flex;align-items:center;gap:6px;justify-content:center">
          ${Icons.svg(l.reason, 16)}${l.reason}</span></td>
        <td>${new Date(l.outAt).toLocaleDateString("ar-EG")}</td>
        <td>${fmtTime(l.outAt)}${outMark}</td>
        <td>${l.status === "open" ? "لسا برا" : fmtTime(l.inAt) + inMark}</td>
        <td>${l.status === "open" ? "-" : fmtDuration(l.durationMin)}${adjMark}</td>
        <td><button class="btn secondary" style="padding:6px 12px;font-size:13px"
              data-fix="${l.id}" data-cur="${l.status === "open" ? "" : l.durationMin}">تعديل</button></td>
      </tr>`;
    }).join("");
    body.innerHTML = `
      <div class="panel">
        <div class="row">
          من <input type="date" id="startDate" value="${start}" />
          إلى <input type="date" id="endDate" value="${end}" />
          <button class="btn" id="filterBtn">تصفية</button>
        </div>
      </div>
      <div class="panel">
        <table>
          <thead><tr><th>الموظف</th><th>السبب</th><th>التاريخ</th><th>الخروج</th><th>العودة</th><th>المدة</th><th></th></tr></thead>
          <tbody>${rows || `<tr><td colspan="7" class="muted">ما في سجلات بهاي الفترة</td></tr>`}</tbody>
        </table>
        <p class="muted" style="margin-top:10px; font-size:12px;">
          📱 = تسجيل تم بجهاز بدون نت (ساعة الجهاز مش ساعة السيرفر) &nbsp;·&nbsp;
          ✎ = المدة معدّلة يدويًا &nbsp;·&nbsp;
          استخدم "تعديل" لو الموظف نسي يضغط عودة وضل العدّاد شغال
        </p>
      </div>
    `;
    document.getElementById("filterBtn").onclick = () => {
      renderReport(body, document.getElementById("startDate").value, document.getElementById("endDate").value);
    };
    body.querySelectorAll("[data-fix]").forEach(btn => btn.onclick = async () => {
      const cur = btn.dataset.cur;
      const val = prompt("المدة الصحيحة بالدقائق:", cur || "30");
      if (val === null) return;
      const mins = Number(val);
      if (isNaN(mins) || mins < 0) { alert("رقم غير صالح"); return; }
      btn.disabled = true;
      try {
        await Api.post("adjustDuration", { id: btn.dataset.fix, durationMin: mins });
        renderReport(body, document.getElementById("startDate").value, document.getElementById("endDate").value);
      } catch (e) {
        alert("تعذّر التعديل: " + e.message);
        btn.disabled = false;
      }
    });
  } catch (e) {
    body.innerHTML = `<p class="center muted">خطأ: ${e.message}</p>`;
  }
}

// ==================== الموظفين ====================
async function renderEmployees(body) {
  try {
    const employees = await Api.get("getEmployees", { all: "1" });
    const rows = employees.map(emp => `
      <tr>
        <td>${emp.name}</td>
        <td>${emp.active === true || emp.active === "TRUE" ? "فعّال" : "موقوف"}</td>
        <td>
          <button class="btn secondary" data-edit="${emp.id}">تعديل</button>
          <button class="btn danger" data-del="${emp.id}">${emp.active === true || emp.active === "TRUE" ? "إيقاف" : ""}</button>
        </td>
      </tr>
    `).join("");
    body.innerHTML = `
      <div class="panel">
        <div class="row">
          <input type="text" id="newName" placeholder="اسم موظف جديد" />
          <button class="btn" id="addBtn">إضافة</button>
        </div>
      </div>
      <div class="panel">
        <table><thead><tr><th>الاسم</th><th>الحالة</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table>
      </div>
    `;
    document.getElementById("addBtn").onclick = async () => {
      const name = document.getElementById("newName").value.trim();
      if (!name) return;
      await Api.post("saveEmployee", { name });
      renderEmployees(body);
    };
    body.querySelectorAll("[data-edit]").forEach(b => b.onclick = async () => {
      const emp = employees.find(x => x.id === b.dataset.edit);
      const name = prompt("الاسم الجديد:", emp.name);
      if (name && name.trim()) { await Api.post("saveEmployee", { id: emp.id, name: name.trim() }); renderEmployees(body); }
    });
    body.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
      if (!b.textContent) return;
      if (!confirm("متأكد إنك بدك توقف هاد الموظف؟")) return;
      await Api.post("deleteEmployee", { id: b.dataset.del });
      renderEmployees(body);
    });
  } catch (e) {
    body.innerHTML = `<p class="center muted">خطأ: ${e.message}</p>`;
  }
}

// ==================== الإعدادات ====================
async function renderSettings(body) {
  try {
    const settings = await Api.get("getSettings");
    body.innerHTML = `
      <div class="panel">
        <p><b>الحد الأقصى للبريك الواحد</b> (دقيقة) — العدّاد بيصير أحمر لما يتجاوزه</p>
        <div class="row">
          <input type="number" id="maxBreak" value="${settings.maxBreakMinutes || 30}" style="width:110px;" />
        </div>

        <p style="margin-top:22px;"><b>الحد اليومي لكل موظف</b> (دقيقة) — مجموع كل البريكات باليوم</p>
        <div class="row">
          <input type="number" id="dailyLimit" value="${settings.dailyLimitMinutes || 60}" style="width:110px;" />
        </div>

        <p style="margin-top:22px;"><b>فترة السماح العامة</b> (ثانية) — لأي سبب ما إله فترة خاصة</p>
        <div class="row">
          <input type="number" id="graceSec" value="${settings.breakStartDelaySec != null ? settings.breakStartDelaySec : 45}" style="width:110px;" />
        </div>

        <p style="margin-top:22px;"><b>فترة سماح خاصة لكل سبب</b> (دقيقة) — اتركه فاضي ليستخدم العامة</p>
        <div id="graceRows"></div>

        <p style="margin-top:22px;"><b>أسباب الخروج</b> (افصل بينها بفاصلة ,)</p>
        <div class="row">
          <input type="text" id="reasons" value="${settings.reasons || ''}" style="width:100%;" />
        </div>

        <p style="margin-top:22px;"><b>كلمة سر الإدارة</b></p>
        <div class="row">
          <input type="text" id="adminPassword" value="${settings.adminPassword || ''}" style="width:170px;" />
        </div>

        <div class="row" style="margin-top:24px;">
          <button class="btn" id="saveBtn">حفظ</button>
          <span id="savedMsg" class="muted" style="display:none;">تم الحفظ ✓</span>
        </div>
      </div>
    `;
    // صف لكل سبب موجود حاليًا. المدخل بالدقايق (أسهل للقراءة) والتخزين بالثواني.
    let graceMap = {};
    try { graceMap = JSON.parse(settings.reasonGraceSec || "{}"); } catch (e) { graceMap = {}; }
    const reasonList = (settings.reasons || "").split(",").map(s => s.trim()).filter(Boolean);
    document.getElementById("graceRows").innerHTML = reasonList.map(r => {
      const sec = Number(graceMap[r]);
      const mins = !isNaN(sec) && sec >= 0 ? (sec / 60) : "";
      return `<div class="row" style="margin-bottom:8px">
        <span style="display:inline-flex;align-items:center;gap:7px;min-width:150px;font-weight:700">
          ${Icons.svg(r, 18)}${r}</span>
        <input type="number" step="0.5" min="0" data-grace="${r.replace(/"/g, "&quot;")}"
               value="${mins}" placeholder="عام" style="width:100px" /> دقيقة
      </div>`;
    }).join("");

    document.getElementById("saveBtn").onclick = async () => {
      const newGrace = {};
      document.querySelectorAll("[data-grace]").forEach(inp => {
        const v = inp.value.trim();
        if (v === "") return;                       // فاضي = استخدم العامة
        const mins = Number(v);
        if (!isNaN(mins) && mins >= 0) newGrace[inp.dataset.grace] = Math.round(mins * 60);
      });
      await Api.post("saveSettings", {
        maxBreakMinutes: Number(document.getElementById("maxBreak").value) || 30,
        dailyLimitMinutes: Number(document.getElementById("dailyLimit").value) || 60,
        breakStartDelaySec: Number(document.getElementById("graceSec").value) || 0,
        reasonGraceSec: JSON.stringify(newGrace),
        reasons: document.getElementById("reasons").value,
        adminPassword: document.getElementById("adminPassword").value
      });
      const msg = document.getElementById("savedMsg");
      msg.style.display = "inline";
      setTimeout(() => msg.style.display = "none", 2000);
    };
  } catch (e) {
    body.innerHTML = `<p class="center muted">خطأ: ${e.message}</p>`;
  }
}

boot();
