// طبقة اتصال بسيطة بالـ Apps Script backend. عمداً بدون طابور أوفلاين —
// وقت الخروج/العودة لازم يكون وقت السيرفر الحقيقي وقت الضغط، مش وقت مؤجل بعد رجوع النت.
const Api = (() => {
  async function get(action, params) {
    if (!API_URL) throw new Error("لسا ما انربط الموقع بقاعدة البيانات (API_URL فاضي)");
    const qs = new URLSearchParams({ action, ...(params || {}) }).toString();
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(API_URL + "?" + qs, { signal: controller.signal });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "server error");
      return json.data;
    } finally {
      clearTimeout(t);
    }
  }

  async function post(action, payload) {
    if (!API_URL) throw new Error("لسا ما انربط الموقع بقاعدة البيانات (API_URL فاضي)");
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // يتفادى CORS preflight مع Apps Script
      body: JSON.stringify({ action, payload })
    });
    const json = await res.json();
    if (!json.ok) {
      // وصلنا للسيرفر وهو رفض الطلب. هاد فشل دائم — إعادة المحاولة ما رح تنفع.
      // منميّزه عن انقطاع النت (اللي بيرمي قبل ما نوصل لهون) لأن طابور المزامنة
      // بيرمي الطلبات المرفوضة دائمًا، بينما لازم يضل يحاول للأبد لما يكون في انقطاع.
      const err = new Error(json.error || "server error");
      err.serverRejected = true;
      throw err;
    }
    return json.data;
  }

  return { get, post };
})();
