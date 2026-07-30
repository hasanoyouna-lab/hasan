/**
 * متابعة الموظفين — Apps Script backend.
 * Bind this script to a Google Sheet with these tabs (header row = row 1):
 *   Employees: id, name, active, sortOrder, updatedAt
 *   Logs:      id, employeeId, employeeName, reason, outAt, inAt, durationMin, status, overLimit, updatedAt
 *   Settings:  key, value, updatedAt
 *
 * Deploy: Deploy > New deployment > Web app > Execute as: Me > Who has access: Anyone.
 * Every code change needs a NEW deployment version (Deploy > Manage deployments > Edit > New version)
 * or the live /exec URL keeps running the old code.
 */

var SHEET_NAMES = {
  EMPLOYEES: 'Employees',
  LOGS: 'Logs',
  SETTINGS: 'Settings'
};

var SHEET_HEADERS = {
  Employees: ['id', 'name', 'active', 'sortOrder', 'updatedAt'],
  // ملاحظة: أي عمود جديد لازم ينضاف بآخر القائمة. لو انحشر بالنص، بيصير عدم تطابق
  // بين العناوين والبيانات الموجودة أصلاً بالصفوف القديمة.
  Logs: ['id', 'employeeId', 'employeeName', 'reason', 'outAt', 'inAt', 'durationMin', 'status', 'overLimit', 'outOffline', 'inOffline', 'updatedAt', 'adjusted'],
  Settings: ['key', 'value', 'updatedAt']
};

var DEFAULT_REASONS = 'حمام,صلاة,أكل,الذهاب للخارج,استراحة';

/**
 * شغّل هاي الدالة مرة وحدة بس (▶ Run فوق، اختارها من القائمة، وافق على الصلاحيات).
 * بتنشئ كل التبويبات المطلوبة تلقائياً بأسماء وأعمدة صحيحة، وبتعبي إعدادات افتراضية.
 * ممكن تشغّلها أكثر من مرة بأمان.
 */
function setupEverything() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  Object.keys(SHEET_HEADERS).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    var headers = SHEET_HEADERS[name];
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.getRange(2, 1, 2000, headers.length).setNumberFormat('@');
  });

  var defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1 && defaultSheet.getLastRow() === 0) {
    ss.deleteSheet(defaultSheet);
  }

  seedInitialDataIfEmpty();
  ensureDefaultSetting('dailyLimitMinutes', 60);
  ensureDefaultSetting('breakStartDelaySec', BREAK_START_DELAY_SEC);
  return 'تم إعداد كل التبويبات بنجاح';
}

// يضيف إعداد افتراضي بس إذا كان مش موجود أصلاً (ما بيلمس قيمة موجودة سابقاً حتى لو تغيّرت يدوياً)
function ensureDefaultSetting(key, defaultValue) {
  var r = readRows(SHEET_NAMES.SETTINGS);
  var exists = r.rows.some(function (row) { return row.key === key; });
  if (!exists) appendRow(SHEET_NAMES.SETTINGS, { key: key, value: defaultValue, updatedAt: nowIso() });
}

function seedInitialDataIfEmpty() {
  var employeesSheet = sheet(SHEET_NAMES.EMPLOYEES);
  if (employeesSheet.getLastRow() < 2) {
    var now = nowIso();
    var employees = [1, 2, 3, 4, 5].map(function (n) {
      return [Utilities.getUuid(), 'موظف ' + n, true, n, now];
    });
    employeesSheet.getRange(2, 1, employees.length, 5).setValues(employees);
  }

  var settingsSheet = sheet(SHEET_NAMES.SETTINGS);
  if (settingsSheet.getLastRow() < 2) {
    var now2 = nowIso();
    var settings = [
      ['maxBreakMinutes', 30, now2],
      ['dailyLimitMinutes', 60, now2],
      ['adminPassword', '1234', now2],
      ['reasons', DEFAULT_REASONS, now2]
    ];
    settingsSheet.getRange(2, 1, settings.length, 3).setValues(settings);
  }
}

