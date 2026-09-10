'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  const state = {
    courses: [], warnings: [], selected: new Set(), prefs: null, akts: false,
    // Controls that are not scoring preferences but still worth remembering.
    ui: { overlap: false, gno: '0' },
  };

  const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  // Spreadsheet-derived text (course codes, titles, instructor names, etc.) is
  // attacker-controlled: escape it before it is interpolated into innerHTML.
  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);
  }

  function showError(message) {
    $('error').textContent = message;
    $('error').classList.remove('hidden');
  }

  // Diacritic-insensitive so 'ısı' matches 'İSİ'.
  const fold = (s) => (s || '').toLocaleLowerCase('tr')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ş/g, 's')
    .replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ç/g, 'c');

  // Everything derived from the previously loaded file. Without this a second
  // load would leave the first file's schedules, status line and selection on
  // screen while the chip list showed the new file's courses.
  function resetForNewFile() {
    $('error').classList.add('hidden');
    $('results').innerHTML = '';
    $('status').textContent = '';
    $('search').value = '';
    $('tip').style.display = 'none';
    state.courses = [];
    state.warnings = [];
    state.selected = new Set();
  }

  // Spec §9.1: the drop zone is replaced by a compact summary, not removed —
  // removing it would make loading a second file impossible without a reload.
  function renderFileSummary(file) {
    $('drop').classList.add('loaded');
    $('dropinner').innerHTML =
      '<strong>' + escapeHtml(file.name) + '</strong>' +
      '<span class="sub">' + state.courses.length + ' ders · ' +
      state.warnings.length + ' uyarı</span>' +
      '<button id="rechoose" type="button">Başka dosya seç</button>';
  }

  function applyPrefsToControls() {
    $('fdw').value = state.prefs.freeDayWeight;
    $('fdwOut').textContent = state.prefs.freeDayWeight;
    $('cmp').value = state.prefs.compactness;
    $('cmpOut').textContent = state.prefs.compactness;
    // Without this line a restored maxGap is lost the moment the user solves:
    // readPrefs() would read the still-empty #maxgap and write back null.
    $('maxgap').value = state.prefs.maxGap == null ? '' : state.prefs.maxGap;
    $('single').checked = state.prefs.avoidSingleCourseDays;
    $('overlap').checked = state.ui.overlap;
    const gno = $('gno');
    if ([...gno.options].some((option) => option.value === state.ui.gno)) gno.value = state.ui.gno;
  }

  async function loadFile(file) {
    resetForNewFile();
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { rows } = await XlsxReader.readWorkbook(bytes);
      const cols = CourseParser.detectColumns(rows);
      const built = CourseParser.buildCourses(rows, cols);
      state.courses = built.courses;
      state.warnings = built.warnings;
      state.akts = Boolean(cols.akts);
      state.prefs = Scoring.defaultPrefs();
      restore();
      renderFileSummary(file);
      $('app').classList.remove('hidden');
      renderWarnings();
      renderChips();
      renderTray();
      applyPrefsToControls();
      renderSummary();
      renderFreeDays();
    } catch (err) {
      showError(err.message || String(err));
    }
  }

  function renderWarnings() {
    const box = $('warnings');
    if (state.warnings.length === 0) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    const list = state.warnings.slice(0, 12)
      .map((w) => '<li><code>' + escapeHtml(w.code) + '</code> — ' +
        escapeHtml(w.reason) + '</li>').join('');
    const more = state.warnings.length > 12
      ? '<li>…ve ' + (state.warnings.length - 12) + ' tane daha</li>' : '';
    box.innerHTML = '<strong>' + state.warnings.length +
      ' bölüm tam okunamadı ve planlamaya dahil edilmedi:</strong><ul>' + list + more + '</ul>' +
      // Kesilmiş ama geçerli görünen bir saat (ör. "T2T3" iken "T2") tespit
      // edilemez, bu yüzden uyarı listesi tam güvence vermez.
      '<p class="sub">Yine de programındaki ders saatlerini resmi ders programıyla ' +
      'karşılaştırıp doğrula: kesilmiş ama geçerli görünen bir saat uyarı üretmez.</p>';
  }

  function chipLabel(course) {
    const credit = course.credit > 0 ? course.credit : '—';
    return escapeHtml(course.base) + '<span class="cr"> · ' + escapeHtml(credit) + '</span>';
  }

  function renderChips() {
    $('tip').style.display = 'none';
    const query = fold($('search').value.trim());
    const matches = state.courses.filter((course) => {
      if (!query) return true;
      const hay = fold(course.base + ' ' + course.title + ' ' +
        course.groups.LEC.map((s) => s.instructor).join(' '));
      return hay.includes(query);
    });

    const box = $('chips');
    box.innerHTML = '';
    for (const course of matches.slice(0, 400)) {
      const label = document.createElement('label');
      label.className = 'chip';
      label.dataset.base = course.base;
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = state.selected.has(course.base);
      input.addEventListener('change', () => {
        if (input.checked) state.selected.add(course.base);
        else state.selected.delete(course.base);
        persist();
        renderTray();
        renderSummary();
      });
      const span = document.createElement('span');
      span.innerHTML = chipLabel(course);
      label.appendChild(input);
      label.appendChild(span);
      box.appendChild(label);
    }
    if (matches.length === 0) {
      box.innerHTML = '<p class="sub">Eşleşen ders yok.</p>';
    } else if (matches.length > 400) {
      const note = document.createElement('p');
      note.className = 'sub';
      note.textContent = matches.length + ' dersten ilk 400 tanesi gösteriliyor — aramayı daraltın.';
      box.appendChild(note);
    }
  }

  function deselect(base) {
    state.selected.delete(base);
    persist();
    // The chip for this course may be filtered out of view, so re-render the
    // whole list rather than trying to untick one specific checkbox.
    renderChips();
    renderTray();
    renderSummary();
  }

  // Spec §9.5. The chip list is capped at 400 entries and filtered by the search
  // box, so without this tray a selected course can scroll out of existence and
  // become impossible to remove.
  function renderTray() {
    const box = $('tray');
    box.innerHTML = '';
    const chosen = state.courses.filter((c) => state.selected.has(c.base));
    if (chosen.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'sub';
      empty.textContent = 'Henüz ders seçmedin.';
      box.appendChild(empty);
      return;
    }

    const head = document.createElement('span');
    head.className = 'sub';
    head.textContent = 'Seçilen dersler (' + chosen.length + '):';
    box.appendChild(head);

    for (const course of chosen) {
      const pick = document.createElement('span');
      pick.className = 'pick';
      const name = document.createElement('span');
      // textContent, not innerHTML: course codes come from the spreadsheet.
      name.textContent = course.base + (course.credit > 0 ? ' · ' + course.credit : '');
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.title = course.base + ' dersini çıkar';
      remove.setAttribute('aria-label', course.base + ' dersini seçimden çıkar');
      remove.addEventListener('click', () => deselect(course.base));
      pick.appendChild(name);
      pick.appendChild(remove);
      box.appendChild(pick);
    }
  }

  function tooltipFor(course) {
    const sections = course.groups.LEC.concat(course.groups.LAB, course.groups.PS);
    const first = sections[0] || {};
    const times = sections.map((s) => escapeHtml(s.code) + ': ' +
      s.slots.map((sl) => CourseParser.DAYS[sl.day] + sl.hour).join(' ')).slice(0, 6).join('\n');
    const quota = first.quota ? first.quota.left + ' / ' + first.quota.total + ' kontenjan' : '';
    return '<b>' + escapeHtml(course.title || course.base) + '</b>' +
      (first.instructor ? escapeHtml(first.instructor) + ' · ' : '') +
      escapeHtml(first.campus || '') +
      (quota ? ' · ' + quota : '') +
      '<br>' + sections.length + ' bölüm<br><pre style="margin:4px 0 0;font:inherit">' +
      times + '</pre>';
  }

  function wireTooltip() {
    const tip = $('tip');
    const chips = $('chips');

    function showTip(chip) {
      const course = state.courses.find((c) => c.base === chip.dataset.base);
      if (!course) return;
      tip.innerHTML = tooltipFor(course);
      tip.style.display = 'block';
      const box = chip.getBoundingClientRect();
      const tipBox = tip.getBoundingClientRect();
      tip.style.left = Math.max(0, Math.min(box.left, window.innerWidth - 340)) + 'px';
      const fitsBelow = box.bottom + 8 + tipBox.height <= window.innerHeight;
      tip.style.top = fitsBelow
        ? (box.bottom + 8) + 'px'
        : Math.max(0, box.top - 8 - tipBox.height) + 'px';
    }

    // Chips are checkboxes, so they are reached by Tab as well as by pointer:
    // a hover-only tooltip hides every detail from keyboard users.
    for (const name of ['mouseover', 'focusin']) {
      chips.addEventListener(name, (event) => {
        const chip = event.target.closest('.chip');
        if (chip) showTip(chip);
      });
    }
    for (const name of ['mouseout', 'focusout']) {
      chips.addEventListener(name, (event) => {
        if (event.target.closest('.chip')) tip.style.display = 'none';
      });
    }
  }

  function renderSummary() {
    const chosen = state.courses.filter((c) => state.selected.has(c.base));
    const credits = chosen.reduce((sum, c) => sum + c.credit, 0);
    $('credits').textContent = credits;
    $('count').textContent = chosen.length;

    const ceiling = Number($('gno').value);
    const gauge = $('gauge');
    if (!ceiling) { gauge.textContent = ''; return; }
    if (state.akts) {
      const total = chosen.reduce((sum, c) => sum + (c.akts || 0), 0);
      gauge.textContent = total + ' / ' + ceiling + ' AKTS';
    } else {
      // The file carries local kredi, not AKTS, so this comparison is indicative only.
      gauge.textContent = 'sınır ' + ceiling + ' AKTS — bu dosyada AKTS yok, ' +
        'kredi ile karşılaştırma yaklaşıktır';
    }
  }

  function persist() {
    try {
      localStorage.setItem('dpi.selected', JSON.stringify([...state.selected]));
      localStorage.setItem('dpi.prefs', JSON.stringify(state.prefs));
      localStorage.setItem('dpi.ui', JSON.stringify(state.ui));
    } catch (err) { /* private window or blocked storage: run without memory */ }
  }

  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem('dpi.selected') || '[]');
      state.selected = new Set(saved.filter(
        (base) => state.courses.some((c) => c.base === base)));
      const prefs = JSON.parse(localStorage.getItem('dpi.prefs') || 'null');
      if (prefs) state.prefs = Object.assign(Scoring.defaultPrefs(), prefs);
      const ui = JSON.parse(localStorage.getItem('dpi.ui') || 'null');
      if (ui) {
        state.ui = {
          overlap: Boolean(ui.overlap),
          gno: String(ui.gno == null ? '0' : ui.gno),
        };
      }
    } catch (err) { state.selected = new Set(); }
  }

  function wire() {
    const drop = $('drop');
    drop.addEventListener('click', () => $('file').click());
    $('file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      // Clear it so picking the SAME file twice still fires a change event.
      e.target.value = '';
      if (file) loadFile(file);
    });
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
      else showError('Bir dosya bırakmalısınız (ör. .xlsx) — sürüklenen içerik dosya değil.');
    });
    $('search').addEventListener('input', renderChips);
    $('gno').addEventListener('change', () => {
      state.ui.gno = $('gno').value;
      renderSummary();
      persist();
    });
    $('overlap').addEventListener('change', () => {
      state.ui.overlap = $('overlap').checked;
      persist();
    });
    wireTooltip();
    $('fdw').addEventListener('input', () => { $('fdwOut').textContent = $('fdw').value; });
    $('cmp').addEventListener('input', () => { $('cmpOut').textContent = $('cmp').value; });
    $('go').addEventListener('click', run);
  }

  function renderFreeDays() {
    const box = $('freedays');
    box.innerHTML = '';
    for (const day of CourseParser.DAYS.slice(0, 6)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = day;
      button.className = state.prefs.freeDays.includes(day) ? 'on' : '';
      button.addEventListener('click', () => {
        const at = state.prefs.freeDays.indexOf(day);
        if (at >= 0) state.prefs.freeDays.splice(at, 1);
        else state.prefs.freeDays.push(day);
        button.classList.toggle('on');
        persist();
      });
      box.appendChild(button);
    }
  }

  function readPrefs() {
    state.prefs.freeDayWeight = Number($('fdw').value);
    state.prefs.compactness = Number($('cmp').value);
    const gap = $('maxgap').value;
    state.prefs.maxGap = gap === '' ? null : Number(gap);
    state.prefs.avoidSingleCourseDays = $('single').checked;
    persist();
    return state.prefs;
  }

  const PALETTE = ['#dbeafe', '#dcfce7', '#fef3c7', '#fae8ff', '#ffe4e6',
                   '#e0e7ff', '#ccfbf1', '#ffedd5'];
  function colourFor(base) {
    let hash = 0;
    for (let i = 0; i < base.length; i++) hash = (hash * 31 + base.charCodeAt(i)) >>> 0;
    return PALETTE[hash % PALETTE.length];
  }

  function calendarFor(entry) {
    const used = new Set();
    for (const section of entry.sections) {
      for (const slot of section.slots) used.add(slot.day);
    }
    const days = CourseParser.DAYS
      .map((code, index) => ({ code, index }))
      .filter((d) => d.index < 5 || used.has(d.index));

    // day:hour -> list of sections occupying that slot. More than one section
    // means a Madde 18/2 clash — both must stay visible, not last-write-wins.
    const grid = new Map();
    for (const section of entry.sections) {
      for (const slot of section.slots) {
        const key = slot.day + ':' + slot.hour;
        const list = grid.get(key);
        if (list) list.push(section); else grid.set(key, [section]);
      }
    }
    // Two consecutive hours in the same column merge into one rowspan cell
    // only when they hold the exact same section(s) — not merely "some section".
    const signature = (list) => (list ? list.map((s) => s.code).sort().join('+') : '');

    const skip = {};
    for (const day of days) skip[day.index] = 0;

    let html = '<div class="scroll"><table class="cal"><thead><tr><th></th>';
    for (const day of days) html += '<th>' + day.code + '</th>';
    html += '</tr></thead><tbody>';

    for (let hour = 1; hour <= CourseParser.MAX_HOUR; hour++) {
      html += '<tr><th>' + hour + '</th>';
      for (const day of days) {
        if (skip[day.index] > 0) { skip[day.index]--; continue; }

        const list = grid.get(day.index + ':' + hour);
        if (!list) { html += '<td></td>'; continue; }

        const sig = signature(list);
        let span = 1;
        while (hour + span <= CourseParser.MAX_HOUR &&
               signature(grid.get(day.index + ':' + (hour + span))) === sig) span++;
        skip[day.index] = span - 1;

        const codes = list.map((s) => escapeHtml(s.code)).join(' / ');
        html += list.length > 1
          ? '<td class="busy clash" rowspan="' + span + '" title="' +
            escapeHtml('Çakışma: ' + list.map((s) => s.code).join(' / ')) + '">' + codes + '</td>'
          : '<td class="busy" rowspan="' + span + '" style="background:' +
            colourFor(list[0].base) + '">' + codes + '</td>';
      }
      html += '</tr>';
    }
    return html + '</tbody></table></div>';
  }

  // A course code shown in its calendar colour, so the culprit named here is
  // the same colour the user has been looking at in the timetables.
  function codeTag(base) {
    return '<span class="tag" style="background:' + colourFor(base) + '">' +
      escapeHtml(base) + '</span>';
  }

  // Turn a failed search into an explanation. Naming the pair that clashes and
  // the hours it clashes on is the difference between "it did not work" and
  // "drop this one course".
  function renderDiagnosis(diagnosis) {
    if (!diagnosis) {
      return '<div class="card err">Çakışmayan hiçbir kombinasyon bulunamadı.</div>';
    }

    let html = '<div class="card err"><strong>Çakışmayan hiçbir kombinasyon bulunamadı.</strong>';

    if (diagnosis.blockingPairs.length > 0) {
      html += '<p>Şu dersler birbiriyle çakıştığı için birlikte alınamaz:</p><ul>';
      for (const pair of diagnosis.blockingPairs) {
        html += '<li>' + codeTag(pair.bases[0]) + ' ile ' + codeTag(pair.bases[1]) +
          ' — ortak saatler: <strong>' + pair.cells.map(escapeHtml).join(', ') + '</strong></li>';
      }
      html += '</ul>';
    } else if (diagnosis.higherOrder) {
      html += '<p>Derslerin hiçbir ikilisi tek başına çakışmıyor, ama hepsi bir arada ' +
        'haftaya sığmıyor. Bu yüzden tek bir suçlu ders yok — birini çıkarman gerekiyor.</p>';
    }

    if (diagnosis.dropCandidates.length > 0) {
      html += '<p>Şu derslerden birini çıkarırsan geri kalanlar için program bulunur: ' +
        diagnosis.dropCandidates.map(codeTag).join(' ') + '</p>';
    } else if (!diagnosis.truncated && diagnosis.blockingPairs.length > 0) {
      html += '<p>Tek bir dersi çıkarmak yetmiyor; en az iki ders değiştirmen gerekiyor.</p>';
    }

    if (diagnosis.truncated) {
      html += '<p>Arama sınıra takıldığı için bu inceleme eksik olabilir. ' +
        'Daha az ders seçersen daha kesin bir sonuç alırsın.</p>';
    }

    html += '<p class="sub">Madde 18/2 seçeneğini açmak da yardımcı olabilir: ' +
      'en fazla iki dersin birer saati çakışabilir (danışman onayı gerekir).</p>';
    return html + '</div>';
  }

  function renderResults(output, chosen) {
    const box = $('results');
    box.innerHTML = '';

    // A selected course with no readable meeting times contributes nothing to
    // the search. Dropping it quietly would hand the user a timetable that is
    // missing a course they asked for, with no way to notice.
    const skipped = output.skipped || [];
    if (skipped.length > 0) {
      box.innerHTML += '<div class="card warn"><strong>Şu dersler programa eklenemedi: ' +
        skipped.map(escapeHtml).join(', ') + '</strong><br>' +
        'Bu derslerin ders saatleri dosyadan okunamadı, bu yüzden yerleştirilemediler. ' +
        'Saatlerini resmi ders programından kendin kontrol etmelisin.</div>';
    }

    // Show the truncation notice regardless of whether any results were found:
    // an empty result from a cut-off search means something different (search
    // was incomplete) than an empty result from an exhaustive one.
    if (output.truncated) {
      box.innerHTML += '<div class="card warn">Arama sınıra takıldı — sonuçlar eksik olabilir. ' +
        'Daha az ders seçersen tam sonuç alırsın.</div>';
    }

    if (output.results.length === 0) {
      // "No conflict-free combination" is the wrong diagnosis when there was
      // nothing to combine in the first place — every course was unreadable.
      const nothingToPlan = chosen.length > 0 && skipped.length === chosen.length;
      box.innerHTML += nothingToPlan
        ? '<div class="card err">Seçtiğin derslerin hiçbirinin ders saati okunamadı, ' +
          'bu yüzden program üretilemedi. Bu bir çakışma sorunu değil: dosyadaki saat ' +
          'bilgileri eksik. Ders saatlerini içeren tam bir dosya yüklemeyi deneyebilirsin.</div>'
        : renderDiagnosis(output.diagnosis);
      return;
    }

    output.results.forEach((entry, index) => {
      const card = document.createElement('div');
      card.className = 'sched';
      const breakdown = entry.breakdown
        // The label is built from persisted prefs (a restored freeDays entry
        // lands in it verbatim), so it is not trusted markup.
        .map((item) => escapeHtml(item.label) + ' ' + (item.points > 0 ? '+' : '') + item.points)
        .join(' · ') || 'nötr';
      const badge = entry.overlapHours > 0
        ? '<span class="badge">' + entry.overlapHours +
          ' saat çakışma — danışman onayı gerekir</span>'
        : '';
      const alternates = entry.alternates.length
        ? '<p class="sub">Aynı saatlerde alternatif şubeler: ' +
          entry.alternates.map((codes) => codes.map(escapeHtml).join(', ')).join(' | ') + '</p>'
        : '';
      card.innerHTML = '<header><h3>#' + (index + 1) + '</h3>' +
        '<span class="sub">puan ' + entry.score + '/100</span>' + badge + '</header>' +
        calendarFor(entry) +
        '<p class="sub">' + breakdown + '</p>' + alternates;
      box.appendChild(card);
    });
  }

  function run() {
    const chosen = state.courses.filter((c) => state.selected.has(c.base));
    if (chosen.length === 0) { $('status').textContent = 'Önce ders seç.'; return; }
    $('status').textContent = 'Hesaplanıyor…';
    // Yield once so the status text paints before the solver blocks the thread.
    setTimeout(() => {
      const started = Date.now();
      const prefs = readPrefs();
      const allowOverlap = $('overlap').checked;
      const output = Solver.solve(chosen, prefs, { limit: 10, allowOverlap: allowOverlap });
      // "No combination found" says only that the search failed. When it does,
      // work out WHICH courses are responsible so the user knows what to change.
      if (output.results.length === 0) {
        output.diagnosis = Solver.diagnose(chosen, prefs, { allowOverlap: allowOverlap });
      }
      $('status').textContent = output.considered + ' kombinasyon tarandı · ' +
        (Date.now() - started) + ' ms';
      renderResults(output, chosen);
    }, 0);
  }

  wire();
  window.UI = { state, renderChips, renderTray, renderSummary };
})();
