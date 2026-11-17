'use strict';
// core.test.js — every tool against a fake http client: the URL it calls, what it sends, what it answers.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core.js');

const cfg = C.config({ FALLCORE_ENDPOINT: 'http://proxy.test:8080/', FALLCORE_FACTORY: 'https://factory.test/', FALLCORE_ADMIN_KEY: 'adm', ANTHROPIC_API_KEY: 'ak', FALLCORE_MODEL: 'local-7b' });
const fake = (reply) => { const calls = []; const http = async (method, url, opts) => { calls.push({ method, url, opts }); if (reply instanceof Error) throw reply; return typeof reply === 'function' ? reply(method, url, opts) : reply; }; return { http, calls }; };

test('the eight tools, by name, each with an object input schema', () => {
  assert.deepEqual(C.TOOLS.map((t) => t.name), ['chat', 'health', 'stats', 'models', 'recent_logs', 'forge_stack', 'factory_tiers', 'factory_verticals']);
  for (const t of C.TOOLS) { assert.equal(t.inputSchema.type, 'object'); assert.ok(t.description.length > 20); }
  assert.deepEqual(C.TOOLS[0].inputSchema.required, ['prompt']);
  assert.deepEqual(C.TOOLS[5].inputSchema.required, ['company']);
  assert.ok(Object.isFrozen(C.TOOLS));
});

test('config: defaults, and trailing slashes dropped', () => {
  assert.deepEqual(C.config({}), { endpoint: 'http://localhost:11434', factory: 'https://fallcore-factory.onrender.com', adminKey: '', anthropicKey: '', model: 'claude-sonnet-5-5' });
  assert.deepEqual(C.config(null), C.config({}));
  assert.equal(C.config({ FALLCORE_ENDPOINT: 'http://a//' }).endpoint, 'http://a');
  assert.deepEqual(cfg, { endpoint: 'http://proxy.test:8080', factory: 'https://factory.test', adminKey: 'adm', anthropicKey: 'ak', model: 'local-7b' });
  assert.equal(C.config({ FALLCORE_ENDPOINT: 5 }).endpoint, 'http://localhost:11434');
  assert.equal(C.FORGE_TIMEOUT_MS, 90000);
});

test('chatBody: the prompt as a string, the configured model, max_tokens a positive whole number, options only when asked', () => {
  assert.deepEqual(C.chatBody({ prompt: 'hi' }, cfg), { model: 'local-7b', max_tokens: 2048, messages: [{ role: 'user', content: 'hi' }] });
  assert.deepEqual(C.chatBody({ prompt: 7, model: 'm', max_tokens: 99.7, system: 'be brief', force_frontier: true }, cfg),
    { model: 'm', max_tokens: 99, messages: [{ role: 'user', content: '7' }], system: 'be brief', fallcore_options: { force_frontier: true } });
  assert.equal(C.chatBody({ prompt: 'x', max_tokens: 0 }, cfg).max_tokens, 2048);
  assert.equal(C.chatBody({ prompt: 'x', max_tokens: 1 }, cfg).max_tokens, 1);
  assert.equal(C.chatBody({ prompt: 'x', max_tokens: -5 }, cfg).max_tokens, 2048);
  assert.equal(C.chatBody({ prompt: 'x', max_tokens: '50' }, cfg).max_tokens, 2048);
  assert.equal(C.chatBody({ prompt: 'x', force_frontier: 'yes' }, cfg).fallcore_options, undefined);
  assert.equal(C.chatBody({ prompt: 'x', system: '' }, cfg).system, undefined);
  assert.equal(C.chatBody({ prompt: null }, cfg).messages[0].content, '');
  assert.equal(C.chatBody({}, null).model, 'claude-sonnet-5-5');
  assert.equal(C.chatBody('junk', cfg).messages[0].content, '');
});

