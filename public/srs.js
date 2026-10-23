(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SRS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY = 86400000;
  var MIN = 60000;
  var SCORES = [0, 0.5, 1, 1];
  var LABELS = ['Again', 'Hard', 'Good', 'Easy'];

  function newState() {
    return { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: 0, seen: 0, scoreSum: 0, last: 0, u: 0 };
  }

  // rating: 0 again, 1 hard, 2 good, 3 easy. Returns a new state, never mutates prev.
  function review(prev, rating, now) {
    var s = Object.assign(newState(), prev || {});
    now = now || Date.now();
    s.seen += 1;
    s.scoreSum += SCORES[rating];
    s.last = now;
    s.u = now;
    if (rating === 0) {
      s.reps = 0;
      s.lapses += 1;
      s.ease = Math.max(1.3, s.ease - 0.2);
      s.interval = 0;
      s.due = now + 10 * MIN;
    } else {
      if (rating === 1) {
        s.ease = Math.max(1.3, s.ease - 0.15);
        s.interval = s.reps === 0 ? 1 : Math.max(1, Math.round(s.interval * 1.2));
      } else if (rating === 2) {
        s.interval = s.reps === 0 ? 1 : s.reps === 1 ? 3 : Math.max(1, Math.round(s.interval * s.ease));
      } else {
        var goodInterval = s.reps === 0 ? 1 : s.reps === 1 ? 3 : Math.max(1, Math.round(s.interval * s.ease));
        s.ease += 0.15;
        s.interval = s.reps === 0 ? 4 : Math.max(goodInterval + 1, Math.round(s.interval * s.ease * 1.3));
      }
      s.reps += 1;
      s.due = now + s.interval * DAY;
    }
    return s;
  }

  function fmtDue(due, now) {
    var ms = due - now;
    if (ms < 60 * MIN) return Math.max(1, Math.round(ms / MIN)) + ' min';
    if (ms < DAY) return Math.round(ms / (60 * MIN)) + ' h';
    var d = Math.round(ms / DAY);
    return d + (d === 1 ? ' day' : ' days');
  }

  function dayKey(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function emptyProgress() {
    return { v: 1, items: {}, days: {}, sessions: [], resetAt: 0, u: 0 };
  }

  function normalize(p) {
    var out = emptyProgress();
    if (!p || typeof p !== 'object') return out;
    out.resetAt = Number(p.resetAt) || 0;
    out.u = Number(p.u) || 0;
    if (p.items && typeof p.items === 'object') {
      Object.keys(p.items).forEach(function (id) {
        var st = p.items[id];
        if (st && typeof st === 'object') out.items[id] = Object.assign(newState(), st);
      });
    }
    if (p.days && typeof p.days === 'object') {
      Object.keys(p.days).forEach(function (k) {
        var n = Number(p.days[k]);
        if (n > 0) out.days[k] = n;
      });
    }
    if (Array.isArray(p.sessions)) {
      out.sessions = p.sessions.filter(function (s) { return s && typeof s.t === 'number'; });
    }
    return out;
  }

  // Per-item last-write-wins merge. Items older than resetAt are dropped.
  function merge(a, b) {
    a = normalize(a);
    b = normalize(b);
    var resetAt = Math.max(a.resetAt, b.resetAt);
    var out = emptyProgress();
    out.resetAt = resetAt;
    out.u = Math.max(a.u, b.u);
    [a, b].forEach(function (src) {
      Object.keys(src.items).forEach(function (id) {
        var st = src.items[id];
        if (st.u <= resetAt) return;
        if (!out.items[id] || st.u > out.items[id].u) out.items[id] = st;
      });
      Object.keys(src.days).forEach(function (k) {
        if (resetAt && k < dayKey(resetAt)) return;
        out.days[k] = Math.max(out.days[k] || 0, src.days[k]);
      });
    });
    var bySession = {};
    a.sessions.concat(b.sessions).forEach(function (s) {
      if (s.t > resetAt) bySession[s.t] = s;
    });
    out.sessions = Object.keys(bySession)
      .map(function (t) { return bySession[t]; })
      .sort(function (x, y) { return y.t - x.t; })
      .slice(0, 200);
    return out;
  }

  function reset(now) {
    var p = emptyProgress();
    p.resetAt = now;
    p.u = now;
    return p;
  }

  function bumpDay(p, now) {
    var k = dayKey(now);
    p.days[k] = (p.days[k] || 0) + 1;
  }

  function streak(p, now) {
    var n = 0;
    var t = now;
    if (!(p.days[dayKey(t)] > 0)) t -= DAY;
    while (p.days[dayKey(t)] > 0) {
      n += 1;
      t -= DAY;
    }
    return n;
  }

  return {
    DAY: DAY, SCORES: SCORES, LABELS: LABELS,
    newState: newState, review: review, fmtDue: fmtDue, dayKey: dayKey,
    emptyProgress: emptyProgress, normalize: normalize, merge: merge, reset: reset,
    bumpDay: bumpDay, streak: streak,
  };
});