function doGet(e) {
  try {
    var action = e.parameter.action;
    var data;
    switch (action) {
      case 'getEmployees': data = getEmployees(e.parameter.all === '1'); break;
      case 'getOpenLog': data = getOpenLog(e.parameter.employeeId); break;
      case 'getOpenLogs': data = getOpenLogs(); break;
      case 'getStatus': data = getStatus(); break;
      case 'getReport': data = getReport(e.parameter.start, e.parameter.end); break;
      case 'getSettings': data = getSettings(); break;
      case 'runSetup': data = setupEverything(); break;
      case 'repairDurations': data = repairNegativeDurations(); break;
      default: throw new Error('unknown action: ' + action);
    }
    return jsonOut({ ok: true, data: data });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var body = JSON.parse(e.postData.contents); // {action, payload}
    var data;
    switch (body.action) {
      case 'startBreak': data = startBreak(body.payload); break;
      case 'endBreak': data = endBreak(body.payload); break;
      case 'saveEmployee': data = saveEmployee(body.payload); break;
      case 'deleteEmployee': data = deleteEmployee(body.payload); break;
      case 'saveSettings': data = saveSettings(body.payload); break;
      case 'adminLogin': data = adminLogin(body.payload); break;
      case 'adjustDuration': data = adjustDuration(body.payload); break;
      case 'forceEndBreak': data = forceEndBreak(body.payload); break;
      default: throw new Error('unknown action: ' + body.action);
    }
    return jsonOut({ ok: true, data: data });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ==================== helpers ====================

function sheet(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('missing sheet tab: ' + name);
  return sh;
}

function isDateValue(v) {
  return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime());
}
// أعمدة outAt/inAt/updatedAt نصوص ISO لكن Sheets ممكن يفسرها كتاريخ رغم تهيئة العمود كنص عادي؛
// نطبّعها لنص ISO مرة وحدة بعد كل قراءة حتى تضل كل المقارنات والفرز صحيحة.
function normalizeIsoValue(v) {
  if (isDateValue(v)) return v.toISOString();
  return v;
}

function readRows(name) {
  var sh = sheet(name);
  var values = sh.getDataRange().getValues();
  var headers = values[0];
  var isoCols = ['outAt', 'inAt', 'updatedAt'].map(function (h) { return headers.indexOf(h); });
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var row = {};
    for (var c = 0; c < headers.length; c++) row[headers[c]] = values[i][c];
    isoCols.forEach(function (c) { if (c >= 0) row[headers[c]] = normalizeIsoValue(row[headers[c]]); });
    rows.push(row);
  }
  return { sh: sh, headers: headers, rows: rows };
}

// نفس readRows بس بتقرأ آخر N صف فقط. تبويب Logs بينمو بلا حدود، والشاشة الرئيسية
// بتسأل عن حالة اليوم كل ٢٠ ثانية — قراءة الشيت كامل كل مرة بتصير أبطأ وأبطأ مع الوقت.
// السجلات مضافة بالترتيب الزمني، فآخر الصفوف دايماً هي الأحدث.
function readRecentRows(name, count) {
  var sh = sheet(name);
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  if (lastRow < 2) return { sh: sh, headers: headers, rows: [] };

  var startRow = Math.max(2, lastRow - count + 1);
  var values = sh.getRange(startRow, 1, lastRow - startRow + 1, lastCol).getValues();
  var isoCols = ['outAt', 'inAt', 'updatedAt'].map(function (h) { return headers.indexOf(h); });
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    var row = {};
    for (var c = 0; c < headers.length; c++) row[headers[c]] = values[i][c];
    isoCols.forEach(function (c) { if (c >= 0) row[headers[c]] = normalizeIsoValue(row[headers[c]]); });
    rows.push(row);
  }
  return { sh: sh, headers: headers, rows: rows };
}