test('chatResult: the first text block, the tier, the proxy\'s numbers; nothing invented when they are missing', () => {
  const r = C.chatResult({ model: 'qwen', content: [{ type: 'tool_use' }, { type: 'text', text: 'hello' }, { type: 'text', text: 'second' }], usage: { input_tokens: 3 }, fallcore: { tier: 'local', confidence: 0.9, ms: 120, saved_usd: 0.01, cost_usd: 0 } });
  assert.deepEqual(r, { text: 'hello', tier: 'local', model: 'qwen', confidence: 0.9, ms: 120, saved_usd: 0.01, cost_usd: 0, usage: { input_tokens: 3 } });
  assert.deepEqual(C.chatResult({}), { text: '', tier: 'unknown', model: null, confidence: null, ms: null, saved_usd: null, cost_usd: null, usage: null });
  assert.deepEqual(C.chatResult(null), C.chatResult({}));
  assert.equal(C.chatResult({ content: [{ type: 'text', text: 5 }], fallcore: { tier: 3, ms: 'fast' } }).text, '');
  assert.equal(C.chatResult({ fallcore: { tier: 3, ms: 'fast' } }).ms, null);
  assert.equal(C.chatResult({ fallcore: 'x', usage: [1] }).usage, null);
  assert.equal(C.chatResult({ fallcore: { ms: NaN, cost_usd: Infinity, saved_usd: '1' } }).ms, null, 'NaN is not a number here');
  assert.equal(C.chatResult({ fallcore: { cost_usd: Infinity } }).cost_usd, null);
  assert.equal(C.chatBody({ prompt: 'x', max_tokens: NaN }, cfg).max_tokens, 2048);
});

test('forgeBody: known verticals and tiers kept, anything else falls back; spend and colour checked', () => {
  assert.deepEqual(C.forgeBody({ company: 'Acme', vertical: 'legal', tier: 'sovereign', frontier_spend_gbp: 12000, brand_primary: '#5078DC' }),
    { company: 'Acme', vertical: 'legal', tier: 'sovereign', frontier_spend_gbp: 12000, brand_primary: '#5078DC' });
  assert.deepEqual(C.forgeBody({ company: 'Acme', vertical: 'space', tier: 'mega', frontier_spend_gbp: -1, brand_primary: 'red' }),
    { company: 'Acme', vertical: 'other', tier: 'pro', frontier_spend_gbp: 0, brand_primary: '#22c55e' });
  assert.equal(C.forgeBody({ frontier_spend_gbp: 0 }).frontier_spend_gbp, 0);
  assert.equal(C.forgeBody({ frontier_spend_gbp: NaN }).frontier_spend_gbp, 0);
  assert.equal(C.forgeBody({ frontier_spend_gbp: '900' }).frontier_spend_gbp, 0);
  assert.equal(C.forgeBody({ frontier_spend_gbp: 0.5 }).frontier_spend_gbp, 0.5);
  assert.equal(C.forgeBody({ brand_primary: '#12345' }).brand_primary, '#22c55e');
  assert.equal(C.forgeBody({ brand_primary: '#1234567' }).brand_primary, '#22c55e');
  assert.equal(C.forgeBody(null).company, '');
  assert.deepEqual([...C.VERTICALS].length, 12); assert.deepEqual([...C.TIERS], ['lite', 'pro', 'sovereign', 'enterprise']);
});

test('forgeResult: the forge\'s headers read, the prime a whole number or null, the ZIP pointed to, not carried', () => {
  const h = { 'x-fallcore-forge-id': 'f-1', 'x-fallcore-prime': '97' };
  const body = C.forgeBody({ company: 'Acme', tier: 'lite', vertical: 'ngo' });
  assert.deepEqual(C.forgeResult((k) => h[k] || null, 2048, body, cfg), { forged: true, forge_id: 'f-1', prime: 97, company: 'Acme', tier: 'lite', vertical: 'ngo', zip_size_bytes: 2048,
    get_the_zip: 'https://sjgant80-hub.github.io/fallcore-factory/ (the factory\'s wizard; this tool returns the forge\'s metadata only)', factory: 'https://factory.test' });
  const none = C.forgeResult(null, 'big', body, null);
  assert.equal(none.forge_id, null); assert.equal(none.prime, null); assert.equal(none.zip_size_bytes, null); assert.equal(none.factory, 'https://fallcore-factory.onrender.com');
  assert.equal(C.forgeResult(() => 'abc', 1, body, cfg).prime, null);
  const bare = C.forgeResult();
  assert.equal(bare.company, ''); assert.equal(bare.tier, 'pro'); assert.equal(bare.vertical, 'other'); assert.equal(bare.forged, true);
});

