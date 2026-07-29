// دعم العمل بدون إنترنت — احتياطي بس. الأساس دايماً محاولة الاتصال المباشر بالسيرفر
// (ساعة السيرفر هي المرجع الموثوق لمنع التلاعب). لو ما في نت وقت الضغط، نسجل وقت
// ساعة الجهاز نفسه محلياً ونعلّم السجل "offline" بوضوح، وبنحاول نرفعه أول ما يرجع النت.
const Local = (() => {
  const BREAKS_KEY = "att_local_breaks"; // { [id]: {employeeId, employeeName, reason, outAt, inAt, needsSync:{start,end}} }
  const QUEUE_KEY = "att_queue"; // [{ id, type: 'start'|'end' }]
  const CACHE_KEY = "att_cache"; // { employees, settings }

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

  function newId() {
    return (crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
  }

  // ==================== بدء بريك ====================
  // يرجع {id, outAt, offline} فورًا (تفاؤلي)، ويحاول المزامنة الفعلية بالخلفية.
  async function startBreak(employeeId, employeeName, reason) {
    const id = newId();
    const localOutAt = new Date(Date.now() + 45000).toISOString(); // +45 ثانية، للاستخدام لو صار أوفلاين

    const breaks = getBreaks();
    breaks[id] = { employeeId, employeeName, reason, outAt: localOutAt, inAt: null, needsSync: { start: true, end: false } };
    setBreaks(breaks);

    try {
      const res = await Api.post("startBreak", { id, employeeId, employeeName, reason });
      breaks[id].outAt = res.outAt;
      breaks[id].needsSync.start = false;
      setBreaks(breaks);
      return { id, outAt: res.outAt, offline: false };
    } catch (e) {
      enqueue(id, "start");
      return { id, outAt: localOutAt, offline: true };
    }
  }

  // ==================== إنهاء بريك ====================
  async function endBreak(id) {
    const breaks = getBreaks();
    const rec = breaks[id];
    const localInAt = new Date().toISOString();

    if (rec) { rec.inAt = localInAt; setBreaks(breaks); }

    try {
      const res = await Api.post("endBreak", { id });
      if (rec) { rec.needsSync.end = false; maybeCleanup(id); }
      return { id, inAt: res.inAt, durationMin: res.durationMin, overLimit: res.overLimit, offline: false };
    } catch (e) {
      if (rec) { rec.needsSync.end = true; setBreaks(breaks); }
      enqueue(id, "end");
      const outMs = rec ? new Date(rec.outAt).getTime() : Date.now();
      const durationMin = Math.round((new Date(localInAt).getTime() - outMs) / 60000);
      return { id, inAt: localInAt, durationMin, overLimit: false, offline: true };
    }
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

  // ==================== المزامنة ====================
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
          item.attempts += 1;
          setQueue(q);
          break; // غالباً لسا ما في نت — نوقف ونجرب لاحقاً
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

  return { startBreak, endBreak, getOpenBreak, cacheSet, cacheGet, flushQueue, pendingCount };
})();
