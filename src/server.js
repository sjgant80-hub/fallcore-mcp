// fallcore-mcp · src/server.js — the MCP server: the eight tools in src/core.js, over stdio.
//
// Install (Claude Code):
//   claude mcp add fallcore -s user --transport stdio -- npx -y github:sjgant80-hub/fallcore-mcp
//
// Settings (environment):
//   FALLCORE_ENDPOINT   the FallCore proxy, or plain Ollama (default http://localhost:11434)
//   FALLCORE_MODEL      the chat model when a call names none (default claude-sonnet-5-5)
//   FALLCORE_ADMIN_KEY  for recent_logs
//   ANTHROPIC_API_KEY   passed through on chat, for the proxy's frontier fallthrough
//   FALLCORE_FACTORY    the FallCore Factory (default https://fallcore-factory.onrender.com)
'use strict';

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { TOOLS, config, call, makeHttp } = require('./core.js');
const { version } = require('../package.json');

const cfg = config(process.env);
// the endpoint as shown to the agent and on stderr: never with a user or password in it
const shown = (() => { try { const u = new URL(cfg.endpoint); u.username = ''; u.password = ''; return u.toString().replace(/\/$/, ''); } catch (_) { return '(unreadable endpoint)'; } })();
const deps = { http: makeHttp(fetch), fetch, cfg };
const server = new Server({ name: 'fallcore-mcp', version }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  const out = await call(name, req.params.arguments || {}, deps);
  if (out.error !== undefined) return { content: [{ type: 'text', text: JSON.stringify({ error: out.error.split(cfg.endpoint).join(shown), hint: out.hint, tool: name, endpoint: shown }, null, 2) }], isError: true };
  return { content: [{ type: 'text', text: JSON.stringify(out.result, null, 2) }] };
});

(async () => {
  await server.connect(new StdioServerTransport());
  // stdout carries the protocol: anything for a person goes to stderr
  process.stderr.write('fallcore-mcp ' + version + ' · endpoint ' + shown + '\n');
})();
