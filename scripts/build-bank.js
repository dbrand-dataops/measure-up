'use strict';
// Reads every content/*.yaml question bank and writes content/bank.json.
// The server only reads bank.json, so the app has no YAML dependency at runtime.
// Run after editing any YAML file:  npm run build:bank
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const dir = path.join(__dirname, '..', 'content');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort();
if (files.length === 0) {
  console.error('No YAML files found in ' + dir);
  process.exit(1);
}

function sourceName(file) {
  const base = path.basename(file, '.yaml');
  if (base === 'question-bank') return 'general';
  return base.replace(/^question-bank-/, '');
}

const items = [];
const sources = [];
for (const file of files) {
  const doc = yaml.load(fs.readFileSync(path.join(dir, file), 'utf8'));
  if (!doc || !Array.isArray(doc.items)) {
    console.error(file + ': missing top-level items list');
    process.exit(1);
  }
  const source = sourceName(file);
  sources.push({ source, file, version: doc.meta && doc.meta.version, count: doc.items.length });
  for (const item of doc.items) {
    const out = Object.assign({ source }, item);
    if (Array.isArray(out.options)) {
      // YAML parses bare values such as 0 as numbers, so force option text and ids to strings.
      out.options = out.options.map((o) => Object.assign({}, o, { id: String(o.id), text: String(o.text) }));
      out.answer = String(out.answer);
    }
    items.push(out);
  }
}

const out = { generated: new Date().toISOString(), sources, items };
fs.writeFileSync(path.join(dir, 'bank.json'), JSON.stringify(out));
console.log('Wrote content/bank.json with ' + items.length + ' items from ' + files.length + ' files.');
