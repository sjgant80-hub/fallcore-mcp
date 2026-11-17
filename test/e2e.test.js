'use strict';
// e2e.test.js — the real server over stdio (bin/cli.js), against a fake FallCore on a local port: it starts, lists its
// eight tools, answers chat and models, and turns a 404 into an error result with the reason.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');

function fakeFallCore() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => {
        if (req.method === 'POST' && req.url === '/v1/messages') {
          const b = JSON.parse(body);
          res.writeHead(200, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ model: b.model, content: [{ type: 'text', text: 'echo: ' + b.messages[0].content }], fallcore: { tier: 'local', ms: 5 } }));
        }
        if (req.url === '/v1/models') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"data":[{"id":"local-7b"}]}'); }
        res.writeHead(404); res.end('404 page not found');
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

function mcp(endpoint, onErr) {
  const p = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'cli.js')], { env: { ...process.env, FALLCORE_ENDPOINT: endpoint, FALLCORE_MODEL: 'local-7b', ANTHROPIC_API_KEY: '' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '', err = '';
  p.stderr.on('data', (d) => { err += d; });
  const waiting = new Map();
  p.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      try { const m = JSON.parse(line); if (waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } } catch (_) { /* not ours */ }
    }
  });
  let id = 0;
  const ask = (method, params) => new Promise((resolve) => { const n = ++id; waiting.set(n, resolve); p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n'); });
  const note = (method) => p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n');
  return { ask, note, close: () => p.kill(), stderr: () => err };
}

test('over stdio: initialize, the eight tools, chat and models answered, a 404 explained', async () => {
  const srv = await fakeFallCore();
  const c = mcp('http://127.0.0.1:' + srv.address().port);
  try {
    const init = await c.ask('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    assert.equal(init.result.serverInfo.name, 'fallcore-mcp');
    assert.equal(init.result.serverInfo.version, require('../package.json').version);
    c.note('notifications/initialized');
    const list = await c.ask('tools/list', {});
    assert.deepEqual(list.result.tools.map((t) => t.name), ['chat', 'health', 'stats', 'models', 'recent_logs', 'forge_stack', 'factory_tiers', 'factory_verticals']);
    const chat = await c.ask('tools/call', { name: 'chat', arguments: { prompt: 'hello' } });
    const said = JSON.parse(chat.result.content[0].text);
    assert.equal(said.text, 'echo: hello'); assert.equal(said.tier, 'local'); assert.equal(said.model, 'local-7b');
    assert.equal(chat.result.isError, undefined);
    const models = await c.ask('tools/call', { name: 'models', arguments: {} });
    assert.deepEqual(JSON.parse(models.result.content[0].text), { data: [{ id: 'local-7b' }] });
    const health = await c.ask('tools/call', { name: 'health', arguments: {} });
    assert.equal(health.result.isError, true);
    const why = JSON.parse(health.result.content[0].text);
    assert.match(why.error, /^HTTP 404 from http:\/\/127\.0\.0\.1:\d+\/health/);
    assert.match(why.hint, /needs the FallCore proxy/); assert.equal(why.tool, 'health');
    const none = await c.ask('tools/call', { name: 'chat', arguments: {} });
    assert.equal(none.result.isError, true); assert.equal(JSON.parse(none.result.content[0].text).error, 'chat needs a prompt');
  } finally { c.close(); srv.close(); }
});

test('a user and password in the endpoint are never shown: not in an error result, not on stderr', async () => {
  const srv = await fakeFallCore();
  const c = mcp('http://kar:s3cret@127.0.0.1:' + srv.address().port);
  try {
    await c.ask('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    c.note('notifications/initialized');
    const health = await c.ask('tools/call', { name: 'health', arguments: {} });
    const text = health.result.content[0].text;
    assert.equal(health.result.isError, true);
    assert.doesNotMatch(text, /s3cret|kar:/);
    assert.match(JSON.parse(text).endpoint, /^http:\/\/127\.0\.0\.1:\d+$/);
    // Node's fetch refuses a URL with credentials in it at all; the error says so, without the password
    assert.match(JSON.parse(text).error, /includes credentials: http:\/\/127\.0\.0\.1:\d+\/health/);
    assert.doesNotMatch(c.stderr(), /s3cret/);
    assert.match(c.stderr(), /endpoint http:\/\/127\.0\.0\.1:\d+/);
  } finally { c.close(); srv.close(); }
});
