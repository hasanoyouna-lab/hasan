const app = document.getElementById("app");
const AUTH_KEY = "mt_admin_ok";

function fmtTime(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", hour12: false });
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
  if (sessionStorage.getItem(AUTH_KEY) === "1") return renderDashboard();
  renderLogin();
}

function renderLogin() {
  app.innerHTML = `
    <div class="panel" style="max-width:360px; margin:40px auto;">
      <p class="center">كلمة السر</p>
      <div class="row center" style="justify-content:center;">
        <input type="password" id="pw" style="width:160px;" />
        <button class="btn" id="loginBtn">دخول</button>
      </div>
      <p class="center muted" id="loginErr" style="display:none; color:#E5484D;">كلمة سر غلط</p>
    </div>
  `;
  const doLogin = async () => {
    const pw = document.getElementById("pw").value;
    try {
      const res = await Api.post("adminLogin", { password: pw });
      if (res.ok) { sessionStorage.setItem(AUTH_KEY, "1"); renderDashboard(); }
      else document.getElementById("loginErr").style.display = "block";
    } catch (e) {
      alert(e.message);
    }
  };
  document.getElementById("loginBtn").onclick = doLogin;
  document.getElementById("pw").addEventListener("keydown", ev => { if (ev.key === "Enter") doLogin(); });
}

async function renderDashboard() {
  app.innerHTML = `
    <div class="row" style="margin-bottom:16px;">
      <button class="btn secondary" data-tab="report">التقرير</button>
      <button class="btn secondary" data-tab="employees">الموظفين</button>
      <button class="btn secondary" data-tab="settings">الإعدادات</button>
      <a href="index.html" class="btn secondary" style="text-decoration:none; margin-inline-start:auto;">الكشك</a>
    </div>
    <div id="tabBody"></div>
  `;
  app.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => loadTab(b.dataset.tab));
  loadTab("report");
}

async function loadTab(tab) {
  const body = document.getElementById("tabBody");
  body.innerHTML = `<p class="muted center">جاري التحميل...</p>`;
  if (tab === "report") return renderReport(body);
  if (tab === "employees") return renderEmployees(body);
  if (tab === "settings") return renderSettings(body);
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
      return `<tr class="${cls}">
        <td>${l.employeeName}</td>
        <td>${l.reason}</td>
        <td>${new Date(l.outAt).toLocaleDateString("ar-EG")}</td>
        <td>${fmtTime(l.outAt)}${outMark}</td>
        <td>${l.status === "open" ? "لسا برا" : fmtTime(l.inAt) + inMark}</td>
        <td>${l.status === "open" ? "-" : fmtDuration(l.durationMin)}</td>
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
          <thead><tr><th>الموظف</th><th>السبب</th><th>التاريخ</th><th>الخروج</th><th>العودة</th><th>المدة</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="6" class="muted">ما في سجلات بهاي الفترة</td></tr>`}</tbody>
        </table>
        <p class="muted" style="margin-top:10px; font-size:12px;">📱 = تسجيل تم بجهاز أوفلاين (ساعة الجهاز)، مو ساعة السيرفر</p>
      </div>
    `;
    document.getElementById("filterBtn").onclick = () => {
      renderReport(body, document.getElementById("startDate").value, document.getElementById("endDate").value);
    };
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
        <p>الحد الأقصى لوقت البريك (دقيقة)</p>
        <div class="row">
          <input type="number" id="maxBreak" value="${settings.maxBreakMinutes || 30}" style="width:100px;" />
        </div>
        <p style="margin-top:20px;">أسباب الخروج (افصل بينها بفاصلة ,)</p>
        <div class="row">
          <input type="text" id="reasons" value="${settings.reasons || ''}" style="width:100%;" />
        </div>
        <p style="margin-top:20px;">كلمة سر الإدارة</p>
        <div class="row">
          <input type="text" id="adminPassword" value="${settings.adminPassword || ''}" style="width:160px;" />
        </div>
        <div class="row" style="margin-top:20px;">
          <button class="btn" id="saveBtn">حفظ</button>
          <span id="savedMsg" class="muted" style="display:none;">تم الحفظ ✓</span>
        </div>
      </div>
    `;
    document.getElementById("saveBtn").onclick = async () => {
      await Api.post("saveSettings", {
        maxBreakMinutes: Number(document.getElementById("maxBreak").value) || 30,
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