test('chat: POSTs the body to /v1/messages with the version header, the tool tag and the key; reads the answer', async () => {
  const f = fake({ content: [{ type: 'text', text: 'ok' }], fallcore: { tier: 'local' } });
  const out = await C.call('chat', { prompt: 'hi' }, { http: f.http, cfg });
  assert.deepEqual(out.result.text, 'ok'); assert.equal(out.result.tier, 'local');
  assert.deepEqual(f.calls, [{ method: 'POST', url: 'http://proxy.test:8080/v1/messages', opts: { body: C.chatBody({ prompt: 'hi' }, cfg), headers: { 'anthropic-version': '2023-06-01', 'x-fallcore-tool': 'fallcore-mcp', 'x-api-key': 'ak' } } }]);
  const nokey = fake({}); await C.call('chat', { prompt: 'hi' }, { http: nokey.http, cfg: C.config({}) });
  assert.equal(nokey.calls[0].opts.headers['x-api-key'], undefined, 'no key, no header');
  assert.deepEqual(await C.call('chat', { prompt: '' }, { http: f.http, cfg }), { error: 'chat needs a prompt' });
  assert.deepEqual(await C.call('chat', {}, { http: f.http, cfg }), { error: 'chat needs a prompt' });
  assert.equal(f.calls.length, 1, 'no call made without a prompt');
});

test('health, stats, models, recent_logs: the right GET on the endpoint; the admin key only where it is needed', async () => {
  for (const [name, path] of [['health', '/health'], ['stats', '/v1/stats'], ['models', '/v1/models']]) {
    const f = fake({ ok: name });
    assert.deepEqual(await C.call(name, {}, { http: f.http, cfg }), { result: { ok: name } });
    assert.deepEqual(f.calls, [{ method: 'GET', url: 'http://proxy.test:8080' + path, opts: undefined }]);
  }
  const L = fake([1]);
  assert.deepEqual(await C.call('recent_logs', {}, { http: L.http, cfg }), { result: [1] });
  assert.deepEqual(L.calls[0], { method: 'GET', url: 'http://proxy.test:8080/v1/log', opts: { headers: { Authorization: 'Bearer adm' } } });
  const L2 = fake([]); await C.call('recent_logs', {}, { http: L2.http, cfg: C.config({}) });
  assert.deepEqual(L2.calls[0].opts, { headers: {} });
});

test('the factory: tiers and verticals with the long timeout; forge_stack POSTs the checked body', async () => {
  for (const [name, path] of [['factory_tiers', '/v1/tiers'], ['factory_verticals', '/v1/verticals']]) {
    const f = fake(['x']);
    assert.deepEqual(await C.call(name, {}, { http: f.http, cfg }), { result: ['x'] });
    assert.deepEqual(f.calls, [{ method: 'GET', url: 'https://factory.test' + path, opts: { timeout: 90000 } }]);
  }
  const sent = [];
  const fetch = async (url, init) => { sent.push({ url, init }); return { ok: true, status: 200, headers: { get: (k) => ({ 'x-fallcore-forge-id': 'F9', 'x-fallcore-prime': '13' })[k] || null }, blob: async () => ({ size: 321 }) }; };
  const out = await C.call('forge_stack', { company: 'Acme', tier: 'lite' }, { http: fake({}).http, fetch, cfg });
  assert.equal(out.result.forge_id, 'F9'); assert.equal(out.result.prime, 13); assert.equal(out.result.zip_size_bytes, 321); assert.equal(out.result.tier, 'lite');
  assert.equal(sent[0].url, 'https://factory.test/v1/forge/fallcore');
  assert.equal(sent[0].init.method, 'POST'); assert.deepEqual(sent[0].init.headers, { 'Content-Type': 'application/json' });
  assert.deepEqual(JSON.parse(sent[0].init.body), C.forgeBody({ company: 'Acme', tier: 'lite' }));
  assert.ok(sent[0].init.signal instanceof AbortSignal);
  assert.deepEqual(await C.call('forge_stack', {}, { http: fake({}).http, fetch, cfg }), { error: 'forge_stack needs a company name' });
  assert.equal(sent.length, 1);
  assert.deepEqual(await C.call('forge_stack', { company: 'A' }, { http: fake({}).http, fetch: async () => ({ ok: false, status: 503 }), cfg }), { error: 'the factory answered 503' });
  assert.deepEqual(await C.call('forge_stack', { company: 'A' }, { http: fake({}).http, fetch: async () => null, cfg }), { error: 'the factory answered nothing' });
  assert.deepEqual(await C.call('forge_stack', { company: 'A' }, { http: fake({}).http, cfg }), { error: 'no fetch' });
});