// اليوم المحلي (توقيت الشيت) لسجل معيّن. مهم جداً: outAt مخزّن UTC، فقص أول ١٠ أحرف
// منه مباشرة بينسب أي بريك بين منتصف الليل و٣ الصبح لليوم اللي قبله بالغلط.
function localDayOf(iso, tz) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, tz || Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function appendRow(name, obj) {
  var sh = sheet(name);
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var row = headers.map(function (h) { return obj.hasOwnProperty(h) ? obj[h] : ''; });
  sh.appendRow(row);
}

function nowIso() { return new Date().toISOString(); }

// ==================== Employees ====================

function getEmployees(all) {
  var r = readRows(SHEET_NAMES.EMPLOYEES);
  var rows = all ? r.rows : r.rows.filter(function (emp) { return emp.active === true || emp.active === 'TRUE'; });
  rows.sort(function (a, b) { return Number(a.sortOrder) - Number(b.sortOrder); });
  return rows;
}

function saveEmployee(p) {
  var r = readRows(SHEET_NAMES.EMPLOYEES);
  if (!p.id) p.id = Utilities.getUuid();
  var isNew = !r.rows.some(function (row) { return row.id === p.id; });
  p.updatedAt = nowIso();
  if (isNew) {
    var maxSort = r.rows.reduce(function (m, row) { return Math.max(m, Number(row.sortOrder) || 0); }, 0);
    appendRow(SHEET_NAMES.EMPLOYEES, {
      id: p.id, name: p.name, active: true,
      sortOrder: p.sortOrder || (maxSort + 1), updatedAt: p.updatedAt
    });
  } else {
    var idx = -1;
    for (var i = 0; i < r.rows.length; i++) { if (r.rows[i].id === p.id) { idx = i; break; } }
    var rowNum = idx + 2;
    r.headers.forEach(function (h, c) {
      if (p.hasOwnProperty(h)) r.sh.getRange(rowNum, c + 1).setValue(p[h]);
    });
  }
  return { id: p.id };
}

function deleteEmployee(p) {
  var r = readRows(SHEET_NAMES.EMPLOYEES);
  for (var i = 0; i < r.rows.length; i++) {
    if (r.rows[i].id === p.id) {
      var rowNum = i + 2;
      var activeCol = r.headers.indexOf('active') + 1;
      var updatedCol = r.headers.indexOf('updatedAt') + 1;
      r.sh.getRange(rowNum, activeCol).setValue(false);
      r.sh.getRange(rowNum, updatedCol).setValue(nowIso());
      break;
    }
  }
  return { id: p.id };
}

// ==================== Breaks (Logs) ====================

function getOpenLog(employeeId) {
  var rows = readRecentRows(SHEET_NAMES.LOGS, 500).rows;
  var open = rows.filter(function (r) { return r.employeeId === employeeId && r.status === 'open'; });
  return open.length ? open[open.length - 1] : null;
}

// كل الموظفين البرا حاليًا (بريك مفتوح)، تستخدم للوحة "مين برا الآن"
function getOpenLogs() {
  var rows = readRecentRows(SHEET_NAMES.LOGS, 500).rows;
  return rows.filter(function (r) { return r.status === 'open'; })
    .sort(function (a, b) { return a.outAt < b.outAt ? -1 : 1; });
}

// إجمالي دقائق البريكات المستخدمة اليوم لكل موظف (كل البريكات المقفولة + البريك المفتوح
// الحالي إذا في)، يستخدم لميزان الحرارة بالواجهة (أخضر ← أحمر حسب الحد اليومي dailyLimitMinutes).
function getStatus() {
  var tz = Session.getScriptTimeZone();
  var todayStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var rows = readRecentRows(SHEET_NAMES.LOGS, 500).rows;
  var byEmployee = {};
  rows.forEach(function (r) {
    var day = localDayOf(r.outAt, tz);
    if (day !== todayStr) return;
    if (!byEmployee[r.employeeId]) byEmployee[r.employeeId] = { closedMinutes: 0, openLog: null };
    if (r.status === 'closed') {
      byEmployee[r.employeeId].closedMinutes += Math.max(0, Number(r.durationMin) || 0);
    } else if (r.status === 'open') {
      byEmployee[r.employeeId].openLog = { id: r.id, reason: r.reason, outAt: r.outAt };
    }
  });
  return byEmployee;
}

