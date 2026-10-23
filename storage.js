'use strict';
// Single-user progress storage. One JSON document under the id "main".
// Uses Postgres when DATABASE_URL is set, otherwise a JSON file in DATA_DIR (default ./data).
// update(fn) runs fn(current or null) -> next, serialised so concurrent writes cannot interleave.
const fs = require('node:fs');
const path = require('node:path');

function createFile(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'progress.json');
  let chain = Promise.resolve();

  function read() {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }

  return {
    kind: 'file',
    async get() {
      return read();
    },
    update(fn) {
      const run = chain.then(() => {
        const next = fn(read());
        const tmp = file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(next));
        fs.renameSync(tmp, file);
        return next;
      });
      chain = run.catch(() => {});
      return run;
    },
    async close() {},
  };
}

async function createPg(url) {
  const { Pool } = require('pg');
  const useSsl = /\.render\.com/.test(url) || process.env.PGSSL === 'require';
  const pool = new Pool({ connectionString: url, ssl: useSsl ? { rejectUnauthorized: false } : undefined, max: 3 });
  await pool.query(
    'create table if not exists progress (id text primary key, data jsonb not null, updated_at timestamptz not null default now())'
  );
  return {
    kind: 'postgres',
    async get() {
      const r = await pool.query("select data from progress where id = 'main'");
      return r.rows[0] ? r.rows[0].data : null;
    },
    async update(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query("insert into progress (id, data) values ('main', '{}'::jsonb) on conflict (id) do nothing");
        const r = await client.query("select data from progress where id = 'main' for update");
        const cur = r.rows[0] && r.rows[0].data && Object.keys(r.rows[0].data).length ? r.rows[0].data : null;
        const next = fn(cur);
        await client.query("update progress set data = $1::jsonb, updated_at = now() where id = 'main'", [JSON.stringify(next)]);
        await client.query('commit');
        return next;
      } catch (e) {
        try { await client.query('rollback'); } catch (_) { /* ignore */ }
        throw e;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

async function createStorage(opts = {}) {
  const url = opts.databaseUrl !== undefined ? opts.databaseUrl : process.env.DATABASE_URL;
  if (url) return createPg(url);
  return createFile(opts.dataDir || process.env.DATA_DIR || path.join(__dirname, 'data'));
}

module.exports = { createStorage };
