'use strict';
// page.test.js — the page and the docs say what the records say: every file the page loads is here, the gate count
// quoted in README and llms.txt is the receipt's, and the recorded run carries none of the machine's private model names.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('every file the page loads is in the repository', () => {
  const page = read('index.html');
  const loads = [...page.matchAll(/json\('([^']+)'\)/g)].map((m) => m[1]);
  assert.deepEqual(loads.sort(), ['receipts/core-gate.json', 'receipts/traced-run.json']);
  for (const f of loads) assert.ok(fs.existsSync(path.join(root, f)), f);
  for (const m of page.matchAll(/href="(?!https?:|#)([^"]+)"/g)) assert.ok(fs.existsSync(path.join(root, m[1])), 'link ' + m[1]);
  for (const id of [...page.matchAll(/href="#([\w-]+)"/g)].map((m) => m[1])) assert.match(page, new RegExp('id="' + id + '"'), 'anchor #' + id);
});

test('the gate count in README and llms.txt is the receipt\'s, and the receipt is clean', () => {
  const g = JSON.parse(read('receipts/core-gate.json'));
  assert.equal(g.clean, true); assert.equal(g.capped, false); assert.equal(g.killed, g.total); assert.deepEqual(g.ignored, []);
  for (const f of ['README.md', 'llms.txt']) {
    const said = [...read(f).matchAll(/(\d+) mutants/g)].map((m) => +m[1]);
    assert.ok(said.length >= 1, f + ' quotes the gate');
    for (const n of said) assert.equal(n, g.total, f + ' says ' + n + ' mutants; the receipt has ' + g.total);
  }
});

test('the recorded run is a real run of this server, and names none of the machine\'s own models', () => {
  const r = JSON.parse(read('receipts/traced-run.json'));
  assert.equal(r.kind, 'fallcore-mcp-traced-run');
  assert.deepEqual(r.steps.map((s) => (s.sent.params && s.sent.params.name) || s.sent.method), ['initialize', 'tools/list', 'models', 'chat', 'health']);
  assert.equal(r.steps[0].got.serverInfo.name, 'fallcore-mcp');
  assert.equal(r.steps[1].got.tools.length, 8);
  assert.match(r.steps[2].got.content[0].text, /withheld/);
  assert.equal(r.steps[4].got.isError, true);
  assert.doesNotMatch(JSON.stringify(r), /rerun-|ff-|triage-|review-1b|demo-/);
});

test('the page explains itself: what it is, start here, how it works, a real run, blueprint, adoption, business, questions', () => {
  const page = read('index.html');
  for (const id of ['start', 'how', 'run', 'tools', 'blueprint', 'adopt', 'business', 'faq', 'paper']) assert.match(page, new RegExp('<h2 id="' + id + '"'), id);
  assert.doesNotMatch(page, /\bonly way\b|\bguarantee|\bbulletproof|\bnever fails\b/i, 'no overclaims');
  assert.doesNotMatch(read('llms.txt'), /Ed25519|never phones home|@ai-native-solutions\/fallcore-mcp/, 'the old false claims are gone');
});
