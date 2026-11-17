// fallcore-mcp · src/core.js — the tools and what each one does, with no network of its own.
// server.js wires these to the MCP SDK and to real fetch; the tests wire them to a fake one. Pure apart from the
// injected `http` and `fetch`; a bad argument becomes an error result, never a crash.
//
//   TOOLS                       the eight tools as MCP lists them (name, description, input schema)
//   config(env)                 the settings read from the environment, with their defaults
//   chatBody(args, cfg)         the Anthropic-style request body the chat tool sends
//   chatResult(r)               the chat tool's answer, read from the reply (text, the tier that answered, cost)
//   forgeBody(args)             the factory request body for forge_stack
//   forgeResult(headers, size, args, cfg)   forge_stack's answer: the forge's metadata, never the ZIP itself
//   needsProxy(name)            true for the tools that only the FallCore proxy serves (not plain Ollama)
//   call(name, args, deps)      run one tool: { result } or { error }; deps = { http, fetch, cfg }

'use strict';

const DEFAULT_ENDPOINT = 'http://localhost:11434';
const DEFAULT_FACTORY = 'https://fallcore-factory.onrender.com';
const DEFAULT_MODEL = 'claude-sonnet-5-5';
const FORGE_TIMEOUT_MS = 90000;   // the factory runs on a free tier that sleeps: the first call can take about a minute
const VERTICALS = Object.freeze(['legal', 'procurement', 'healthcare', 'finance', 'fitness', 'education', 'manufacturing', 'realestate', 'hospitality', 'agency', 'ngo', 'other']);
const TIERS = Object.freeze(['lite', 'pro', 'sovereign', 'enterprise']);
const PROXY_ONLY = Object.freeze(['health', 'stats', 'recent_logs']);

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const str = (x) => (typeof x === 'string' ? x : '');
const num = (x) => (Number.isFinite(x) ? x : undefined);   // false for anything not a number, NaN and Infinity included

const TOOLS = Object.freeze([
  { name: 'chat', description: 'Send a message to the FallCore proxy (Anthropic-API-compatible), which answers on the local model first and falls through to a frontier model only when it must. Returns the text, the tier that answered and, from the proxy, its cost. Plain Ollama answers this too.',
    inputSchema: { type: 'object', properties: {
      prompt: { type: 'string', description: 'The user message' },
      system: { type: 'string', description: 'Optional system prompt' },
      model: { type: 'string', description: 'Model id. Default: FALLCORE_MODEL, else ' + DEFAULT_MODEL + ' (the FallCore proxy answers locally first whatever is named; plain Ollama needs one of its own models)' },
      max_tokens: { type: 'number', description: 'Default 2048' },
      force_frontier: { type: 'boolean', description: 'Ask the proxy to skip the local model' } }, required: ['prompt'] } },
  { name: 'health', description: 'Status of the FallCore proxy and its local model backend. Needs the FallCore proxy (plain Ollama has no /health).', inputSchema: { type: 'object', properties: {} } },
  { name: 'stats', description: 'The proxy\'s own counts: local against frontier calls, tokens, cost, by tool and by model. Needs the FallCore proxy.', inputSchema: { type: 'object', properties: {} } },
  { name: 'models', description: 'The models this deployment offers (the proxy\'s list, or Ollama\'s own).', inputSchema: { type: 'object', properties: {} } },
  { name: 'recent_logs', description: 'The last 50 prompt and response pairs the proxy logged (needs the admin key, FALLCORE_ADMIN_KEY). Needs the FallCore proxy.', inputSchema: { type: 'object', properties: {} } },
  { name: 'forge_stack', description: 'Ask the FallCore Factory to build a branded FallCore deployment for a company. Returns the forge\'s metadata (id, size); the ZIP itself comes from the factory\'s own page.',
    inputSchema: { type: 'object', properties: {
      company: { type: 'string', description: 'Company name' },
      vertical: { type: 'string', description: VERTICALS.join(' | ') },
      tier: { type: 'string', description: TIERS.join(' | ') },
      frontier_spend_gbp: { type: 'number', description: 'What they spend on frontier AI APIs a year, in pounds (the factory uses it in its own projection)' },
      brand_primary: { type: 'string', description: 'Hex colour, e.g. #5078DC' } }, required: ['company'] } },
  { name: 'factory_tiers', description: 'The FallCore Factory\'s tiers and their hardware.', inputSchema: { type: 'object', properties: {} } },
  { name: 'factory_verticals', description: 'The FallCore Factory\'s industry presets.', inputSchema: { type: 'object', properties: {} } },
]);

