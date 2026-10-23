'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server.js');
const { createStorage } = require('../storage.js');
const SRS = require('../public/srs.js');

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prep-test-'));
  const storage = await createStorage({ databaseUrl: '', dataDir: dir });
  const server = createApp({ storage, token: 'secret-token', production: true });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const auth = { Authorization: 'Bearer secret-token', 'Content-Type': 'application/json' };

  // public
  let r = await fetch(base + '/api/health');
  assert.equal(r.status, 200);
  r = await fetch(base + '/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(await r.text(), /<div id="app">/);
  r = await fetch(base + '/srs.js');
  assert.equal(r.status, 200);

  // path traversal and missing files
  r = await fetch(base + '/..%2fserver.js');
  assert.ok(r.status === 403 || r.status === 404);
  r = await fetch(base + '/%2e%2e/%2e%2e/etc/passwd');
  assert.ok(r.status === 403 || r.status === 404);
  r = await fetch(base + '/content/bank.json');
  assert.equal(r.status, 404);

  // auth
  r = await fetch(base + '/api/questions');
  assert.equal(r.status, 401);
  r = await fetch(base + '/api/questions', { headers: { Authorization: 'Bearer wrong' } });
  assert.equal(r.status, 401);
  r = await fetch(base + '/api/questions', { headers: auth });
  assert.equal(r.status, 200);
  const bank = await r.json();
  assert.ok(bank.items.length > 100);

  // empty progress
  r = await fetch(base + '/api/progress', { headers: auth });
  let body = await r.json();
  assert.equal(body.storage, 'file');
  assert.deepEqual(body.progress.items, {});

  // device A writes
  const a = SRS.emptyProgress();
  a.items.q1 = SRS.review(null, 2, 1000);
  a.items.q2 = SRS.review(null, 0, 1000);
  r = await fetch(base + '/api/progress', { method: 'PUT', headers: auth, body: JSON.stringify(a) });
  assert.equal(r.status, 200);

  // device B writes a newer q1 and a new q3; server merges
  const b = SRS.emptyProgress();
  b.items.q1 = SRS.review(SRS.review(null, 2, 1000), 3, 2000);
  b.items.q3 = SRS.review(null, 1, 3000);
  r = await fetch(base + '/api/progress', { method: 'PUT', headers: auth, body: JSON.stringify(b) });
  body = await r.json();
  assert.equal(Object.keys(body.progress.items).sort().join(','), 'q1,q2,q3');
  assert.equal(body.progress.items.q1.seen, 2);

  // a stale write does not overwrite the newer q1
  r = await fetch(base + '/api/progress', { method: 'PUT', headers: auth, body: JSON.stringify(a) });
  body = await r.json();
  assert.equal(body.progress.items.q1.seen, 2);

  // reset removes older items, keeps later ones
  const reset = SRS.reset(2500);
  r = await fetch(base + '/api/progress', { method: 'PUT', headers: auth, body: JSON.stringify(reset) });
  body = await r.json();
  assert.deepEqual(Object.keys(body.progress.items), ['q3']);

  // persisted to disk
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'progress.json'), 'utf8'));
  assert.deepEqual(Object.keys(onDisk.items), ['q3']);

  // bad input
  r = await fetch(base + '/api/progress', { method: 'PUT', headers: auth, body: 'not json' });
  assert.equal(r.status, 400);
  r = await fetch(base + '/api/progress', { method: 'PUT', headers: auth, body: JSON.stringify({ nope: 1 }) });
  assert.equal(r.status, 400);
  r = await fetch(base + '/api/progress', { method: 'PUT', headers: auth, body: JSON.stringify({ items: {}, pad: 'x'.repeat(3 * 1024 * 1024) }) }).catch(() => ({ status: 413 }));
  assert.equal(r.status, 413);
  r = await fetch(base + '/api/nothing', { headers: auth });
  assert.equal(r.status, 404);

  // concurrent writes all land
  const writes = [];
  for (let i = 0; i < 20; i += 1) {
    const p = SRS.emptyProgress();
    p.items['c' + i] = SRS.review(null, 2, 5000 + i);
    writes.push(fetch(base + '/api/progress', { method: 'PUT', headers: auth, body: JSON.stringify(p) }));
  }
  await Promise.all(writes);
  r = await fetch(base + '/api/progress', { headers: auth });
  body = await r.json();
  assert.equal(Object.keys(body.progress.items).filter((k) => k.startsWith('c')).length, 20);

  await new Promise((res) => server.close(res));

  // production without a token refuses API calls
  const closed = createApp({ storage, token: '', production: true });
  await new Promise((r2) => closed.listen(0, '127.0.0.1', r2));
  const b2 = 'http://127.0.0.1:' + closed.address().port;
  r = await fetch(b2 + '/api/questions');
  assert.equal(r.status, 503);
  await new Promise((res) => closed.close(res));

  console.log('api tests passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
