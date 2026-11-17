# fallcore-mcp

**▶ Live: https://sjgant80-hub.github.io/fallcore-mcp/** (what it is, how to start, how it works, what it does not do)

An MCP server that gives an AI agent (Claude Code, Cursor, Cline, Windsurf) eight tools for **your own** model. Point it
at a [FallCore](https://github.com/sjgant80-hub/fallcore) proxy and the agent's calls go through the proxy: local model
first, a frontier model only when the proxy falls through, and every call in the proxy's log. Point it at plain
[Ollama](https://ollama.com) and `chat` and `models` work straight away.

```bash
claude mcp add fallcore -s user --transport stdio -- npx -y github:sjgant80-hub/fallcore-mcp
```

## The eight tools, and what each needs

| Tool | What it does | Plain Ollama | FallCore proxy |
|---|---|---|---|
| `chat` | Sends a message (Anthropic Messages format) and returns the text, plus the proxy's tier and cost when the proxy answers | ✓ (name one of your Ollama models) | ✓ |
| `models` | The models on offer | ✓ | ✓ |
| `health` | The proxy's status and its backend | — (404) | ✓ |
| `stats` | The proxy's own counts: local against frontier calls, tokens, cost | — (404) | ✓ |
| `recent_logs` | The last 50 prompt and response pairs the proxy logged | — | ✓ (admin key) |
| `forge_stack` | Asks the [FallCore Factory](https://github.com/sjgant80-hub/fallcore-factory) to build a branded deployment; returns its metadata | n/a | n/a (the factory) |
| `factory_tiers` | The factory's tiers | n/a | n/a (the factory) |
| `factory_verticals` | The factory's industry presets | n/a | n/a (the factory) |

A tool the endpoint does not serve comes back as an error result that says so ("health needs the FallCore proxy…"),
never a crash. The factory runs on a free hosting tier that sleeps: its first call can take about a minute, and its
tools wait up to 90 seconds.

## Settings

| Variable | Default | What for |
|---|---|---|
| `FALLCORE_ENDPOINT` | `http://localhost:11434` | the FallCore proxy, or plain Ollama (no user or password in the URL: Node's fetch refuses one, and the error never shows it) |
| `FALLCORE_MODEL` | `claude-sonnet-5-5` | the chat model when a call names none (with plain Ollama, set one of your models, e.g. `qwen2.5:7b`) |
| `FALLCORE_ADMIN_KEY` | none | `recent_logs` |
| `ANTHROPIC_API_KEY` | none | passed to the proxy on `chat`, for its frontier fallthrough |
| `FALLCORE_FACTORY` | `https://fallcore-factory.onrender.com` | the factory |

For Cursor, Cline or Windsurf, in `mcp.json`:

```json
{ "mcpServers": { "fallcore": { "command": "npx", "args": ["-y", "github:sjgant80-hub/fallcore-mcp"],
  "env": { "FALLCORE_ENDPOINT": "http://localhost:11434", "FALLCORE_MODEL": "qwen2.5:7b" } } } }
```

## How it is checked

- **The tests** (`npm test`):
  - every tool against a fake client: the URL it calls, what it sends, what it answers;
  - the real server over stdio (`bin/cli.js`) against a fake FallCore on a local port: `initialize`, the eight tools, `chat` and `models` answered, a 404 explained.
- **[witness](https://github.com/sjgant80-hub/witness)** gates `src/core.js`: every one of its 37 mutants is killed by the tests, with no exemptions (`receipts/core-gate.json`). Its fuzz battery finds no export that throws.
- **CI** runs all of it on every push (`.github/workflows/ci.yml`, witness pinned to v0.7).

## What it does not do

- It does no thinking of its own. The model behind the endpoint does.
- It keeps no log itself. The FallCore proxy keeps it, when you use the proxy. With plain Ollama there is no log beyond Ollama's own.
- It does not make anything compliant. Whether your use of a model meets your obligations is yours to judge.
- It does not download the factory's ZIP. `forge_stack` returns the forge's metadata; the ZIP comes from the factory's own page.

## Layout

- `src/core.js`: the tools, pure, with the network injected.
- `src/server.js`: wires them to the MCP SDK over stdio.
- `bin/cli.js`: the command.

The layering it completes, from the operating system up to the agent (sys → cmd → cli → api → mcp), is Thomas Frumkin's.

MIT · © Simon Gant · built by Kar for [AI Native Solutions](https://www.ai-nativesolutions.com/)
