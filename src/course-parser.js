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

  const QUOTA_RE = /^\d+\s*\/\s*\d+$/;
  const INT_RE = /^\d+$/;

  function columnLetters(rows) {
    const seen = new Set();
    for (const row of rows) for (const key of Object.keys(row)) seen.add(key);
    return [...seen];
  }

  // Fraction of non-empty values in this column that satisfy `predicate`.
  function matchRate(rows, letter, predicate) {
    let total = 0;
    let hits = 0;
    for (const row of rows) {
      const value = row[letter];
      if (value == null || value === '') continue;
      total++;
      if (predicate(value)) hits++;
    }
    return total === 0 ? 0 : hits / total;
  }

  function bestColumn(rows, letters, predicate, threshold) {
    let best = null;
    let bestRate = threshold;
    for (const letter of letters) {
      const rate = matchRate(rows, letter, predicate);
      if (rate > bestRate) { bestRate = rate; best = letter; }
    }
    return best;
  }

  function detectColumns(rows) {
    // Skip the header row: its text would otherwise pollute every match rate.
    const body = rows.slice(1);
    const letters = columnLetters(body);

    const code = bestColumn(body, letters, (v) => parseCode(v) !== null, 0.5);
    if (!code) {
      throw new Error(
        'Could not find the course-code column. Expected values like "COMP1111.1" or "COMP1111-L.1".');
    }

    const slots = bestColumn(body, letters.filter((l) => l !== code),
      (v) => !parseSlots(v).truncated && parseSlots(v).slots.length > 0, 0.3);
    if (!slots) {
      throw new Error(
        'Could not find the class-hours column. Expected values like "T2T3T4" or "Th2Th3".');
    }

    const used = [code, slots];
    const rest = letters.filter((l) => !used.includes(l));

    const title = bestColumn(body, rest, (v) => CREDIT_RE.test(v), 0.1)
      || bestColumn(body, rest, (v) => /[A-Za-zÀ-ÿĞğİıÖöŞşÜüÇç]{4,}/.test(v), 0.5);
    if (!title) {
      throw new Error('Could not find the course-title column.');
    }
    used.push(title);

    const quota = bestColumn(body, letters.filter((l) => !used.includes(l)),
      (v) => QUOTA_RE.test(v), 0.5);
    if (quota) used.push(quota);

    // Contact hours vs AKTS: both are integer columns, so "is an integer" cannot
    // tell them apart. Contact hours is the one that tracks the slot count.
    //
    // Do NOT use a fixed agreement threshold. In the reference file column I
    // agrees with the slot count on only 89% of rows — 101 rows legitimately
    // disagree because the hours figure includes untimetabled practicum time
    // (AHİZ1111.1 reports 4 hours for 3 scheduled slots). Any threshold above
    // 0.89 misidentifies the real hours column; any threshold low enough to
    // admit it is an arbitrary number that a different file would break.
    // Ranking sidesteps the guess: the best-tracking integer column is hours,
    // and a second integer column alongside it is AKTS.
    const slotAgreementRate = (letter) => {
      const comparable = body.filter((r) => r[letter] && r[slots]);
      if (comparable.length === 0) return 0;
      const agreeing = comparable.filter((r) => {
        const parsed = parseSlots(r[slots]);
        return parsed.truncated || Number(r[letter]) === parsed.slots.length;
      });
      return agreeing.length / comparable.length;
    };

    const integerColumns = letters
      .filter((l) => !used.includes(l))
      .filter((l) => matchRate(body, l, (v) => INT_RE.test(v)) > 0.8)
      .map((l) => ({ letter: l, rate: slotAgreementRate(l) }))
      .sort((a, b) => b.rate - a.rate);

    // The 0.5 floor below is not a hours-vs-AKTS discriminator (ranking already
    // does that job) — it is only an existence check, rejecting a top-ranked
    // integer column that tracks the slot count essentially not at all (e.g. a
    // stray numeric column that happens to be the best of a bad lot). It is set
    // deliberately far below the real file's observed 0.89 agreement rate so it
    // never influences which column wins; it only ever says "none of these
    // integer columns is plausibly hours."
    const hours = integerColumns.length > 0 && integerColumns[0].rate > 0.5
      ? integerColumns[0].letter
      : null;
    if (hours) used.push(hours);

    // AKTS is only meaningful as a SECOND integer column beside a real hours
    // column. Without that anchor, a lone unrelated integer column would be
    // mislabelled AKTS and silently drive the load gauge.
    const akts = hours && integerColumns.length > 1 ? integerColumns[1].letter : null;
    if (akts) used.push(akts);

    // Campus is a text column with only a handful of distinct values, so it is
    // judged on the column as a whole rather than per-value.
    let campus = null;
    for (const letter of letters.filter((l) => !used.includes(l))) {
      const values = body.map((r) => r[letter]).filter(Boolean);
      const distinct = new Set(values);
      if (values.length > body.length * 0.5 && distinct.size >= 2 && distinct.size <= 12) {
        campus = letter;
        break;
      }
    }
    if (campus) used.push(campus);

    // The real file splits the instructor's name across two columns (given
    // name, then surname), so a single "best" column would truncate it to
    // just one part. Instead, collect every remaining column that looks
    // name-shaped: `letters` already lists columns in ascending sheet order
    // (see columnLetters/the row-object key order above), so filtering it
    // in place yields given-name-before-surname for free, with no separate
    // sort needed. Cap at 2 since a name has at most two parts worth reading.
    const instructorParts = letters
      .filter((l) => !used.includes(l))
      .filter((l) => matchRate(body, l, (v) => /^[A-ZÀ-ÿĞİÖŞÜÇ][A-Za-zÀ-ÿĞğİıÖöŞşÜüÇç .'-]*$/.test(v)) > 0.6)
      .slice(0, 2);
    instructorParts.forEach((l) => used.push(l));

    return {
      code, title, slots, quota: quota || null, hours,
      campus: campus || null, instructorParts, akts,
    };
  }

  function slotsToMask(slots) {
    const mask = new Uint16Array(DAYS.length);
    for (const slot of slots) mask[slot.day] |= (1 << (slot.hour - 1));
    return mask;
  }

  function parseQuota(raw) {
    const match = QUOTA_RE.exec(String(raw == null ? '' : raw).trim());
    if (!match) return null;
    const parts = String(raw).split('/');
    return { left: parseInt(parts[0], 10), total: parseInt(parts[1], 10) };
  }

  function buildCourses(rows, cols) {
    const byBase = new Map();
    const warnings = [];

    for (const row of rows.slice(1)) {
      const rawCode = row[cols.code];
      const parsed = parseCode(rawCode);
      if (!parsed) continue;

      const title = (row[cols.title] || '').trim();
      const slotInfo = parseSlots(row[cols.slots]);
      const rawSlots = (row[cols.slots] || '').trim();

      if (slotInfo.truncated && rawSlots !== '') {
        warnings.push({
          code: String(rawCode).trim(),
          reason: 'Class hours could not be read in full ("' + rawSlots + '") — excluded from planning.',
        });
      }

      const section = {
        code: String(rawCode).trim(),
        base: parsed.base,
        kind: parsed.kind,
        sectionNo: parsed.sectionNo,
        title,
        credit: parseCredit(title),
        slots: slotInfo.slots,
        mask: slotsToMask(slotInfo.slots),
        hours: cols.hours ? Number(row[cols.hours] || 0) : slotInfo.slots.length,
        akts: cols.akts ? Number(row[cols.akts] || 0) : null,
        campus: cols.campus ? (row[cols.campus] || '') : '',
        instructor: (cols.instructorParts || [])
          .map((letter) => (row[letter] || '').trim()).filter(Boolean).join(' '),
        quota: cols.quota ? parseQuota(row[cols.quota]) : null,
        truncated: slotInfo.truncated && rawSlots !== '',
        unscheduled: rawSlots === '',
      };

      if (!byBase.has(parsed.base)) {
        byBase.set(parsed.base, {
          base: parsed.base, title: '', credit: 0, akts: null,
          groups: { LEC: [], LAB: [], PS: [] },
        });
      }
      const course = byBase.get(parsed.base);
      course.groups[parsed.kind].push(section);

      // Title and credit come from the parent lecture row only, so a lab never
      // contributes a second credit for the same course.
      if (parsed.kind === 'LEC') {
        if (section.credit > 0 || !course.title) course.title = title.replace(CREDIT_RE, '').trim();
        if (section.credit > 0) course.credit = section.credit;
        if (section.akts) course.akts = section.akts;
      }
    }

    const courses = [...byBase.values()].sort((a, b) => a.base.localeCompare(b.base, 'tr'));
    return { courses, warnings };
  }

  return { DAYS, MAX_HOUR, parseCode, parseSlots, parseCredit, detectColumns, slotsToMask, buildCourses };
});
