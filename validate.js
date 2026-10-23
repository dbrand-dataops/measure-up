'use strict';
// Validates content/bank.json: required fields per item type, unique ids, MCQ answers present in options.
const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, 'content', 'bank.json');
const bank = JSON.parse(fs.readFileSync(file, 'utf8'));
const errors = [];
const seen = new Set();

const TYPES = {
  flashcard: ['front', 'back'],
  mcq: ['prompt', 'options', 'answer'],
  predict: ['prompt', 'data', 'code', 'output', 'explanation'],
  bug: ['symptom', 'code', 'diagnosis', 'fix'],
  explain: ['prompt', 'keyPoints'],
  pattern: ['name', 'scenario', 'code'],
};
const LEVELS = ['junior', 'mid', 'senior'];

function isTable(t) {
  return t && Array.isArray(t.columns) && Array.isArray(t.rows) && t.rows.every((r) => Array.isArray(r));
}

for (const it of bank.items) {
  const where = it.id || '(no id)';
  const err = (m) => errors.push(where + ': ' + m);
  if (!it.id || typeof it.id !== 'string') err('missing id');
  if (seen.has(it.id)) err('duplicate id');
  seen.add(it.id);
  if (!TYPES[it.type]) { err('unknown type ' + it.type); continue; }
  for (const f of ['language', 'topic', 'level']) if (!it[f]) err('missing ' + f);
  if (it.level && !LEVELS.includes(it.level)) err('bad level ' + it.level);
  for (const f of TYPES[it.type]) if (it[f] == null || it[f] === '') err('missing ' + f);
  if (it.tags != null && !Array.isArray(it.tags)) err('tags must be a list');
  if (it.type === 'mcq' && Array.isArray(it.options)) {
    const ids = it.options.map((o) => o.id);
    if (new Set(ids).size !== ids.length) err('duplicate option ids');
    if (!ids.includes(it.answer)) err('answer ' + it.answer + ' is not an option id');
    if (it.options.length < 2) err('fewer than two options');
    for (const o of it.options) if (o.text == null || o.text === '' || !o.why) err('option ' + o.id + ' needs text and why');
  }
  if (it.type === 'predict') {
    if (it.data && typeof it.data === 'object') {
      for (const [name, t] of Object.entries(it.data)) if (!isTable(t)) err('data table ' + name + ' is malformed');
    }
    if (!isTable(it.output)) err('output table is malformed');
  }
  if (it.type === 'explain' && Array.isArray(it.keyPoints) && it.keyPoints.length === 0) err('no key points');
}

const counts = {};
for (const it of bank.items) {
  const k = it.type;
  counts[k] = (counts[k] || 0) + 1;
}
console.log('Items: ' + bank.items.length + '  ' + JSON.stringify(counts));
const byLang = {};
for (const it of bank.items) byLang[it.language] = (byLang[it.language] || 0) + 1;
console.log('Languages: ' + JSON.stringify(byLang));

if (errors.length) {
  console.error('\n' + errors.length + ' problem(s):');
  for (const e of errors) console.error(' - ' + e);
  process.exit(1);
}
console.log('Validation passed.');
