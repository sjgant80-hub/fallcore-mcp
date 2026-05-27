// ═══════════════════════════════════════════════════════════════
// ◊·κ=1 · FallCore MCP server · the 5th turtle: mcp(api)
//
// Exposes any FallCore deployment as native tools in Claude Code /
// Cursor / Cline / Windsurf. Lets the AI call the on-prem brain
// directly with proper auth + audit trail.
//
// Install (Claude Code):
//   claude mcp add fallcore -s user --transport stdio -- npx -y fallcore-mcp
//
// Or from GitHub before npm publish:
//   claude mcp add fallcore -s user --transport stdio -- npx -y github:sjgant80-hub/fallcore-mcp
//
// Env vars:
//   FALLCORE_ENDPOINT  (default http://localhost:11434) — your FallCore proxy URL
//   FALLCORE_ADMIN_KEY (optional) — for /v1/log access
//   ANTHROPIC_API_KEY  (optional) — passed through on chat calls
//
// Tools exposed:
//   chat            POST /v1/messages (the actual brain call)
//   health          GET  /health
//   stats           GET  /v1/stats  (ROI dashboard data)
//   models          GET  /v1/models (local + frontier models)
//   recent_logs     GET  /v1/log (admin · last 50 calls)
//   forge_stack     POST to fallcore-factory · mint a branded stack
//   factory_tiers   GET  factory tier catalog
//   factory_verticals GET factory vertical presets
// ═══════════════════════════════════════════════════════════════

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const FALLCORE_ENDPOINT = (process.env.FALLCORE_ENDPOINT || 'http://localhost:11434').replace(/\/$/, '');
const FALLCORE_ADMIN_KEY = process.env.FALLCORE_ADMIN_KEY || '';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const FACTORY_URL = 'https://fallcore-factory.onrender.com';

async function http(method, url, opts) {
  opts = opts || {};
  const headers = Object.assign({}, opts.headers || {});
  if (opts.body) headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  const r = await fetch(url, {
    method: method,
    headers: headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(opts.timeout || 60000)
  });
  const text = await r.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch (_) { parsed = text; }
  if (!r.ok) {
    throw new Error('HTTP ' + r.status + ' from ' + url + ': ' + (typeof parsed === 'string' ? parsed.slice(0, 400) : JSON.stringify(parsed).slice(0, 400)));
  }
  return parsed;
}

const TOOLS = [
  {
    name: 'chat',
    description: 'Send a message to the FallCore proxy (Anthropic-API-compatible). Cascades local-first → frontier fallthrough. Returns text + which tier answered.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The user message' },
        system: { type: 'string', description: 'Optional system prompt' },
        model: { type: 'string', description: 'Model id (default claude-sonnet-4-20250514 — FallCore picks local first regardless)' },
        max_tokens: { type: 'number', description: 'Default 2048' },
        force_frontier: { type: 'boolean', description: 'Skip local, force frontier' }
      },
      required: ['prompt']
    }
  },
  {
    name: 'health',
    description: 'Status of the FallCore proxy + connected Ollama backend + recent stats.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'stats',
    description: 'Full ROI dashboard: local vs frontier call ratio, tokens, USD saved, by-tool/by-model breakdown.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'models',
    description: 'List models available on this FallCore deployment (local + frontier).',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'recent_logs',
    description: 'Last 50 prompt/response pairs (admin key required · for fine-tune review).',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'forge_stack',
    description: 'Mint a branded FallCore deployment for a new company via the FallCore Factory. Returns ZIP URL.',
    inputSchema: {
      type: 'object',
      properties: {
        company: { type: 'string', description: 'Company name' },
        vertical: { type: 'string', description: 'legal | procurement | healthcare | finance | fitness | education | manufacturing | realestate | hospitality | agency | ngo | other' },
        tier: { type: 'string', description: 'lite | pro | sovereign | enterprise' },
        frontier_spend_gbp: { type: 'number', description: 'Their current frontier API spend (£/yr) — for ROI projection' },
        brand_primary: { type: 'string', description: 'Hex colour, e.g. #5078DC' }
      },
      required: ['company']
    }
  },
  {
    name: 'factory_tiers',
    description: 'List FallCore Factory tiers (hardware specs · free during launch).',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'factory_verticals',
    description: 'List FallCore Factory vertical presets (12 industries).',
    inputSchema: { type: 'object', properties: {} }
  }
];