/** config(env) → the settings, defaults applied; a trailing slash is dropped from the URLs */
function config(env) {
  const e = isObj(env) ? env : {};
  return {
    endpoint: (str(e.FALLCORE_ENDPOINT) || DEFAULT_ENDPOINT).replace(/\/+$/, ''),
    factory: (str(e.FALLCORE_FACTORY) || DEFAULT_FACTORY).replace(/\/+$/, ''),
    adminKey: str(e.FALLCORE_ADMIN_KEY),
    anthropicKey: str(e.ANTHROPIC_API_KEY),
    model: str(e.FALLCORE_MODEL) || DEFAULT_MODEL,
  };
}

/** chatBody(args, cfg) → the request body; the prompt is always a string, max_tokens a positive whole number */
function chatBody(args, cfg) {
  const a = isObj(args) ? args : {}, c = isObj(cfg) ? cfg : config({});
  const mt = num(a.max_tokens);
  const body = { model: str(a.model) || c.model, max_tokens: mt !== undefined && mt >= 1 ? Math.floor(mt) : 2048, messages: [{ role: 'user', content: String(a.prompt === undefined || a.prompt === null ? '' : a.prompt) }] };
  if (str(a.system)) body.system = a.system;
  if (a.force_frontier === true) body.fallcore_options = { force_frontier: true };
  return body;
}

/** chatResult(r) → the text of the first text block, the tier that answered and the proxy's cost fields */
function chatResult(r) {
  const x = isObj(r) ? r : {}, fc = isObj(x.fallcore) ? x.fallcore : {};
  const blocks = Array.isArray(x.content) ? x.content : [];
  const first = blocks.find((b) => isObj(b) && b.type === 'text' && typeof b.text === 'string');
  return { text: first ? first.text : '', tier: str(fc.tier) || 'unknown', model: str(x.model) || null, confidence: num(fc.confidence) ?? null,
    ms: num(fc.ms) ?? null, saved_usd: num(fc.saved_usd) ?? null, cost_usd: num(fc.cost_usd) ?? null, usage: isObj(x.usage) ? x.usage : null };
}

