'use strict';
(function (root, factory) {
  const isNode = typeof require !== 'undefined' && typeof module !== 'undefined';
  const parser = isNode ? require('./course-parser.js') : root.CourseParser;
  const scoring = isNode ? require('./scoring.js') : root.Scoring;
  const api = factory(parser, scoring);
  if (isNode) module.exports = api;
  else { root.Solver = api; }
})(typeof self !== 'undefined' ? self : this, function (CourseParser, Scoring) {
  const DAYS = CourseParser.DAYS;
  const MAX_HOUR = CourseParser.MAX_HOUR;

  const MAX_OVERLAP_PAIRS = 2;      // Madde 18/2: at most two courses...
  const MAX_HOURS_PER_PAIR = 1;     // ...overlapping by one hour each

  // A group is a mandatory pick-one. Sections we cannot place are dropped here,
  // so a truncated row never contributes unknown meeting times to a timetable.
  function buildGroups(courses) {
    const groups = [];
    for (const course of courses) {
      for (const kind of ['LEC', 'LAB', 'PS']) {
        const options = course.groups[kind].filter(
          (s) => !s.truncated && !s.unscheduled && s.slots.length > 0);
        if (options.length > 0) groups.push({ base: course.base, kind, options });
      }
    }
    // Fewest options first: conflicts surface early and prune more.
    return groups.sort((a, b) => a.options.length - b.options.length);
  }

  function signatureOf(sections) {
    const parts = [];
    for (const section of sections) {
      for (const slot of section.slots) parts.push(section.base + '@' + slot.day + ':' + slot.hour);
    }
    return parts.sort().join('|');
  }

  function solve(courses, prefs, options) {
    const opts = Object.assign({ limit: 10, allowOverlap: false, nodeCap: 2000000 }, options || {});
    const groups = buildGroups(courses);

    const occupancy = new Uint16Array(DAYS.length);
    const owner = new Int16Array(DAYS.length * (MAX_HOUR + 1)).fill(-1);
    const chosen = [];
    const pairHours = new Map();

    const bySignature = new Map();
    const results = [];
    let explored = 0;
    let considered = 0;
    let truncated = false;

    function overlapTotal() {
      let total = 0;
      for (const hours of pairHours.values()) total += hours;
      return total;
    }

    // Returns the list of (day, hour, previousOwner) triples this section collides
    // with, or null when the collision is not permissible.
    function collisionsFor(section, index) {
      const hits = [];
      for (const slot of section.slots) {
        if ((occupancy[slot.day] & (1 << (slot.hour - 1))) === 0) continue;
        if (!opts.allowOverlap) return null;
        hits.push(slot);
      }
      if (hits.length === 0) return hits;

      const trial = new Map(pairHours);
      for (const slot of hits) {
        const previous = owner[slot.day * (MAX_HOUR + 1) + slot.hour];
        if (previous < 0) return null;
        const key = previous < index ? previous + '-' + index : index + '-' + previous;
        const next = (trial.get(key) || 0) + 1;
        if (next > MAX_HOURS_PER_PAIR) return null;
        trial.set(key, next);
      }
      if (trial.size > MAX_OVERLAP_PAIRS) return null;
      return hits;
    }

    function place(section, index, hits) {
      for (const slot of section.slots) {
        occupancy[slot.day] |= (1 << (slot.hour - 1));
        const cell = slot.day * (MAX_HOUR + 1) + slot.hour;
        if (owner[cell] < 0) owner[cell] = index;
      }
      for (const slot of hits) {
        const previous = owner[slot.day * (MAX_HOUR + 1) + slot.hour];
        const key = previous < index ? previous + '-' + index : index + '-' + previous;
        pairHours.set(key, (pairHours.get(key) || 0) + 1);
      }
    }

    function restore(savedMask, savedOwner, savedPairs) {
      occupancy.set(savedMask);
      owner.set(savedOwner);
      pairHours.clear();
      for (const [key, value] of savedPairs) pairHours.set(key, value);
    }

    function record() {
      considered++;
      const evaluation = Scoring.scoreSchedule(chosen, prefs);
      if (evaluation.rejected) return;

      const signature = signatureOf(chosen);
      const existing = bySignature.get(signature);
      if (existing) {
        // Same timetable, different section numbers: keep it as an alternative.
        const codes = existing.sections.map((s) => s.code).join(',');
        const candidate = chosen.map((s) => s.code).join(',');
        if (codes !== candidate && existing.alternates.length < 20) {
          existing.alternates.push(chosen.map((s) => s.code));
        }
        return;
      }

      const entry = {
        sections: chosen.slice(),
        rawScore: evaluation.score,
        score: evaluation.score,
        breakdown: evaluation.breakdown,
        overlapHours: overlapTotal(),
        alternates: [],
      };
      bySignature.set(signature, entry);
      results.push(entry);
    }

    function search(depth) {
      if (truncated) return;
      if (depth === groups.length) { record(); return; }

      for (const section of groups[depth].options) {
        if (++explored > opts.nodeCap) { truncated = true; return; }

        const hits = collisionsFor(section, depth);
        if (hits === null) continue;

        const savedMask = occupancy.slice();
        const savedOwner = owner.slice();
        const savedPairs = [...pairHours.entries()];

        place(section, depth, hits);
        chosen.push(section);
        search(depth + 1);
        chosen.pop();
        restore(savedMask, savedOwner, savedPairs);

        if (truncated) return;
      }
    }

    if (groups.length > 0) search(0);

    // Clean schedules outrank equally-scoring ones that lean on Madde 18.
    results.sort((a, b) => (b.rawScore - a.rawScore) || (a.overlapHours - b.overlapHours));
    const top = results.slice(0, opts.limit);

    const best = top.length ? top[0].rawScore : 0;
    const worst = top.length ? top[top.length - 1].rawScore : 0;
    for (const entry of top) {
      entry.score = best === worst ? 100 : Math.round(((entry.rawScore - worst) / (best - worst)) * 100);
    }

    return { results: top, truncated, explored, considered };
  }

  return { solve, MAX_OVERLAP_PAIRS, MAX_HOURS_PER_PAIR };
});