const server = new Server(
  { name: 'fallcore-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  const args = req.params.arguments || {};
  try {
    let result;
    switch (name) {
      case 'chat': {
        const body = {
          model: args.model || 'claude-sonnet-4-20250514',
          max_tokens: args.max_tokens || 2048,
          system: args.system || undefined,
          messages: [{ role: 'user', content: String(args.prompt || '') }],
          fallcore_options: args.force_frontier ? { force_frontier: true } : undefined
        };
        const headers = {};
        if (ANTHROPIC_API_KEY) headers['x-api-key'] = ANTHROPIC_API_KEY;
        headers['anthropic-version'] = '2023-06-01';
        headers['x-fallcore-tool'] = 'fallcore-mcp';
        const r = await http('POST', FALLCORE_ENDPOINT + '/v1/messages', { body, headers });
        const fc = r.fallcore || {};
        const text = (r.content && r.content[0] && r.content[0].text) || '';
        result = {
          text: text,
          tier: fc.tier || 'unknown',
          model: r.model,
          confidence: fc.confidence,
          ms: fc.ms,
          saved_usd: fc.saved_usd,
          cost_usd: fc.cost_usd,
          usage: r.usage
        };
        break;
      }
      case 'health':       result = await http('GET', FALLCORE_ENDPOINT + '/health'); break;
      case 'stats':        result = await http('GET', FALLCORE_ENDPOINT + '/v1/stats'); break;
      case 'models':       result = await http('GET', FALLCORE_ENDPOINT + '/v1/models'); break;
      case 'recent_logs': {
        const headers = {};
        if (FALLCORE_ADMIN_KEY) headers['Authorization'] = 'Bearer ' + FALLCORE_ADMIN_KEY;
        result = await http('GET', FALLCORE_ENDPOINT + '/v1/log', { headers });
        break;
      }
      case 'forge_stack': {
        const body = {
          company: args.company,
          vertical: args.vertical || 'other',
          tier: args.tier || 'pro',
          frontier_spend_gbp: args.frontier_spend_gbp || 0,
          brand_primary: args.brand_primary || '#22c55e'
        };
        const r = await fetch(FACTORY_URL + '/v1/forge/fallcore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30000)
        });
        if (!r.ok) throw new Error('factory ' + r.status);
        const forgeId = r.headers.get('x-fallcore-forge-id');
        const prime = r.headers.get('x-fallcore-prime');
        const size = (await r.blob()).size;
        result = {
          forged: true,
          forge_id: forgeId,
          prime: parseInt(prime, 10),
          company: args.company,
          tier: args.tier,
          vertical: args.vertical,
          zip_size_bytes: size,
          download_url: FACTORY_URL + '/v1/forge/fallcore (POST to receive ZIP)',
          note: 'MCP returns metadata only · download the ZIP via the factory wizard at https://sjgant80-hub.github.io/fallcore-factory/'
        };
        break;
      }
      case 'factory_tiers':     result = await http('GET', FACTORY_URL + '/v1/tiers'); break;
      case 'factory_verticals': result = await http('GET', FACTORY_URL + '/v1/verticals'); break;
      default:
        throw new Error('unknown tool: ' + name);
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: e.message, tool: name, endpoint: FALLCORE_ENDPOINT }, null, 2) }],
      isError: true
    };
  }
});

(async () => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // No console.log to stdout (would corrupt the stdio protocol)
  // Log to stderr for debugging if needed
  process.stderr.write('◊·κ fallcore-mcp v0.1.0 · endpoint ' + FALLCORE_ENDPOINT + '\n');
})();