/** forgeBody(args) → the factory body; an unknown vertical or tier falls back to 'other' / 'pro' */
function forgeBody(args) {
  const a = isObj(args) ? args : {};
  return { company: str(a.company), vertical: VERTICALS.includes(a.vertical) ? a.vertical : 'other', tier: TIERS.includes(a.tier) ? a.tier : 'pro',
    frontier_spend_gbp: Math.max(0, num(a.frontier_spend_gbp) || 0),
    brand_primary: /^#[0-9a-f]{6}$/i.test(str(a.brand_primary)) ? a.brand_primary : '#22c55e' };
}

/** forgeResult(get, size, body, cfg) → forge_stack's answer; `get` reads a response header */
function forgeResult(get, size, body, cfg) {
  const h = typeof get === 'function' ? get : () => null, c = isObj(cfg) ? cfg : config({}), b = isObj(body) ? body : forgeBody({});
  const prime = parseInt(String(h('x-fallcore-prime')), 10);
  return { forged: true, forge_id: h('x-fallcore-forge-id') || null, prime: Number.isFinite(prime) ? prime : null, company: b.company, tier: b.tier, vertical: b.vertical,
    zip_size_bytes: num(size) ?? null, get_the_zip: 'https://sjgant80-hub.github.io/fallcore-factory/ (the factory\'s wizard; this tool returns the forge\'s metadata only)', factory: c.factory };
}

const needsProxy = (name) => PROXY_ONLY.includes(name);

/** call(name, args, { http, fetch, cfg }) → { result } or { error, hint? }: one tool, run */
async function call(name, args, deps) {
  const d = isObj(deps) ? deps : {}, cfg = isObj(d.cfg) ? d.cfg : config({}), a = isObj(args) ? args : {};
  const http = d.http;
  try {
    if (typeof http !== 'function') throw new Error('no http client');
    switch (name) {
      case 'chat': {
        if (str(a.prompt) === '') return { error: 'chat needs a prompt' };
        const headers = { 'anthropic-version': '2023-06-01', 'x-fallcore-tool': 'fallcore-mcp' };
        if (cfg.anthropicKey) headers['x-api-key'] = cfg.anthropicKey;
        return { result: chatResult(await http('POST', cfg.endpoint + '/v1/messages', { body: chatBody(a, cfg), headers })) };
      }
      case 'health': return { result: await http('GET', cfg.endpoint + '/health') };
      case 'stats': return { result: await http('GET', cfg.endpoint + '/v1/stats') };
      case 'models': return { result: await http('GET', cfg.endpoint + '/v1/models') };
      case 'recent_logs': return { result: await http('GET', cfg.endpoint + '/v1/log', { headers: cfg.adminKey ? { Authorization: 'Bearer ' + cfg.adminKey } : {} }) };
      case 'factory_tiers': return { result: await http('GET', cfg.factory + '/v1/tiers', { timeout: FORGE_TIMEOUT_MS }) };
      case 'factory_verticals': return { result: await http('GET', cfg.factory + '/v1/verticals', { timeout: FORGE_TIMEOUT_MS }) };
      case 'forge_stack': {
        const body = forgeBody(a);
        if (body.company === '') return { error: 'forge_stack needs a company name' };
        if (typeof d.fetch !== 'function') throw new Error('no fetch');
        const r = await d.fetch(cfg.factory + '/v1/forge/fallcore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(FORGE_TIMEOUT_MS) });
        if (!r || !r.ok) throw new Error('the factory answered ' + (r ? r.status : 'nothing'));
        const blob = await r.blob();
        return { result: forgeResult((k) => r.headers.get(k), blob.size, body, cfg) };
      }
      default: return { error: 'unknown tool: ' + String(name) };
    }
  } catch (e) {
    const out = { error: String(e && e.message ? e.message : e) };
    if (needsProxy(name) && /HTTP 404/.test(out.error)) out.hint = name + ' needs the FallCore proxy at FALLCORE_ENDPOINT; plain Ollama does not serve it (chat and models work against Ollama directly)';
    return out;
  }
}

/** the real http client: JSON in and out, a readable error on a non-2xx answer */
function makeHttp(fetchImpl) {
  return async function http(method, url, opts) {
    const o = isObj(opts) ? opts : {};
    const headers = Object.assign({}, isObj(o.headers) ? o.headers : {});
    if (o.body !== undefined) headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    const r = await fetchImpl(url, { method, headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined, signal: AbortSignal.timeout(o.timeout || 60000) });
    const text = await r.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch (_) { parsed = text; }
    if (!r.ok) throw new Error('HTTP ' + r.status + ' from ' + url + ': ' + (typeof parsed === 'string' ? parsed : JSON.stringify(parsed)).slice(0, 400));
    return parsed;
  };
}

module.exports = { TOOLS, VERTICALS, TIERS, DEFAULT_ENDPOINT, DEFAULT_FACTORY, DEFAULT_MODEL, FORGE_TIMEOUT_MS, config, chatBody, chatResult, forgeBody, forgeResult, needsProxy, call, makeHttp };
