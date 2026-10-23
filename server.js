'use strict';
// Dependency-free HTTP server (Node built-ins only; "pg" is loaded only when DATABASE_URL is set).
// Static files are public. Everything under /api except /api/health needs the APP_TOKEN bearer token.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const SRS = require('./public/srs.js');
const { createStorage } = require('./storage');

const PUBLIC_DIR = path.join(__dirname, 'public');
const BANK_PATH = path.join(__dirname, 'content', 'bank.json');
const MAX_BODY = 2 * 1024 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

function sha(s) {
  return crypto.createHash('sha256').update(String(s)).digest();
}

function createApp({ storage, token, production, bankPath }) {
  const bankJson = fs.readFileSync(bankPath || BANK_PATH, 'utf8');
  const tokenHash = token ? sha(token) : null;
  const failures = new Map(); // ip -> { n, reset }, in memory only, never persisted

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [ip, f] of failures) if (f.reset < now) failures.delete(ip);
  }, 60000);
  sweep.unref();

  function clientIp(req) {
    const xf = req.headers['x-forwarded-for'];
    return (xf ? String(xf).split(',')[0].trim() : req.socket.remoteAddress) || 'unknown';
  }

  function send(res, status, body, headers) {
    const h = Object.assign(
      {
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': CSP,
        'X-Robots-Tag': 'noindex, nofollow',
      },
      headers
    );
    res.writeHead(status, h);
    res.end(body);
  }

  function sendJson(res, status, obj) {
    send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  }

  // returns true if the request may proceed
  function authorise(req, res) {
    if (!tokenHash) {
      if (production) {
        sendJson(res, 503, { error: 'APP_TOKEN is not set on the server' });
        return false;
      }
      return true;
    }
    const ip = clientIp(req);
    const f = failures.get(ip);
    if (f && f.reset > Date.now() && f.n >= 30) {
      sendJson(res, 429, { error: 'Too many failed attempts' });
      return false;
    }
    const m = /^Bearer (.+)$/.exec(req.headers['authorization'] || '');
    if (m && crypto.timingSafeEqual(sha(m[1]), tokenHash)) return true;
    const cur = f && f.reset > Date.now() ? f : { n: 0, reset: Date.now() + 10 * 60000 };
    cur.n += 1;
    failures.set(ip, cur);
    sendJson(res, 401, { error: 'Unauthorised' });
    return false;
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) {
          reject(Object.assign(new Error('Body too large'), { status: 413 }));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    let rel;
    try {
      rel = decodeURIComponent(pathname);
    } catch (_) {
      return send(res, 400, 'Bad request');
    }
    if (rel === '/') rel = '/index.html';
    const full = path.normalize(path.join(PUBLIC_DIR, rel));
    if (full !== PUBLIC_DIR && !full.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
    fs.stat(full, (err, st) => {
      if (err || !st.isFile()) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
      const type = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
      const headers = { 'Content-Type': type, 'Cache-Control': 'no-cache', 'Content-Length': st.size };
      if (req.method === 'HEAD') return send(res, 200, undefined, headers);
      res.writeHead(200, Object.assign({
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': CSP,
        'X-Robots-Tag': 'noindex, nofollow',
      }, headers));
      fs.createReadStream(full).pipe(res);
    });
  }

  async function handleApi(req, res, pathname) {
    if (pathname === '/api/health') return sendJson(res, 200, { ok: true });
    if (!authorise(req, res)) return;
    if (pathname === '/api/questions' && req.method === 'GET') {
      return send(res, 200, bankJson, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    }
    if (pathname === '/api/progress' && req.method === 'GET') {
      const cur = await storage.get();
      return sendJson(res, 200, { progress: SRS.normalize(cur), storage: storage.kind });
    }
    if (pathname === '/api/progress' && req.method === 'PUT') {
      let incoming;
      try {
        incoming = JSON.parse(await readBody(req));
      } catch (e) {
        if (e.status) return sendJson(res, e.status, { error: e.message });
        return sendJson(res, 400, { error: 'Invalid JSON' });
      }
      if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming) || typeof incoming.items !== 'object') {
        return sendJson(res, 400, { error: 'Expected a progress object with an items map' });
      }
      const merged = await storage.update((cur) => SRS.merge(cur, incoming));
      return sendJson(res, 200, { progress: merged, storage: storage.kind });
    }
    return sendJson(res, 404, { error: 'Not found' });
  }

  const server = http.createServer((req, res) => {
    const pathname = (req.url || '/').split('?')[0];
    const run = pathname.startsWith('/api/') ? handleApi(req, res, pathname) : Promise.resolve(serveStatic(req, res, pathname));
    run.catch((e) => {
      console.error('Request failed:', e && e.stack ? e.stack : e);
      if (!res.headersSent) sendJson(res, 500, { error: 'Server error' });
      else res.end();
    });
  });
  server.on('close', () => clearInterval(sweep));
  return server;
}

async function main() {
  const production = process.env.NODE_ENV === 'production';
  const token = process.env.APP_TOKEN || '';
  if (production && !token) console.error('WARNING: APP_TOKEN is not set. All API calls will return 503 until it is.');
  if (!production && !token) console.warn('APP_TOKEN is not set: API is open (development only).');
  const storage = await createStorage();
  const server = createApp({ storage, token, production });
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, '0.0.0.0', () => console.log('Listening on port ' + port + ' (storage: ' + storage.kind + ')'));
  const stop = () => {
    server.close(() => storage.close().then(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { createApp };
