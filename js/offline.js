// دعم العمل بدون إنترنت — احتياطي بس. الأساس دايماً محاولة الاتصال المباشر بالسيرفر
// (ساعة السيرفر هي المرجع الموثوق لمنع التلاعب). لو ما في نت وقت الضغط، نسجل وقت
// ساعة الجهاز نفسه محلياً ونعلّم السجل "offline" بوضوح، وبنحاول نرفعه أول ما يرجع النت.
const Local = (() => {
  const BREAKS_KEY = "att_local_breaks"; // { [id]: {employeeId, employeeName, reason, outAt, inAt, needsSync:{start,end}} }
  const QUEUE_KEY = "att_queue"; // [{ id, type: 'start'|'end' }]
  const CACHE_KEY = "att_cache"; // { employees, settings }
  const STATUS_KEY = "att_status_cache"; // { day, map } — آخر حالة يومية معروفة من السيرفر

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (e) { return fallback; }
  }
  function writeJson(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

  function getBreaks() { return readJson(BREAKS_KEY, {}); }
  function setBreaks(v) { writeJson(BREAKS_KEY, v); }
  function getQueue() { return readJson(QUEUE_KEY, []); }
  function setQueue(v) { writeJson(QUEUE_KEY, v); }

  function cacheSet(employees, settings) { writeJson(CACHE_KEY, { employees, settings }); }
  function cacheGet() { return readJson(CACHE_KEY, null); }

  function localDayKey(d) {
    d = d || new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  // نخزّن آخر حالة يومية جات من السيرفر، عشان لو فتح الموقع بدون نت يضل العداد اليومي
  // مبني على أرقام حقيقية مش صفر. بنرميها لو صارت من يوم قديم حتى ما نعرض أرقام مبارح.
  function statusCacheSet(map) { writeJson(STATUS_KEY, { day: localDayKey(), map: map }); }
  function statusCacheGet() {
    const c = readJson(STATUS_KEY, null);
    return c && c.day === localDayKey() ? c.map : null;
  }

  function newId() {
    return (crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
  }

  // مستمعين بينتبهوا لما وقت بريك يتصحّح من السيرفر، حتى العدّاد المعروض يصحّح نفسه
  const outAtListeners = [];
  function onOutAtCorrected(fn) { outAtListeners.push(fn); }
  function emitOutAtCorrected(id, outAt) { outAtListeners.forEach(fn => fn(id, outAt)); }

  // ==================== بدء بريك ====================
  // بيرجع {id, outAt} فورًا وبشكل متزامن — بدون أي انتظار للشبكة. الموظف يشوف
  // العدّاد شغال بنفس اللحظة، والمزامنة تصير بالخلفية. لو السيرفر رجّع وقت مختلف
  // شوي (فرق أجزاء الثانية)، بننبّه الواجهة تصحّح العدّاد بهدوء.
  function startBreak(employeeId, employeeName, reason, graceSec) {
    const id = newId();
    const delayMs = (typeof graceSec === "number" ? graceSec : 45) * 1000;
    const localOutAt = new Date(Date.now() + delayMs).toISOString();

    const breaks = getBreaks();
    breaks[id] = { employeeId, employeeName, reason, outAt: localOutAt, inAt: null, needsSync: { start: true, end: false } };
    setBreaks(breaks);

    Api.post("startBreak", { id, employeeId, employeeName, reason })
      .then(res => {
        const b = getBreaks();
        if (!b[id]) return;
        b[id].outAt = res.outAt;
        b[id].needsSync.start = false;
        setBreaks(b);
        if (res.outAt !== localOutAt) emitOutAtCorrected(id, res.outAt);
      })
      .catch(() => enqueue(id, "start"));

    return { id, outAt: localOutAt };
  }

  // ==================== إنهاء بريك ====================
  // نفس الفكرة: بنحسب المدة محليًا ونرجّعها فورًا للعرض، والسيرفر بيضل هو
  // المرجع الموثوق للوقت المحفوظ (ما بنبعتله وقتنا إلا لو كنا أوفلاين).
  function endBreak(id, maxBreakMinutes) {
    const breaks = getBreaks();
    const rec = breaks[id];
    const localInAt = new Date().toISOString();

    if (rec) { rec.inAt = localInAt; rec.needsSync.end = true; setBreaks(breaks); }

    const outMs = rec ? new Date(rec.outAt).getTime() : Date.now();
    const durationMin = Math.max(0, Math.round((new Date(localInAt).getTime() - outMs) / 60000));
    const limit = Number(maxBreakMinutes) || 30;

    Api.post("endBreak", { id })
      .then(() => {
        const b = getBreaks();
        if (b[id]) { b[id].needsSync.end = false; setBreaks(b); maybeCleanup(id); }
      })
      .catch(() => enqueue(id, "end"));

    return { id, inAt: localInAt, durationMin, overLimit: durationMin > limit };
  }

  function enqueue(id, type) {
    const q = getQueue();
    if (!q.some(item => item.id === id && item.type === type)) {
      q.push({ id, type, createdAt: Date.now(), attempts: 0 });
      setQueue(q);
    }
    scheduleFlush();
  }

  function maybeCleanup(id) {
    const breaks = getBreaks();
    const rec = breaks[id];
    if (rec && !rec.needsSync.start && !rec.needsSync.end && rec.inAt) {
      delete breaks[id];
      setBreaks(breaks);
    }
  }

  // ==================== الحالة المفتوحة لموظف معيّن (تدمج المحلي + السيرفر) ====================
  async function getOpenBreak(employeeId, employeeName) {
    const breaks = getBreaks();
    const localOpen = Object.entries(breaks).find(([id, r]) => r.employeeId === employeeId && !r.inAt);
    if (localOpen) {
      const [id, r] = localOpen;
      return { id, employeeId: r.employeeId, employeeName: r.employeeName, reason: r.reason, outAt: r.outAt, status: "open" };
    }
    try {
      return await Api.get("getOpenLog", { employeeId });
    } catch (e) {
      return null; // أوفلاين وما عندنا سجل محلي مفتوح لهاد الموظف — نفترض ما في بريك مفتوح
    }
  }

  // كل البريكات المفتوحة المخزّنة محليًا (تُستخدم لعرض العداد وحالة "برا" حتى بدون نت،
  // وحتى لو ما نجحت المزامنة بعد). key = employeeId
  function getAllLocalOpenBreaks() {
    const breaks = getBreaks();
    const out = {};
    Object.entries(breaks).forEach(([id, r]) => {
      if (!r.inAt) out[r.employeeId] = { id, reason: r.reason, outAt: r.outAt };
    });
    return out;
  }

  // لو السيرفر أكّد استلام بداية البريك، وبعدها صار ما بيعرضه مفتوح (انقفل من جهاز
  // تاني أو من لوحة الإدارة)، معناها النسخة المحلية بايتة. بنمسحها حتى الموظف
  // ما يضل "معلّق برا" على هاد الجهاز للأبد.
  function reconcileWithServer(serverStatus) {
    if (!serverStatus) return;
    const breaks = getBreaks();
    let changed = false;
    Object.entries(breaks).forEach(([id, r]) => {
      if (r.inAt) return;                 // مسكّر محليًا أصلاً
      if (r.needsSync && r.needsSync.start) return; // لسا ما وصل السيرفر — نخلي الطابور يحاول
      const st = serverStatus[r.employeeId];
      const stillOpenOnServer = st && st.openLog && st.openLog.id === id;
      if (!stillOpenOnServer) { delete breaks[id]; changed = true; }
    });
    if (changed) setBreaks(breaks);
  }

  // ==================== المزامنة ====================
  // بعد هالعدد من المحاولات الفاشلة بنعتبر العنصر ميؤوس منه ونرميه. بدون هاد، عنصر
  // واحد مرفوض من السيرفر (مثلاً بريك انحذف) بيسدّ الطابور ويمنع كل البريكات
  // اللي بعده من الوصول للشيت نهائيًا.
  const MAX_ATTEMPTS = 10;
  let flushing = false;
  async function flushQueue() {
    if (flushing) return;
    flushing = true;
    try {
      let q = getQueue();
      while (q.length) {
        const item = q[0];
        const backoff = Math.min(Math.pow(2, item.attempts) * 4000, 60000);
        if (item.lastAttemptAt && Date.now() - item.lastAttemptAt < backoff) break;
        const breaks = getBreaks();
        const rec = breaks[item.id];
        if (!rec) { q.shift(); setQueue(q); continue; }
        try {
          item.lastAttemptAt = Date.now();
          if (item.type === "start") {
            await Api.post("startBreak", { id: item.id, employeeId: rec.employeeId, employeeName: rec.employeeName, reason: rec.reason, clientOutAt: rec.outAt });
            rec.needsSync.start = false;
          } else {
            await Api.post("endBreak", { id: item.id, clientInAt: rec.inAt });
            rec.needsSync.end = false;
          }
          setBreaks(breaks);
          q.shift();
          setQueue(q);
          maybeCleanup(item.id);
        } catch (e) {
          // انقطاع نت = فشل مؤقت. ما بنعدّه ولا بنرمي شي أبدًا — بنوقف وبنعيد المحاولة
          // لاحقًا مهما طالت المدة. (رمي البيانات هون كان بيمسح بريكات الموظفين
          // لو الجهاز قعد بدون نت أكثر من كم دقيقة.)
          if (!e || !e.serverRejected) {
            setQueue(q);
            break;
          }
          // السيرفر رد ورفض الطلب — إعادة المحاولة ما رح تغيّر النتيجة. بنجرب شوي
          // تحسبًا لخلل مؤقت، وبعدين بنرميه حتى ما يسدّ باقي الطابور.
          item.attempts += 1;
          if (item.attempts >= MAX_ATTEMPTS) {
            const dead = getBreaks();
            delete dead[item.id];
            setBreaks(dead);
            q.shift();
            setQueue(q);
            continue;
          }
          setQueue(q);
          break;
        }
      }
    } finally {
      flushing = false;
    }
  }

  let flushTimer = null;
  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => { flushTimer = null; flushQueue(); }, 500);
  }

  function pendingCount() { return getQueue().length; }

  window.addEventListener("online", flushQueue);
  setInterval(flushQueue, 20000);

  return {
    startBreak, endBreak, getOpenBreak, getAllLocalOpenBreaks,
    cacheSet, cacheGet, statusCacheSet, statusCacheGet,
    flushQueue, pendingCount, onOutAtCorrected, reconcileWithServer
  };
})();
