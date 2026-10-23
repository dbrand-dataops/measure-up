(function () {
  'use strict';

  const SRS = window.SRS;
  const DAY = SRS.DAY;
  const KEYS = { token: 'prep.token', progress: 'prep.progress.v1', bank: 'prep.bank.v1', filters: 'prep.filters.v1' };
  const LANG_ORDER = ['dax', 'm', 'sql', 'banner', 'he-data', 'modelling', 'security'];
  const LANG_LABEL = { dax: 'DAX', m: 'M', sql: 'SQL', banner: 'Banner', 'he-data': 'HE data', modelling: 'Modelling', security: 'Security' };
  const LEVELS = ['junior', 'mid', 'senior'];
  const TAG_OPTIONS = ['trap', 'most-asked', 'confidence', 'interview-staple', 'core'];
  const SOURCE_LABEL = { general: 'General', 'banner-he': 'Banner and HE', 'university-analytics': 'University analytics' };
  const TYPE_LABEL = {
    flashcard: 'Flashcard', mcq: 'Multiple choice', predict: 'Predict the output',
    bug: 'Spot the bug', explain: 'Explain aloud', pattern: 'Write from memory',
  };
  const MODES = [
    { id: 'flashcard', label: 'Flashcards', blurb: 'Concept on the front, answer and trap on the back', types: ['flashcard'] },
    { id: 'mcq', label: 'Quiz', blurb: 'Multiple choice with the reason for every option', types: ['mcq'] },
    { id: 'predict', label: 'Predict the output', blurb: 'Work out the result table before revealing it', types: ['predict'] },
    { id: 'bug', label: 'Spot the bug', blurb: 'Diagnose broken DAX, M or SQL from the symptom', types: ['bug'] },
    { id: 'explain', label: 'Explain aloud', blurb: 'Answer out loud, then tick the key points you hit', types: ['explain'] },
    { id: 'pattern', label: 'Write from memory', blurb: 'Reproduce a standard measure or query', types: ['pattern'] },
  ];

  const state = {
    items: [],
    byId: new Map(),
    progress: loadLocalProgress(),
    filters: loadFilters(),
    token: lsGet(KEYS.token) || '',
    view: 'boot',
    session: null,
    summary: null,
    sync: { status: 'idle', at: 0 },
    storage: '',
    error: '',
    notice: '',
    mockCount: 15,
  };

  // ---------------------------------------------------------------- helpers

  function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function lsSet(key, val) { try { localStorage.setItem(key, val); return true; } catch (e) { return false; } }
  function lsDel(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } }

  function h(tag, attrs) {
    const el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        const v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') el.className = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, String(v));
      });
    }
    for (let i = 2; i < arguments.length; i += 1) appendChild(el, arguments[i]);
    return el;
  }
  function appendChild(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { appendChild(el, x); }); return; }
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function pct(x) { return Math.round(x * 100) + '%'; }
  function fmtDuration(ms) {
    const s = Math.round(ms / 1000);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function langLabel(l) { return LANG_LABEL[l] || l; }
  function itemTitle(it) {
    const raw = it.type === 'flashcard' ? it.front : it.type === 'bug' ? it.symptom : it.type === 'pattern' ? it.name : it.prompt;
    const first = String(raw || it.id).split('\n')[0];
    return first.length > 150 ? first.slice(0, 147) + '...' : first;
  }

  // ---------------------------------------------------------------- persistence and sync

  function loadLocalProgress() {
    try { return SRS.normalize(JSON.parse(lsGet(KEYS.progress))); } catch (e) { return SRS.emptyProgress(); }
  }
  function saveLocal() { lsSet(KEYS.progress, JSON.stringify(state.progress)); }
  function defaultFilters() { return { language: [], level: [], source: [], tags: [], unverified: true }; }
  function loadFilters() {
    try {
      const f = JSON.parse(lsGet(KEYS.filters));
      return Object.assign(defaultFilters(), f || {});
    } catch (e) { return defaultFilters(); }
  }
  function saveFilters() { lsSet(KEYS.filters, JSON.stringify(state.filters)); }

  async function api(path, opts) {
    const o = opts || {};
    const headers = Object.assign({ 'Content-Type': 'application/json' }, o.headers || {});
    if (state.token) headers.Authorization = 'Bearer ' + state.token;
    const res = await fetch(path, Object.assign({}, o, { headers: headers }));
    if (res.status === 401) throw Object.assign(new Error('Unauthorised'), { code: 401 });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  let pushTimer = null;
  function setSync(status) {
    state.sync = { status: status, at: status === 'ok' ? Date.now() : state.sync.at };
    const el = document.getElementById('sync-chip');
    if (el) { el.className = 'chip sync ' + status; el.textContent = syncText(); }
  }
  function syncText() {
    const s = state.sync;
    if (s.status === 'ok') {
      const d = new Date(s.at);
      return 'Synced ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }
    if (s.status === 'syncing') return 'Syncing';
    if (s.status === 'offline') return 'Offline, saved on this device';
    return 'Not synced yet';
  }
  function scheduleSync() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { pushNow(false); }, 1200);
  }
  function onAuthError(e) {
    if (e && e.code === 401) {
      state.view = 'login';
      state.error = 'The access token was rejected.';
      render();
      return true;
    }
    return false;
  }
  async function pushNow(quiet) {
    try {
      if (!quiet) setSync('syncing');
      const r = await api('/api/progress', { method: 'PUT', body: JSON.stringify(state.progress) });
      state.storage = r.storage || state.storage;
      state.progress = SRS.merge(state.progress, r.progress);
      saveLocal();
      setSync('ok');
    } catch (e) {
      if (!onAuthError(e)) setSync('offline');
    }
  }
  async function syncNow() {
    setSync('syncing');
    try {
      const r = await api('/api/progress');
      state.storage = r.storage || '';
      state.progress = SRS.merge(state.progress, r.progress);
      saveLocal();
      await pushNow(true);
      if (state.view === 'home') render();
    } catch (e) {
      if (!onAuthError(e)) setSync('offline');
    }
  }

  // ---------------------------------------------------------------- bank and selection

  function setBank(bank) {
    state.items = bank.items || [];
    state.byId = new Map(state.items.map(function (it) { return [it.id, it]; }));
  }

  function passes(it, f) {
    if (f.language.length && f.language.indexOf(it.language) < 0) return false;
    if (f.level.length && f.level.indexOf(it.level) < 0) return false;
    if (f.source.length && f.source.indexOf(it.source) < 0) return false;
    if (f.tags.length && !(it.tags || []).some(function (t) { return f.tags.indexOf(t) >= 0; })) return false;
    if (!f.unverified && !it.verified) return false;
    return true;
  }
  function filteredPool() { return state.items.filter(function (it) { return passes(it, state.filters); }); }

  function poolStats(pool) {
    const now = Date.now();
    const out = { total: pool.length, seen: 0, due: 0, attempts: 0, score: 0 };
    pool.forEach(function (it) {
      const st = state.progress.items[it.id];
      if (st && st.seen) {
        out.seen += 1; out.attempts += st.seen; out.score += st.scoreSum;
        if (st.due <= now) out.due += 1;
      }
    });
    return out;
  }
  function languageAccuracy() {
    const acc = {};
    const tot = {};
    state.items.forEach(function (it) {
      const st = state.progress.items[it.id];
      if (!st || !st.seen) return;
      tot[it.language] = tot[it.language] || { a: 0, s: 0 };
      tot[it.language].a += st.seen;
      tot[it.language].s += st.scoreSum;
    });
    Object.keys(tot).forEach(function (l) { acc[l] = tot[l].s / tot[l].a; });
    return acc;
  }

  function rankItems(pool) {
    const now = Date.now();
    const acc = languageAccuracy();
    return pool.map(function (it) {
      const st = state.progress.items[it.id];
      let s;
      if (!st || !st.seen) s = 1;
      else if (st.due <= now) s = 2 + Math.min(2, (now - st.due) / (7 * DAY));
      else s = 0.15 + Math.random() * 0.05;
      const weak = 1 - (acc[it.language] == null ? 0.5 : acc[it.language]);
      s *= 0.75 + 0.5 * weak;
      s *= 0.8 + Math.random() * 0.4;
      return { it: it, s: s };
    }).sort(function (a, b) { return b.s - a.s; }).map(function (x) { return x.it; });
  }

  function pickMock(pool, n) {
    const weights = { mcq: 0.3, flashcard: 0.15, predict: 0.1, bug: 0.15, explain: 0.1, pattern: 0.2 };
    const ranked = rankItems(pool);
    const byType = {};
    ranked.forEach(function (it) { (byType[it.type] = byType[it.type] || []).push(it); });
    const picked = [];
    const chosen = new Set();
    Object.keys(weights).forEach(function (t) {
      (byType[t] || []).slice(0, Math.round(n * weights[t])).forEach(function (it) { picked.push(it); chosen.add(it.id); });
    });
    for (let i = 0; i < ranked.length && picked.length < n; i += 1) {
      if (!chosen.has(ranked[i].id)) { picked.push(ranked[i]); chosen.add(ranked[i].id); }
    }
    return shuffle(picked).slice(0, n);
  }

  function selectItems(opts) {
    if (opts.ids) return opts.ids.map(function (id) { return state.byId.get(id); }).filter(Boolean);
    let pool = filteredPool();
    if (opts.types) pool = pool.filter(function (it) { return opts.types.indexOf(it.type) >= 0; });
    if (opts.topic) pool = pool.filter(function (it) { return it.topic === opts.topic && it.language === opts.language; });
    if (opts.kind === 'mock') return pickMock(pool, opts.n);
    return rankItems(pool).slice(0, opts.n);
  }

  // ---------------------------------------------------------------- sessions

  function startSession(opts) {
    const items = selectItems(opts);
    if (!items.length) {
      state.notice = 'No items match the current filters.';
      state.view = 'home';
      render();
      return;
    }
    state.notice = '';
    state.session = {
      opts: opts, label: opts.label, queue: items, idx: 0, results: [],
      startedAt: Date.now(), itemStart: Date.now(), card: null,
    };
    state.view = 'session';
    render();
  }

  function clearCardTimers() {
    const s = state.session;
    if (s && s.card && s.card.timers) s.card.timers.forEach(function (id) { clearInterval(id); });
  }

  function rate(r) {
    const s = state.session;
    if (!s || !s.card || s.card.rated) return;
    s.card.rated = true;
    const it = s.queue[s.idx];
    const now = Date.now();
    state.progress.items[it.id] = SRS.review(state.progress.items[it.id], r, now);
    SRS.bumpDay(state.progress, now);
    state.progress.u = now;
    s.results.push({ id: it.id, rating: r, score: SRS.SCORES[r], ms: now - s.itemStart });
    saveLocal();
    scheduleSync();
    clearCardTimers();
    s.idx += 1;
    s.itemStart = Date.now();
    render();
  }

  function finishSession() {
    const s = state.session;
    clearCardTimers();
    const n = s.results.length;
    const score = n ? s.results.reduce(function (a, r) { return a + r.score; }, 0) / n : 0;
    const ms = Date.now() - s.startedAt;
    if (n) {
      state.progress.sessions.unshift({ t: Date.now(), mode: s.label, n: n, score: Math.round(score * 1000) / 1000, ms: ms });
      state.progress.sessions = state.progress.sessions.slice(0, 200);
      state.progress.u = Date.now();
      saveLocal();
      scheduleSync();
    }
    state.summary = { label: s.label, results: s.results, score: score, ms: ms };
    state.session = null;
    state.view = n ? 'summary' : 'home';
    render();
  }

  // ---------------------------------------------------------------- shared card pieces

  function section(label, content, cls) {
    return h('div', { class: 'section' + (cls ? ' ' + cls : '') }, h('div', { class: 'h' }, label), content);
  }
  function prose(text) { return h('div', { class: 'prose' }, text); }
  function codeBlock(text) { return h('pre', { class: 'code' }, h('code', null, text)); }
  function kbdHint(text) { return h('div', { class: 'kbd' }, text); }
  function draft(label, codey) {
    return h('div', { class: 'section' }, h('div', { class: 'h' }, label),
      h('textarea', { class: codey ? 'codey' : '', rows: '4', 'aria-label': label, spellcheck: 'false' }));
  }
  function tableEl(name, t) {
    return h('div', { class: 'tbl' },
      name ? h('div', { class: 'tbl-name' }, name) : null,
      h('table', null,
        h('thead', null, h('tr', null, t.columns.map(function (c) { return h('th', null, c); }))),
        h('tbody', null, t.rows.map(function (r) { return h('tr', null, r.map(function (v) { return h('td', null, v); })); }))));
  }
  function itemChips(it) {
    return h('div', { class: 'chips' },
      h('span', { class: 'chip' }, TYPE_LABEL[it.type] || it.type),
      h('span', { class: 'chip' }, langLabel(it.language)),
      h('span', { class: 'chip' }, it.level),
      h('span', { class: 'chip' }, it.topic),
      (it.tags || []).indexOf('trap') >= 0 ? h('span', { class: 'chip trap' }, 'trap') : null,
      (it.tags || []).indexOf('most-asked') >= 0 ? h('span', { class: 'chip' }, 'most asked') : null,
      it.verified ? null : h('span', { class: 'chip warn' }, 'Unverified'));
  }
  function ratingBar(it) {
    const st = state.progress.items[it.id];
    const now = Date.now();
    const bar = h('div', { class: 'rating' });
    SRS.LABELS.forEach(function (label, r) {
      const next = SRS.review(st, r, now);
      bar.append(h('button', { class: 'btn rate', type: 'button', 'data-r': String(r), onclick: function () { rate(r); } },
        h('span', { class: 'lbl' }, (r + 1) + ' ' + label),
        h('span', { class: 'int' }, SRS.fmtDue(next.due, now))));
    });
    return bar;
  }
  // Reveal-style cards: a button reveals the answer and the rating bar.
  function setupReveal(it, wrap, card, label, answerEl, extra) {
    answerEl.hidden = true;
    const rating = ratingBar(it);
    rating.hidden = true;
    const btn = h('button', { class: 'btn primary', type: 'button' }, label);
    function reveal() {
      if (card.revealed) return;
      card.revealed = true;
      btn.hidden = true;
      answerEl.hidden = false;
      rating.hidden = false;
      if (extra) extra();
    }
    btn.addEventListener('click', reveal);
    card.handlers.primary = reveal;
    card.handlers.rate = rate;
    wrap.append(h('div', { class: 'actions' }, btn), answerEl, rating, kbdHint('Space to reveal, then 1 to 4 to rate'));
    return rating;
  }

  // ---------------------------------------------------------------- card builders

  function buildFlashcard(it, wrap, card) {
    wrap.append(section('Question', prose(it.front)));
    const ans = h('div', { class: 'answer' }, section('Answer', prose(it.back)), it.trap ? section('Trap', prose(it.trap), 'trap') : null);
    setupReveal(it, wrap, card, 'Show answer', ans);
  }

  function buildMcq(it, wrap, card) {
    wrap.append(section('Question', prose(it.prompt)));
    if (it.code) wrap.append(codeBlock(it.code));
    const order = shuffle(it.options.slice());
    const opts = h('div', { class: 'opts' });
    const buttons = [];
    const feedback = h('div', { hidden: true });
    const actions = h('div', { class: 'actions', hidden: true });
    let correct = false;
    function choose(i) {
      if (card.revealed || i < 0 || i >= order.length) return;
      card.revealed = true;
      correct = order[i].id === it.answer;
      buttons.forEach(function (b, j) {
        b.disabled = true;
        if (order[j].id === it.answer) b.classList.add('correct');
        else if (j === i) b.classList.add('wrong');
        b.append(h('span', { class: 'why' }, order[j].why));
      });
      feedback.hidden = false;
      feedback.append(h('div', { class: 'verdict ' + (correct ? 'good' : 'bad') }, correct ? 'Correct' : 'Not quite'));
      actions.hidden = false;
      actions.append(h('button', { class: 'btn primary', type: 'button', onclick: function () { rate(correct ? 2 : 0); } }, 'Next'));
      if (correct) actions.append(h('button', { class: 'btn', type: 'button', onclick: function () { rate(1); } }, 'I guessed (Hard)'));
    }
    order.forEach(function (o, i) {
      const b = h('button', { class: 'opt', type: 'button' },
        h('span', { class: 'k' }, String.fromCharCode(65 + i)),
        h('span', { class: 'txt' }, o.text));
      b.addEventListener('click', function () { choose(i); });
      buttons.push(b);
      opts.append(b);
    });
    card.handlers.option = choose;
    card.handlers.primary = function () { if (card.revealed) rate(correct ? 2 : 0); };
    wrap.append(opts, feedback, actions, kbdHint('Press A to D to answer, then Space for the next question'));
  }

  function buildPredict(it, wrap, card) {
    wrap.append(section('Question', prose(it.prompt)));
    Object.keys(it.data || {}).forEach(function (name) { wrap.append(tableEl(name, it.data[name])); });
    wrap.append(section('Code', codeBlock(it.code)));
    const ans = h('div', { class: 'answer' }, section('Output', tableEl(null, it.output)), section('Explanation', prose(it.explanation)));
    setupReveal(it, wrap, card, 'Show output', ans);
  }

  function buildBug(it, wrap, card) {
    wrap.append(section('Symptom', prose(it.symptom)), section('Code', codeBlock(it.code)),
      draft('Your diagnosis (optional, not saved)'));
    const ans = h('div', { class: 'answer' }, section('Diagnosis', prose(it.diagnosis)), section('Fix', prose(it.fix)));
    setupReveal(it, wrap, card, 'Show diagnosis and fix', ans);
  }

  function buildExplain(it, wrap, card) {
    const t0 = Date.now();
    const timerEl = h('span', { class: 'timer' }, '0:00');
    card.timers.push(setInterval(function () { timerEl.textContent = fmtDuration(Date.now() - t0); }, 500));
    wrap.append(section('Question', prose(it.prompt)),
      h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Speaking time'), timerEl),
      draft('Notes (optional, not saved)'));
    const ans = h('div', { class: 'answer' });
    const checks = h('div', { class: 'checks' });
    const rating = setupReveal(it, wrap, card, 'Show key points', ans);
    function update() {
      const n = checks.querySelectorAll('input:checked').length;
      const ratio = n / it.keyPoints.length;
      const sug = ratio < 0.4 ? 0 : ratio < 0.7 ? 1 : ratio < 1 ? 2 : 3;
      rating.querySelectorAll('.rate').forEach(function (b) { b.classList.toggle('suggested', Number(b.getAttribute('data-r')) === sug); });
    }
    it.keyPoints.forEach(function (p) {
      const cb = h('input', { type: 'checkbox' });
      cb.addEventListener('change', update);
      checks.append(h('label', null, cb, h('span', null, p)));
    });
    ans.append(section('Key points (tick what you covered)', checks));
  }

  function buildPattern(it, wrap, card) {
    wrap.append(section('Pattern', h('div', { class: 'prose' }, h('strong', null, it.name))),
      section('Scenario', prose(it.scenario)),
      draft('Write it from memory (not saved)', true));
    const ans = h('div', { class: 'answer' }, section('Solution', codeBlock(it.code)), it.notes ? section('Notes', prose(it.notes)) : null);
    setupReveal(it, wrap, card, 'Show solution', ans);
  }

  function buildCard(it) {
    const card = { revealed: false, rated: false, handlers: {}, timers: [] };
    state.session.card = card;
    const wrap = h('div', { class: 'card' }, itemChips(it));
    const builders = { flashcard: buildFlashcard, mcq: buildMcq, predict: buildPredict, bug: buildBug, explain: buildExplain, pattern: buildPattern };
    (builders[it.type] || buildFlashcard)(it, wrap, card);
    return wrap;
  }

  // ---------------------------------------------------------------- views

  function topbar(title, right) {
    return h('div', { class: 'topbar' }, h('h1', null, title), h('div', { class: 'right' }, right));
  }
  function syncChip() { return h('span', { id: 'sync-chip', class: 'chip sync ' + state.sync.status }, syncText()); }

  function viewLogin() {
    const input = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': 'Access token' });
    function go() {
      state.token = input.value.trim();
      if (!state.token) return;
      lsSet(KEYS.token, state.token);
      state.error = '';
      boot();
    }
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    return h('div', null, topbar('DAX and M prep'),
      h('div', { class: 'panel' },
        h('p', null, 'Enter your access token.'),
        state.error ? h('div', { class: 'notice' }, state.error) : null,
        h('div', { class: 'row' }, input, h('button', { class: 'btn primary', type: 'button', onclick: go }, 'Continue'))));
  }

  function chipGroup(label, key, options) {
    const chips = h('div', { class: 'chips' });
    options.forEach(function (o) {
      const on = state.filters[key].indexOf(o.value) >= 0;
      chips.append(h('button', {
        class: 'chip' + (on ? ' on' : ''), type: 'button', 'aria-pressed': on ? 'true' : 'false',
        onclick: function () {
          const arr = state.filters[key];
          const i = arr.indexOf(o.value);
          if (i >= 0) arr.splice(i, 1); else arr.push(o.value);
          saveFilters();
          render();
        },
      }, o.label + ' ' + o.count));
    });
    return h('div', null, h('div', { class: 'label' }, label), chips);
  }
  function countBy(fn) {
    const c = {};
    state.items.forEach(function (it) { const k = fn(it); c[k] = (c[k] || 0) + 1; });
    return c;
  }

  function viewHome() {
    const pool = filteredPool();
    const st = poolStats(pool);
    const root = h('div');
    root.append(topbar('DAX and M prep', [syncChip(), h('button', { class: 'btn small', type: 'button', onclick: function () { state.view = 'settings'; render(); } }, 'Settings')]));
    if (state.notice) root.append(h('div', { class: 'notice' }, state.notice));

    const accuracy = st.attempts ? pct(st.score / st.attempts) : 'n/a';
    root.append(h('div', { class: 'grid stats' },
      stat(st.total, 'Items in scope'), stat(st.seen, 'Studied'), stat(st.due, 'Due now'),
      stat(accuracy, 'Accuracy'), stat(SRS.streak(state.progress, Date.now()), 'Day streak')));

    root.append(h('h2', null, 'Start'));
    const mockSel = h('select', { 'aria-label': 'Mock interview length' },
      [10, 15, 25].map(function (n) { return h('option', Object.assign({ value: String(n) }, n === state.mockCount ? { selected: true } : {}), n + ' questions'); }));
    mockSel.addEventListener('change', function () { state.mockCount = Number(mockSel.value); });
    root.append(h('div', { class: 'panel' },
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'button', onclick: function () { startSession({ kind: 'smart', n: 20, label: 'Smart session' }); } }, 'Smart session (20)'),
        h('button', { class: 'btn', type: 'button', onclick: function () { startSession({ kind: 'mock', n: state.mockCount, label: 'Mock interview' }); } }, 'Mock interview'),
        mockSel),
      h('p', { class: 'muted' }, 'A smart session puts due items first, then new ones, weighted towards your weaker languages. A mock interview mixes every question type.')));

    const modes = h('div', { class: 'grid modes' });
    MODES.forEach(function (m) {
      const mp = pool.filter(function (it) { return m.types.indexOf(it.type) >= 0; });
      const ms = poolStats(mp);
      modes.append(h('button', { class: 'btn modebtn', type: 'button', onclick: function () { startSession({ kind: 'mode', types: m.types, n: 15, label: m.label }); } },
        h('div', { class: 't' }, m.label),
        h('div', { class: 's' }, ms.total + ' items, ' + ms.due + ' due'),
        h('div', { class: 's' }, m.blurb)));
    });
    root.append(h('div', { style: null }, modes));

    root.append(h('h2', null, 'Progress by language'));
    const bars = h('div', { class: 'bars' });
    LANG_ORDER.forEach(function (l) {
      const lp = pool.filter(function (it) { return it.language === l; });
      if (!lp.length) return;
      const s = poolStats(lp);
      const fill = h('div', { class: 'fill' });
      fill.style.width = (s.total ? (s.seen / s.total) * 100 : 0) + '%';
      bars.append(h('div', { class: 'bar-row' }, h('div', null, langLabel(l)), h('div', { class: 'bar' }, fill),
        h('div', { class: 'meta' }, s.seen + ' of ' + s.total + ' studied, ' + (s.attempts ? pct(s.score / s.attempts) : 'no score'))));
    });
    root.append(h('div', { class: 'panel' }, bars));

    const topics = {};
    pool.forEach(function (it) {
      const s = state.progress.items[it.id];
      if (!s || !s.seen) return;
      const k = it.language + '/' + it.topic;
      topics[k] = topics[k] || { language: it.language, topic: it.topic, a: 0, s: 0 };
      topics[k].a += s.seen;
      topics[k].s += s.scoreSum;
    });
    const weak = Object.keys(topics).map(function (k) { return topics[k]; })
      .filter(function (t) { return t.a >= 2; })
      .sort(function (x, y) { return x.s / x.a - y.s / y.a; }).slice(0, 8);
    root.append(h('h2', null, 'Weakest topics'));
    if (!weak.length) {
      root.append(h('div', { class: 'panel muted' }, 'Weak topics appear here once you have answered at least two items in a topic.'));
    } else {
      const list = h('div', { class: 'weak' });
      weak.forEach(function (t) {
        list.append(h('div', { class: 'weak-row' },
          h('div', null, langLabel(t.language) + ' / ' + t.topic + ': ', h('strong', null, pct(t.s / t.a)), h('span', { class: 'muted' }, ' (' + t.a + ' attempts)')),
          h('button', { class: 'btn small', type: 'button', onclick: function () { startSession({ kind: 'topic', topic: t.topic, language: t.language, n: 15, label: 'Topic: ' + t.topic }); } }, 'Practise')));
      });
      root.append(h('div', { class: 'panel' }, list));
    }

    root.append(h('h2', null, 'Filters'));
    const f = h('div', { class: 'panel filters' });
    const langs = countBy(function (it) { return it.language; });
    f.append(chipGroup('Language', 'language', LANG_ORDER.concat(Object.keys(langs).filter(function (l) { return LANG_ORDER.indexOf(l) < 0; }))
      .filter(function (l) { return langs[l]; }).map(function (l) { return { value: l, label: langLabel(l), count: langs[l] }; })));
    const lv = countBy(function (it) { return it.level; });
    f.append(chipGroup('Level', 'level', LEVELS.filter(function (l) { return lv[l]; }).map(function (l) { return { value: l, label: l, count: lv[l] }; })));
    const src = countBy(function (it) { return it.source; });
    f.append(chipGroup('Question bank', 'source', Object.keys(src).sort().map(function (s) { return { value: s, label: SOURCE_LABEL[s] || s, count: src[s] }; })));
    const tg = {};
    state.items.forEach(function (it) { (it.tags || []).forEach(function (t) { tg[t] = (tg[t] || 0) + 1; }); });
    f.append(chipGroup('Tags', 'tags', TAG_OPTIONS.filter(function (t) { return tg[t]; }).map(function (t) { return { value: t, label: t, count: tg[t] }; })));
    f.append(h('div', { class: 'label' }, 'Unverified items'));
    f.append(h('div', { class: 'chips' }, h('button', {
      class: 'chip' + (state.filters.unverified ? ' on' : ''), type: 'button', 'aria-pressed': state.filters.unverified ? 'true' : 'false',
      onclick: function () { state.filters.unverified = !state.filters.unverified; saveFilters(); render(); },
    }, 'Include unverified')));
    root.append(f);
    return root;
  }
  function stat(n, label) { return h('div', { class: 'stat' }, h('div', { class: 'n' }, n), h('div', { class: 'l' }, label)); }

  function viewSession() {
    const s = state.session;
    if (s.idx >= s.queue.length) { finishSession(); return null; }
    const it = s.queue[s.idx];
    const fill = h('div', { class: 'fill' });
    fill.style.width = (s.idx / s.queue.length) * 100 + '%';
    const root = h('div');
    root.append(h('div', { class: 'session-top' },
      h('div', null, h('strong', null, s.label), ' ', h('span', { class: 'muted' }, (s.idx + 1) + ' of ' + s.queue.length)),
      h('button', { class: 'btn small', type: 'button', onclick: function () { finishSession(); } }, s.results.length ? 'Finish' : 'Quit')),
      h('div', { class: 'progress' }, fill));
    root.append(buildCard(it));
    return root;
  }

  function viewSummary() {
    const sm = state.summary;
    const root = h('div');
    root.append(topbar('Session complete', h('button', { class: 'btn small', type: 'button', onclick: function () { state.view = 'home'; render(); } }, 'Home')));
    root.append(h('div', { class: 'grid stats' }, stat(sm.results.length, 'Items'), stat(pct(sm.score), 'Score'), stat(fmtDuration(sm.ms), 'Time')));
    const byLang = {};
    sm.results.forEach(function (r) {
      const it = state.byId.get(r.id);
      if (!it) return;
      byLang[it.language] = byLang[it.language] || { n: 0, s: 0 };
      byLang[it.language].n += 1;
      byLang[it.language].s += r.score;
    });
    root.append(h('h2', null, 'By language'));
    const bars = h('div', { class: 'bars' });
    Object.keys(byLang).forEach(function (l) {
      const fill = h('div', { class: 'fill' });
      fill.style.width = (byLang[l].s / byLang[l].n) * 100 + '%';
      bars.append(h('div', { class: 'bar-row' }, h('div', null, langLabel(l)), h('div', { class: 'bar' }, fill),
        h('div', { class: 'meta' }, pct(byLang[l].s / byLang[l].n) + ' of ' + byLang[l].n)));
    });
    root.append(h('div', { class: 'panel' }, bars));
    const missed = sm.results.filter(function (r) { return r.rating <= 1; });
    root.append(h('h2', null, 'To revisit (' + missed.length + ')'));
    if (!missed.length) {
      root.append(h('div', { class: 'panel muted' }, 'Nothing rated Again or Hard.'));
    } else {
      const list = h('div', { class: 'missed' });
      missed.forEach(function (r) {
        const it = state.byId.get(r.id);
        if (it) list.append(h('div', { class: 'item' }, h('div', { class: 'chips' }, h('span', { class: 'chip' }, langLabel(it.language)), h('span', { class: 'chip' }, it.topic)), h('div', null, itemTitle(it))));
      });
      root.append(h('div', { class: 'panel' }, list,
        h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'button', onclick: function () {
          startSession({ kind: 'missed', ids: missed.map(function (r) { return r.id; }), n: missed.length, label: 'Review of missed items' });
        } }, 'Practise these again'))));
    }
    root.append(h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: function () { state.view = 'home'; render(); } }, 'Back to home')));
    return root;
  }

  function exportProgress() {
    const blob = new Blob([JSON.stringify(state.progress, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: 'prep-progress-' + SRS.dayKey(Date.now()) + '.json' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function viewSettings() {
    const root = h('div');
    root.append(topbar('Settings', [syncChip(), h('button', { class: 'btn small', type: 'button', onclick: function () { state.view = 'home'; render(); } }, 'Home')]));
    const msg = h('div', { class: 'muted' });

    const tokenInput = h('input', { type: 'password', autocomplete: 'off', 'aria-label': 'Access token' });
    tokenInput.value = state.token;
    const file = h('input', { type: 'file', accept: 'application/json', hidden: true });
    file.addEventListener('change', function () {
      const f = file.files && file.files[0];
      if (!f) return;
      f.text().then(function (text) {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed.items !== 'object') throw new Error('not a progress file');
        state.progress = SRS.merge(state.progress, parsed);
        saveLocal();
        scheduleSync();
        msg.textContent = 'Imported and merged ' + Object.keys(parsed.items).length + ' items.';
      }).catch(function (e) { msg.textContent = 'Import failed: ' + e.message; });
    });

    root.append(h('div', { class: 'panel' },
      h('h2', null, 'Sync'),
      h('p', { class: 'muted' }, 'Progress is stored on this device and merged with the server (' + (state.storage || 'not connected') + '). The most recent review of each question wins.'),
      h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: function () { syncNow(); } }, 'Sync now'))));
    root.append(h('div', { class: 'panel' },
      h('h2', null, 'Access token'),
      h('div', { class: 'row' }, tokenInput, h('button', { class: 'btn', type: 'button', onclick: function () {
        state.token = tokenInput.value.trim();
        lsSet(KEYS.token, state.token);
        msg.textContent = 'Token saved on this device.';
        syncNow();
      } }, 'Save token'),
      h('button', { class: 'btn', type: 'button', onclick: function () {
        lsDel(KEYS.token);
        state.token = '';
        state.view = 'login';
        render();
      } }, 'Forget token'))));
    root.append(h('div', { class: 'panel' },
      h('h2', null, 'Backup'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', type: 'button', onclick: exportProgress }, 'Export progress'),
        h('button', { class: 'btn', type: 'button', onclick: function () { file.click(); } }, 'Import progress'), file)));
    root.append(h('div', { class: 'panel' },
      h('h2', null, 'Reset'),
      h('p', { class: 'muted' }, 'Clears all review history on this device and on the server.'),
      h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: function () {
        if (!window.confirm('Reset all progress? This cannot be undone.')) return;
        state.progress = SRS.reset(Date.now());
        saveLocal();
        pushNow(false);
        msg.textContent = 'Progress reset.';
      } }, 'Reset progress'))));
    root.append(msg);
    return root;
  }

  function render() {
    clearCardTimers();
    const root = document.getElementById('app');
    root.textContent = '';
    let view = null;
    if (state.view === 'boot') view = h('p', { class: 'loading' }, 'Loading');
    else if (state.view === 'login') view = viewLogin();
    else if (state.view === 'error') view = h('div', { class: 'panel' }, h('div', { class: 'notice' }, state.error),
      h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: boot }, 'Retry')));
    else if (state.view === 'home') view = viewHome();
    else if (state.view === 'session') view = viewSession();
    else if (state.view === 'summary') view = viewSummary();
    else if (state.view === 'settings') view = viewSettings();
    if (view) root.append(view);
    window.scrollTo(0, 0);
  }

  document.addEventListener('keydown', function (e) {
    if (state.view !== 'session' || !state.session || !state.session.card) return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const card = state.session.card;
    const k = e.key;
    if (k === ' ' || k === 'Enter') {
      if (tag === 'BUTTON') return;
      e.preventDefault();
      if (card.handlers.primary) card.handlers.primary();
    } else if (k >= '1' && k <= '4') {
      if (card.revealed && card.handlers.rate) card.handlers.rate(Number(k) - 1);
    } else if (/^[a-dA-D]$/.test(k)) {
      if (card.handlers.option) card.handlers.option(k.toLowerCase().charCodeAt(0) - 97);
    }
  });

  // ---------------------------------------------------------------- boot

  async function boot() {
    state.view = 'boot';
    render();
    try {
      const bank = await api('/api/questions');
      setBank(bank);
      try { lsSet(KEYS.bank, JSON.stringify(bank)); } catch (e) { /* ignore */ }
    } catch (e) {
      if (e.code === 401) { state.view = 'login'; state.error = state.token ? 'The access token was rejected.' : ''; render(); return; }
      let cached = null;
      try { cached = JSON.parse(lsGet(KEYS.bank)); } catch (err) { /* ignore */ }
      if (cached && cached.items) {
        setBank(cached);
        state.sync = { status: 'offline', at: 0 };
      } else {
        state.view = 'error';
        state.error = 'Could not load the questions: ' + e.message;
        render();
        return;
      }
    }
    state.view = 'home';
    render();
    syncNow();
  }

  boot();
})();
