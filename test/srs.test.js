'use strict';
const assert = require('node:assert/strict');
const SRS = require('../public/srs.js');

const T0 = Date.UTC(2026, 9, 21, 12, 0, 0);
const DAY = SRS.DAY;

// first review ladder
let s = SRS.review(null, 2, T0);
assert.equal(s.interval, 1);
assert.equal(s.due, T0 + DAY);
s = SRS.review(s, 2, T0 + DAY);
assert.equal(s.interval, 3);
s = SRS.review(s, 2, T0 + 4 * DAY);
assert.equal(s.interval, Math.round(3 * s.ease));
assert.equal(s.reps, 3);

// again resets, shortens ease, schedules ten minutes ahead
let a = SRS.review(s, 0, T0 + 10 * DAY);
assert.equal(a.reps, 0);
assert.equal(a.lapses, 1);
assert.equal(a.due, T0 + 10 * DAY + 10 * 60000);
assert.ok(a.ease < s.ease);
assert.ok(a.ease >= 1.3);

// ease never drops below 1.3
let e = SRS.newState();
for (let i = 0; i < 30; i += 1) e = SRS.review(e, 0, T0 + i);
assert.equal(e.ease, 1.3);

// easy goes further than good, and review is pure
const base = SRS.review(null, 2, T0);
const baseCopy = JSON.stringify(base);
const good = SRS.review(base, 2, T0 + DAY);
const easy = SRS.review(base, 3, T0 + DAY);
assert.ok(easy.interval > good.interval);
assert.equal(JSON.stringify(base), baseCopy);

// score accounting
let sc = SRS.review(null, 1, T0);
sc = SRS.review(sc, 2, T0 + 1);
assert.equal(sc.seen, 2);
assert.equal(sc.scoreSum, 1.5);

// merge: newest item wins, union of ids
const A = { items: { x: Object.assign(SRS.newState(), { seen: 1, u: 100 }), y: Object.assign(SRS.newState(), { seen: 5, u: 300 }) }, days: { '2026-10-20': 3 }, sessions: [{ t: 10 }] };
const B = { items: { x: Object.assign(SRS.newState(), { seen: 2, u: 200 }), z: Object.assign(SRS.newState(), { seen: 1, u: 50 }) }, days: { '2026-10-20': 5, '2026-10-21': 1 }, sessions: [{ t: 10 }, { t: 20 }] };
const m = SRS.merge(A, B);
assert.equal(m.items.x.seen, 2);
assert.equal(m.items.y.seen, 5);
assert.equal(m.items.z.seen, 1);
assert.equal(m.days['2026-10-20'], 5);
assert.equal(m.sessions.length, 2);
assert.equal(m.sessions[0].t, 20);

// merge is commutative on items and idempotent
const m2 = SRS.merge(B, A);
assert.deepEqual(m2.items, m.items);
assert.deepEqual(SRS.merge(m, m).items, m.items);

// reset drops older items from either side but keeps newer ones
const R = SRS.reset(150);
const afterReset = SRS.merge(m, R);
assert.ok(afterReset.items.x);
assert.ok(afterReset.items.y);
assert.equal(afterReset.items.z, undefined);
assert.equal(afterReset.resetAt, 150);
assert.equal(SRS.merge(afterReset, A).items.x.u, 200);

// garbage in, empty progress out
assert.deepEqual(Object.keys(SRS.normalize('nope').items), []);
assert.deepEqual(Object.keys(SRS.normalize(null).items), []);

// streak
const now = new Date(2026, 9, 21, 12).getTime();
const p = SRS.emptyProgress();
p.days[SRS.dayKey(now)] = 2;
p.days[SRS.dayKey(now - DAY)] = 1;
p.days[SRS.dayKey(now - 2 * DAY)] = 4;
assert.equal(SRS.streak(p, now), 3);
const q = SRS.emptyProgress();
q.days[SRS.dayKey(now - DAY)] = 1;
assert.equal(SRS.streak(q, now), 1);
assert.equal(SRS.streak(SRS.emptyProgress(), now), 0);

// interval formatting
assert.equal(SRS.fmtDue(T0 + 10 * 60000, T0), '10 min');
assert.equal(SRS.fmtDue(T0 + 3 * 3600000, T0), '3 h');
assert.equal(SRS.fmtDue(T0 + DAY, T0), '1 day');
assert.equal(SRS.fmtDue(T0 + 5 * DAY, T0), '5 days');

console.log('srs tests passed');
