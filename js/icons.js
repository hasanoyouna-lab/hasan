// أيقونات خطية بستايل هوية Pro House (خطوط سوداء حادة، viewBox 24×24، currentColor).
// الربط بالكلمات المفتاحية مش بالنص الحرفي، عشان تضل شغالة لو غيّرت أسماء الأسباب
// من لوحة الإدارة (مثلاً "حمام" → "دورة مياه").
const Icons = (() => {
  const S = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

  const SHAPES = {
    // دُش + قطرات
    restroom: `<path ${S} d="M4 10h10a0 0 0 0 1 0 0 5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/>
               <path ${S} d="M14 10V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>
               <path ${S} d="M7 19v1M9 21v1M11 19v1"/>`,
    // مسجد: قبة + مئذنتين
    prayer: `<path ${S} d="M6 20V13a6 6 0 0 1 12 0v7"/>
             <path ${S} d="M12 7V5"/><circle cx="12" cy="3.5" r="1.2" ${S}/>
             <path ${S} d="M4 20v-8M20 20v-8"/>
             <path ${S} d="M3 20h18"/>`,
    // شوكة + سكين
    food: `<path ${S} d="M7 3v6a2 2 0 0 0 4 0V3"/>
           <path ${S} d="M9 9v12"/>
           <path ${S} d="M17 21v-7c1.6 0 2.5-1.2 2.5-3.5S18.6 3 17 3z"/>`,
    // باب + سهم خروج
    outside: `<path ${S} d="M13 3H5a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h8"/>
              <path ${S} d="M10 12h10"/>
              <path ${S} d="M17 9l3 3-3 3"/>`,
    // فنجان قهوة
    coffee: `<path ${S} d="M4 8h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/>
             <path ${S} d="M17 9h1.5a2.5 2.5 0 0 1 0 5H17"/>
             <path ${S} d="M3 21h15"/>
             <path ${S} d="M8 2v2M12 2v2"/>`,
    // ساعة (احتياطي)
    clock: `<circle cx="12" cy="12" r="9" ${S}/><path ${S} d="M12 7v5l3 2"/>`
  };

  // أول تطابق بيفوز، فرتّب الكلمات الأكثر تحديدًا أول
  const RULES = [
    { key: 'restroom', words: ['حمام', 'دورة', 'مياه', 'تواليت', 'توالet', 'wc'] },
    { key: 'prayer',   words: ['صلا', 'صلاة', 'مسجد', 'جامع', 'ركع'] },
    { key: 'food',     words: ['اكل', 'أكل', 'طعام', 'وجب', 'غدا', 'غداء', 'فطور', 'عشا', 'عشاء'] },
    { key: 'outside',  words: ['خارج', 'برا', 'خروج', 'ذهاب', 'مشوار'] },
    { key: 'coffee',   words: ['استراح', 'راحة', 'بريك', 'قهوة', 'شاي', 'تدخين'] }
  ];

  // نشيل التشكيل ونوحّد الألف/الهمزات حتى المطابقة تشتغل مع كل طرق الكتابة
  function normalize(text) {
    return String(text || '')
      .replace(/[ً-ْـ]/g, '')
      .replace(/[أإآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .toLowerCase()
      .trim();
  }

  // الطرفان (السبب والكلمة المفتاحية) بيمرّوا بنفس التطبيع، فمقارنة وحدة بتكفي
  function keyFor(reason) {
    const text = normalize(reason);
    for (const rule of RULES) {
      for (const w of rule.words) {
        if (text.indexOf(normalize(w)) !== -1) return rule.key;
      }
    }
    return 'clock';
  }

  function svg(reason, size) {
    const shape = SHAPES[keyFor(reason)] || SHAPES.clock;
    const s = size || 34;
    return `<svg class="icon" viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true">${shape}</svg>`;
  }

  return { svg, keyFor };
})();