var BREAK_START_DELAY_SEC = 45; // احتياطي فقط؛ القيمة الفعلية من إعداد breakStartDelaySec

function addSecondsIso(iso, secs) {
  return new Date(new Date(iso).getTime() + secs * 1000).toISOString();
}

// مصدر واحد للحقيقة: الواجهة بتقرأ نفس الإعداد عشان العدّاد اللي بيشوفه الموظف
// يطابق تمامًا الوقت اللي بينحفظ بالسيرفر.
function breakStartDelaySec() {
  var v = Number(getSettings().breakStartDelaySec);
  return isNaN(v) || v < 0 ? BREAK_START_DELAY_SEC : v;
}

// وقت الخروج المسجل يبلش بعد BREAK_START_DELAY_SEC ثانية من لحظة الضغط (قرار متفق عليه) —
// clientOutAt بيوصل بس لما التسجيل صار أصلاً بجهاز أوفلاين وقت الضغط (فيه ساعة الجهاز، مو السيرفر).
function startBreak(p) {
  var existing = getOpenLog(p.employeeId);
  if (existing && existing.id !== p.id) throw new Error('في بريك مفتوح أصلاً لهاد الموظف');
  if (existing) return { id: existing.id, outAt: existing.outAt }; // نداء متكرر لنفس id (إعادة محاولة مزامنة)

  var id = p.id || Utilities.getUuid();
  var now = nowIso();
  var outAt = p.clientOutAt ? p.clientOutAt : addSecondsIso(now, breakStartDelaySec());
  var outOffline = !!p.clientOutAt;
  appendRow(SHEET_NAMES.LOGS, {
    id: id, employeeId: p.employeeId, employeeName: p.employeeName, reason: p.reason,
    outAt: outAt, inAt: '', durationMin: '', status: 'open', overLimit: false,
    outOffline: outOffline, inOffline: false, updatedAt: now
  });
  return { id: id, outAt: outAt };
}

function endBreak(p) {
  var r = readRows(SHEET_NAMES.LOGS);
  var idx = -1;
  for (var i = 0; i < r.rows.length; i++) { if (r.rows[i].id === p.id) { idx = i; break; } }
  if (idx < 0) throw new Error('سجل غير موجود');
  var row = r.rows[idx];
  if (row.status !== 'open') return { id: p.id, inAt: row.inAt, durationMin: Number(row.durationMin), overLimit: row.overLimit === true || row.overLimit === 'TRUE' };

  var now = nowIso();
  var inAt = p.clientInAt ? p.clientInAt : now; // العودة تتسجل فورًا دايماً، بدون تأخير
  var inOffline = !!p.clientInAt;
  var outDate = new Date(row.outAt);
  var inDate = new Date(inAt);
  // outAt مؤجّل بمهلة الاحتساب، فلو رجع الموظف خلال المهلة بتطلع النتيجة سالبة.
  // الصح إنها صفر: هو رجع قبل ما يبدأ الاحتساب أصلاً، مش إنه "وفّر" وقت من رصيده.
  var durationMin = Math.max(0, Math.round((inDate.getTime() - outDate.getTime()) / 60000));
  var settings = getSettings();
  var maxMinutes = Number(settings.maxBreakMinutes) || 30;
  var overLimit = durationMin > maxMinutes;

  var rowNum = idx + 2;
  var obj = { inAt: inAt, durationMin: durationMin, status: 'closed', overLimit: overLimit, inOffline: inOffline, updatedAt: now };
  r.headers.forEach(function (h, c) {
    if (obj.hasOwnProperty(h)) r.sh.getRange(rowNum, c + 1).setValue(obj[h]);
  });
  return { id: p.id, inAt: inAt, durationMin: durationMin, overLimit: overLimit };
}

