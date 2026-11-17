#!/usr/bin/env node
'use strict';
// tools/trace.js — one real run for the live page: the real server (bin/cli.js) over stdio, against a real endpoint
// (default: plain Ollama on this machine). It records each MCP message out and in, with timings, in
// receipts/traced-run.json. Run by hand; the page only reads the record.
//   FALLCORE_ENDPOINT=http://localhost:11434 FALLCORE_MODEL=llama3.2:1b node tools/trace.js
const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const path = require('node:path');

const endpoint = process.env.FALLCORE_ENDPOINT || 'http://localhost:11434', model = process.env.FALLCORE_MODEL || 'llama3.2:1b';
const p = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'cli.js')], { env: { ...process.env, FALLCORE_ENDPOINT: endpoint, FALLCORE_MODEL: model, ANTHROPIC_API_KEY: '' }, stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '', id = 0, stderr = '';
const waiting = new Map(), steps = [];
p.stderr.on('data', (d) => { stderr += d; });
p.stdout.on('data', (d) => {
  buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(line); if (waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } } catch (_) { /* not ours */ } }
});
const ask = (method, params) => new Promise((resolve) => { const n = ++id, t0 = Date.now(); waiting.set(n, (m) => { steps.push({ sent: { method, params }, got: m.result !== undefined ? m.result : { error: m.error }, ms: Date.now() - t0 }); resolve(m); }); p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n'); });

(async () => {
  await ask('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'trace', version: '0' } });
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  await ask('tools/list', {});
  await ask('tools/call', { name: 'models', arguments: {} });
  await ask('tools/call', { name: 'chat', arguments: { prompt: 'In one sentence: why would a company run its AI model on its own machine?', max_tokens: 80 } });
  await ask('tools/call', { name: 'health', arguments: {} });
  p.kill();
  // the model list names this machine's own models: keep only the count
  for (const s of steps) if (s.sent.params && s.sent.params.name === 'models' && s.got.content) {
    try { const j = JSON.parse(s.got.content[0].text); if (Array.isArray(j.data)) s.got.content[0].text = JSON.stringify({ count: j.data.length, ids: 'withheld: the names are this machine\'s own models' }); } catch (_) { /* leave it */ }
  }
  const out = { kind: 'fallcore-mcp-traced-run', ran: new Date().toISOString(), endpoint: endpoint.replace(/^(https?:\/\/)[^/]*@/, '$1'), endpointKind: /11434/.test(endpoint) ? 'plain Ollama on the machine that ran it' : 'as configured', model, server: stderr.trim(), steps };
  writeFileSync(path.join(__dirname, '..', 'receipts', 'traced-run.json'), JSON.stringify(out, null, 1) + '\n');
  for (const s of steps) console.log((s.sent.params && s.sent.params.name) || s.sent.method, s.ms + ' ms', s.got.isError ? 'error result' : 'ok');
})();
