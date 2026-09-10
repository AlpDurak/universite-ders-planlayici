'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  const state = { courses: [], warnings: [], selected: new Set(), prefs: null, akts: false };

  function showError(message) {
    $('error').textContent = message;
    $('error').classList.remove('hidden');
  }

  // Diacritic-insensitive so 'ısı' matches 'İSİ'.
  const fold = (s) => (s || '').toLocaleLowerCase('tr')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ş/g, 's')
    .replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ç/g, 'c');

  async function loadFile(file) {
    $('error').classList.add('hidden');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { rows } = await XlsxReader.readWorkbook(bytes);
      const cols = CourseParser.detectColumns(rows);
      const built = CourseParser.buildCourses(rows, cols);
      state.courses = built.courses;
      state.warnings = built.warnings;
      state.akts = Boolean(cols.akts);
      state.prefs = Object.assign({}, Scoring.DEFAULT_PREFS);
      restore();
      $('drop').classList.add('hidden');
      $('app').classList.remove('hidden');
      renderWarnings();
      renderChips();
      renderSummary();
    } catch (err) {
      showError(err.message || String(err));
    }
  }

  function renderWarnings() {
    const box = $('warnings');
    if (state.warnings.length === 0) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    const list = state.warnings.slice(0, 12)
      .map((w) => '<li><code>' + w.code + '</code> — ' + w.reason + '</li>').join('');
    const more = state.warnings.length > 12
      ? '<li>…ve ' + (state.warnings.length - 12) + ' tane daha</li>' : '';
    box.innerHTML = '<strong>' + state.warnings.length +
      ' bölüm tam okunamadı ve planlamaya dahil edilmedi:</strong><ul>' + list + more + '</ul>';
  }

  function chipLabel(course) {
    const credit = course.credit > 0 ? course.credit : '—';
    return course.base + '<span class="cr"> · ' + credit + '</span>';
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

  function tooltipFor(course) {
    const sections = course.groups.LEC.concat(course.groups.LAB, course.groups.PS);
    const first = sections[0] || {};
    const times = sections.map((s) => s.code + ': ' +
      s.slots.map((sl) => CourseParser.DAYS[sl.day] + sl.hour).join(' ')).slice(0, 6).join('\n');
    const quota = first.quota ? first.quota.left + ' / ' + first.quota.total + ' kontenjan' : '';
    return '<b>' + (course.title || course.base) + '</b>' +
      (first.instructor ? first.instructor + ' · ' : '') + (first.campus || '') +
      (quota ? ' · ' + quota : '') +
      '<br>' + sections.length + ' bölüm<br><pre style="margin:4px 0 0;font:inherit">' +
      times + '</pre>';
  }

  function wireTooltip() {
    const tip = $('tip');
    $('chips').addEventListener('mouseover', (event) => {
      const chip = event.target.closest('.chip');
      if (!chip) return;
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
    });
    $('chips').addEventListener('mouseout', (event) => {
      if (!event.target.closest('.chip')) return;
      tip.style.display = 'none';
    });
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
    } catch (err) { /* private window or blocked storage: run without memory */ }
  }

  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem('dpi.selected') || '[]');
      state.selected = new Set(saved.filter(
        (base) => state.courses.some((c) => c.base === base)));
      const prefs = JSON.parse(localStorage.getItem('dpi.prefs') || 'null');
      if (prefs) state.prefs = Object.assign({}, Scoring.DEFAULT_PREFS, prefs);
    } catch (err) { state.selected = new Set(); }
  }

  function wire() {
    const drop = $('drop');
    drop.addEventListener('click', () => $('file').click());
    $('file').addEventListener('change', (e) => e.target.files[0] && loadFile(e.target.files[0]));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
      else showError('Bir dosya bırakmalısınız (ör. .xlsx) — sürüklenen içerik dosya değil.');
    });
    $('search').addEventListener('input', renderChips);
    $('gno').addEventListener('change', renderSummary);
    wireTooltip();
  }

  wire();
  window.UI = { state, renderChips, renderSummary };
})();