// تصحيح مدة بريك يدويًا من لوحة الإدارة. الحالة الشائعة: الموظف نسي يضغط "عودة"
// فالعدّاد ضل شغال. بنعلّم السجل adjusted=true عشان يضل واضح بالتقرير إنه معدّل يدويًا.
function adjustDuration(p) {
  var r = readRows(SHEET_NAMES.LOGS);
  var idx = -1;
  for (var i = 0; i < r.rows.length; i++) { if (r.rows[i].id === p.id) { idx = i; break; } }
  if (idx < 0) throw new Error('سجل غير موجود');

  var mins = Math.max(0, Math.round(Number(p.durationMin)));
  if (isNaN(mins)) throw new Error('مدة غير صالحة');

  var row = r.rows[idx];
  var maxMinutes = Number(getSettings().maxBreakMinutes) || 30;
  var rowNum = idx + 2;
  // نعيد حساب inAt من outAt + المدة الجديدة، حتى يضل السجل متماسك مع نفسه
  var newInAt = addSecondsIso(row.outAt, mins * 60);
  var obj = {
    inAt: newInAt, durationMin: mins, status: 'closed',
    overLimit: mins > maxMinutes, adjusted: true, updatedAt: nowIso()
  };
  r.headers.forEach(function (h, c) {
    if (obj.hasOwnProperty(h)) r.sh.getRange(rowNum, c + 1).setValue(obj[h]);
  });
  return { id: p.id, durationMin: mins, overLimit: obj.overLimit };
}

// إنهاء بريك نسي صاحبه يسكّره، بمدة يحددها المدير
function forceEndBreak(p) {
  return adjustDuration(p);
}

// إصلاح لمرة وحدة للسجلات القديمة اللي انحفظت بمدة سالبة (عودة خلال مهلة الاحتساب)
// قبل ما ينضاف الحد الأدنى بـ endBreak. آمن تشغيلها أكثر من مرة.
function repairNegativeDurations() {
  var r = readRows(SHEET_NAMES.LOGS);
  var durCol = r.headers.indexOf('durationMin') + 1;
  if (durCol < 1) return { fixed: 0 };
  var fixed = 0;
  for (var i = 0; i < r.rows.length; i++) {
    var d = Number(r.rows[i].durationMin);
    if (!isNaN(d) && d < 0) {
      r.sh.getRange(i + 2, durCol).setValue(0);
      fixed++;
    }
  }
  return { fixed: fixed };
}

function getReport(start, end) {
  var tz = Session.getScriptTimeZone();
  var rows = readRows(SHEET_NAMES.LOGS).rows;
  var filtered = rows.filter(function (r) {
    var d = localDayOf(r.outAt, tz);
    return d && d >= start && d <= end;
  });
  filtered.sort(function (a, b) { return a.outAt < b.outAt ? 1 : -1; });
  return filtered;
}

// ==================== Settings ====================

function getSettings() {
  var rows = readRows(SHEET_NAMES.SETTINGS).rows;
  var out = {};
  rows.forEach(function (r) { out[r.key] = r.value; });
  return out;
}

function saveSettings(p) {
  var r = readRows(SHEET_NAMES.SETTINGS);
  Object.keys(p).forEach(function (key) {
    var existingIdx = -1;
    for (var i = 0; i < r.rows.length; i++) { if (r.rows[i].key === key) { existingIdx = i; break; } }
    if (existingIdx >= 0) {
      var rowNum = existingIdx + 2;
      var valueCol = r.headers.indexOf('value') + 1;
      var updatedCol = r.headers.indexOf('updatedAt') + 1;
      r.sh.getRange(rowNum, valueCol).setValue(p[key]);
      if (updatedCol > 0) r.sh.getRange(rowNum, updatedCol).setValue(nowIso());
    } else {
      appendRow(SHEET_NAMES.SETTINGS, { key: key, value: p[key], updatedAt: nowIso() });
    }
  });
  return getSettings();
}

function adminLogin(p) {
  var settings = getSettings();
  var pass = settings.adminPassword || '1234';
  return { ok: String(p.password) === String(pass) };
}
