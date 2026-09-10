'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.CourseParser = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  const DAYS = ['M', 'T', 'W', 'Th', 'F', 'St', 'Su'];
  const MAX_HOUR = 13;

  // Longer tokens first, or 'Th4' mis-parses as 'T' followed by junk.
  const SLOT_RE = /(Th|St|Su|M|T|W|F)(\d{1,2})/g;
  const CODE_RE = /^(.+?)(?:-(L|PS))?\.(\d+(?:\.\d+)?)$/u;
  const CREDIT_RE = /\((\d+)\)\s*$/;

  function parseCode(raw) {
    if (!raw) return null;
    const match = CODE_RE.exec(String(raw).trim());
    if (!match) return null;
    const kind = match[2] === 'L' ? 'LAB' : match[2] === 'PS' ? 'PS' : 'LEC';
    return { base: match[1].trim(), kind, sectionNo: match[3] };
  }

  function parseSlots(raw) {
    const text = String(raw == null ? '' : raw).trim();
    if (!text) return { slots: [], truncated: false };

    const slots = [];
    let consumed = 0;
    let match;
    SLOT_RE.lastIndex = 0;
    while ((match = SLOT_RE.exec(text)) !== null) {
      const hour = parseInt(match[2], 10);
      if (hour < 1 || hour > MAX_HOUR) continue;
      slots.push({ day: DAYS.indexOf(match[1]), hour });
      consumed += match[0].length;
    }

    // Anything left over once punctuation is discounted means the source string
    // was cut mid-token; scheduling it would use meeting times we cannot know.
    const meaningful = text.replace(/[^A-Za-z0-9]/g, '').length;
    return { slots, truncated: slots.length === 0 || consumed !== meaningful };
  }

  function parseCredit(title) {
    const match = CREDIT_RE.exec(String(title == null ? '' : title).trim());
    return match ? parseInt(match[1], 10) : 0;
  }

  return { DAYS, MAX_HOUR, parseCode, parseSlots, parseCredit };
});