test('errors are answers, never crashes: a 404 on a proxy-only tool says why; an unknown tool is named', async () => {
  const e404 = fake(new Error('HTTP 404 from http://x/health: not found'));
  const h = await C.call('health', {}, { http: e404.http, cfg });
  assert.equal(h.error, 'HTTP 404 from http://x/health: not found');
  assert.match(h.hint, /^health needs the FallCore proxy at FALLCORE_ENDPOINT; plain Ollama does not serve it/);
  const m = await C.call('models', {}, { http: e404.http, cfg });
  assert.equal(m.hint, undefined, 'models works on plain Ollama: no proxy hint');
  const e500 = await C.call('stats', {}, { http: fake(new Error('HTTP 500 from x')).http, cfg });
  assert.equal(e500.hint, undefined, 'only a 404 means "not served here"');
  assert.deepEqual(await C.call('nope', {}, { http: e404.http, cfg }), { error: 'unknown tool: nope' });
  assert.deepEqual(await C.call('health', {}, {}), { error: 'no http client' });
  assert.deepEqual(await C.call('health', {}, null), { error: 'no http client' });
  assert.deepEqual(await C.call('health', 'x', { http: fake(new Error('down')).http }), { error: 'down' });
  assert.deepEqual(await C.call('health', {}, { http: async () => { throw 'plain'; } }), { error: 'plain' });
  assert.deepEqual(C.needsProxy('recent_logs'), true); assert.deepEqual(C.needsProxy('chat'), false);
});

test('makeHttp: JSON both ways, text kept when it is not JSON, a readable error on a non-2xx answer', async () => {
  const seen = [];
  const http = C.makeHttp(async (url, init) => { seen.push({ url, init }); return { ok: url.endsWith('/ok') || url.endsWith('/txt'), status: url.endsWith('/bad') ? 404 : 200, text: async () => (url.endsWith('/txt') ? 'plain words' : url.endsWith('/bad') ? '{"e":1}' : '{"a":1}') }; });
  assert.deepEqual(await http('POST', 'http://h/ok', { body: { q: 1 }, headers: { x: 'y' } }), { a: 1 });
  assert.deepEqual(seen[0].init.headers, { x: 'y', 'Content-Type': 'application/json' }); assert.equal(seen[0].init.body, '{"q":1}'); assert.equal(seen[0].init.method, 'POST');
  assert.equal(await http('GET', 'http://h/txt'), 'plain words');
  assert.equal(seen[1].init.body, undefined); assert.deepEqual(seen[1].init.headers, {});
  await assert.rejects(http('GET', 'http://h/bad'), { message: 'HTTP 404 from http://h/bad: {"e":1}' });
  await http('POST', 'http://h/ok', { body: {}, headers: { 'Content-Type': 'text/plain' } });
  assert.equal(seen[3].init.headers['Content-Type'], 'text/plain', 'a caller\'s content type is kept');
  const long = C.makeHttp(async () => ({ ok: false, status: 500, text: async () => 'x'.repeat(1000) }));
  await assert.rejects(long('GET', 'u'), (e) => e.message.length === 'HTTP 500 from u: '.length + 400);
});
