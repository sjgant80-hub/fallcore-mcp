# ◊·κ=1 · fallcore-mcp

**The 5th turtle. `mcp(api)` for FallCore.**

MCP server that exposes any FallCore deployment as native tools in Claude Code / Cursor / Cline / Windsurf. Lets the AI call the on-prem brain directly — with full audit trail in the FallCore logs.

Per Thomas's stack:

```
sys(params)     — the OS does a thing                       L7 ASS
cmd(sys)        — a command triggers the OS                 L4 BLOOM
cli(cmd)        — a command line assembles commands         L2 SWARM
api(cli)        — an API hosts the CLI to a port            L3 CASCADE (the FallCore proxy)
mcp(api)        — MCP lets AI call the API remotely         ← this package
```

---

## Install (Claude Code)

```bash
claude mcp add fallcore -s user --transport stdio -- npx -y github:sjgant80-hub/fallcore-mcp
```

Verify:

```bash
claude mcp list
# fallcore: npx -y github:sjgant80-hub/fallcore-mcp - ✓ Connected
```

For Cursor / Cline / Windsurf — edit `mcp.json`:

```json
{
  "mcpServers": {
    "fallcore": {
      "command": "npx",
      "args": ["-y", "github:sjgant80-hub/fallcore-mcp"]
    }
  }
}
```

---

## Config

Set these env vars before launching (or via your MCP host's env config):

```bash
FALLCORE_ENDPOINT=http://localhost:11434       # default · your FallCore proxy URL
FALLCORE_ADMIN_KEY=fc_admin_...                # optional · for recent_logs tool
ANTHROPIC_API_KEY=sk-ant-...                   # optional · passed through on chat calls (frontier fallthrough)
```

If running FallCore on another host (e.g. company VPN):

```json
{
  "mcpServers": {
    "fallcore": {
      "command": "npx",
      "args": ["-y", "github:sjgant80-hub/fallcore-mcp"],
      "env": {
        "FALLCORE_ENDPOINT": "https://ai.acme.internal"
      }
    }
  }
}
```

---

## Tools exposed

| Tool | What it does |
|---|---|
| `chat` | Send a message · cascades local-first · returns text + tier + cost |
| `health` | FallCore + Ollama status + recent stats |
| `stats` | Full ROI dashboard (local vs frontier ratio, USD saved, by-tool) |
| `models` | Local + frontier models on this deployment |
| `recent_logs` | Last 50 prompt/response pairs (admin key required) |
| `forge_stack` | Mint a new branded FallCore for a customer via FallCore Factory |
| `factory_tiers` | List factory tiers (hardware specs) |
| `factory_verticals` | List factory vertical presets |

---

## Example session in Claude Code

```
You: Use the fallcore tools — what's the current state of my deployment?

Claude: [calls fallcore_health]
   FallCore at http://localhost:11434 is up. Ollama running qwen2.5:32b.
   Local-to-frontier ratio: 73%. $34.20 saved this week vs raw frontier.

You: Reason about the trade-offs of LoRA vs RAG for our compliance use case · use the local model

Claude: [calls fallcore_chat with the prompt]
   [Response from local Qwen2.5-32B · tier: local · 2.3s · saved $0.04]
   The trade-off comes down to ...
```

---

## Why the MCP layer matters

The MCP isn't doing the cognition. Ollama is. The MCP exists for **accountability**:

- Every call from your AI agent is logged in FallCore's JSONL
- Every fine-tune cycle can reference back to which agent triggered which queries
- The audit trail is unbroken: AI agent → MCP → FallCore proxy → local model
- For regulated industries this is the **only** way to use external AI agents on your data legally

> "API server on training wheels. Doesn't want to get sued." — Thomas

The MCP is the wheels. The brain is downstairs.

---

## Repo

https://github.com/sjgant80-hub/fallcore-mcp

Part of the [Fall* estate](https://github.com/sjgant80-hub) · pairs with [FallCore](https://github.com/sjgant80-hub/fallcore) + [FallCore Factory](https://github.com/sjgant80-hub/fallcore-factory).

MIT licensed.

◊·κ=1
