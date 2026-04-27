<p align="center">
  <strong>memwiki</strong>
</p>

<p align="center">
  Persistent wiki memory for AI coding sessions.<br/>
  Bridges <a href="https://github.com/thedotmack/claude-mem">claude-mem</a> observations with curated markdown knowledge.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D18-green" alt="Node >=18" />
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" />
  <img src="https://img.shields.io/badge/status-v0.1.0-orange" alt="v0.1.0" />
  <img src="https://img.shields.io/badge/TypeScript-ESM-blue" alt="TypeScript ESM" />
</p>

---

## What is memwiki?

memwiki turns the raw observations captured by [claude-mem](https://github.com/thedotmack/claude-mem) during Claude Code sessions into a **curated, version-controlled markdown wiki** inside your project. Every entity, decision, and session summary is stored as a markdown file with YAML frontmatter, organized by type, and linked with `[[wikilinks]]`.

Think of it as a **second brain** for your AI-assisted coding workflow -- one that lives in your repo, diffs cleanly in git, and can be queried at the start of every session.

## How it works

```
                         memwiki data flow

  +----------------+         +----------+         +------------------+
  |  Claude Code   |         | memwiki  |         |  LLM Provider    |
  |  + claude-mem  | ----->  |  ingest  | ----->  | (OpenRouter,     |
  |  (localhost     |  HTTP   |          |  HTTP   |  OpenAI, Ollama, |
  |   :37777)       |         |          |         |  LM Studio...)   |
  |                |         |          | <-----  |                  |
  |  Captures obs, |         |          |  JSON   |  Canonizes raw   |
  |  sessions,     |         +----------+         |  obs into wiki   |
  |  search        |              |               |  pages           |
  +----------------+              |               +------------------+
                        +---------v----------+
                        |   wiki/             |
                        |   +-- entities/     |
                        |   +-- sessions/     |
                        |   +-- decisions/    |
                        |   +-- topics/       |
                        |   +-- skills/       |
                        |   +-- index.md      |
                        |   +-- log.md        |
                        |                     |
                        |   .memwiki/         |
                        |   +-- config.json   |
                        |   +-- state.json    |
                        |   +-- aliases.json  |
                        +---------------------+
                                  |
                        +---------v----------+
                        |  git commit        |
                        |  (auto-committed)  |
                        +--------------------+
```

1. **claude-mem** captures observations during your Claude Code sessions
2. **memwiki ingest** fetches new observations and sends them to an LLM for canonization
3. The LLM produces structured wiki pages with proper frontmatter and wikilinks
4. Pages are written to `wiki/` with 3-way merge (human edits are never lost)
5. Changes are auto-committed to git

## Architecture

```
src/
  cli.ts                     -- CLI entry point (commander)
  clients/
    claude-mem.ts            -- HTTP client for claude-mem API
  commands/
    install.ts               -- Initialize wiki/ in project
    ingest.ts                -- Promote observations to wiki pages
    context.ts               -- Output wiki context for session start
    lint.ts                  -- Validate wiki health
    daemon.ts                -- Background polling daemon
  git/
    commit.ts                -- Auto-commit wiki changes
  llm/
    provider.ts              -- OpenAI-compatible LLM provider (multi-provider)
    prompts/
      ingest.md              -- System prompt for wiki canonization
  wiki/
    store.ts                 -- WikiStore: CRUD for markdown pages
    schema.ts                -- Zod schemas for frontmatter validation
    diff.ts                  -- 3-way merge engine
    slug.ts                  -- Slug normalization utilities
```

### Wiki page format

Every page is markdown with YAML frontmatter:

```markdown
---
id: "01JST..."
type: entity
kind: repo
title: "memwiki"
slug: "memwiki"
aliases: ["memory wiki"]
status: active
identifiers:
  github: "ideas24h/memwiki"
sources: [12, 15]
confidence: 0.9
authored_by: memwiki
schema_version: 1
created_at: "2026-04-18T00:00:00.000Z"
updated_at: "2026-04-18T00:00:00.000Z"
related: []
---

# memwiki

Persistent wiki memory for AI coding sessions...

## References

- Uses [[entities/claude-mem|claude-mem]] for observation capture
```

### Page types

| Directory | Type | Description |
|-----------|------|-------------|
| `entities/` | entity | Repos, services, APIs, tools, people |
| `sessions/` | session | Session summaries with files modified |
| `decisions/` | decision | ADR-lite architectural decisions |
| `topics/` | topic | Knowledge topics with prerequisites |
| `skills/` | skill | Reusable skill definitions |

## Installation

### Prerequisites

- **Node.js** >= 18
- **claude-mem** installed and running (provides the HTTP API on `localhost:37777`)
- **An LLM provider** with an OpenAI-compatible chat completions API. Supported out of the box:
  - **OpenRouter** (default, free tier available with `openrouter/elephant-alpha`)
  - **OpenAI** (gpt-4o-mini, gpt-4o, etc.)
  - **Ollama** (llama3, mistral, etc. -- local, no API key needed)
  - **LM Studio** (any local model -- no API key needed)

### Install from source

```bash
git clone https://github.com/ideas24h/memwiki.git
cd memwiki
npm install
npm run build
npm link     # makes 'memwiki' available globally
```

### Quick start

```bash
# 1. Initialize wiki in your project
cd your-project
memwiki install

# 2. Run a Claude Code session (claude-mem will capture observations)
# ... use Claude Code normally ...

# 3. Promote observations to wiki pages
export OPENROUTER_API_KEY=***     # or LLM_API_KEY, OPENAI_API_KEY, MEMWIKI_API_KEY
memwiki ingest --verbose

# Preview the ingest workflow without writing or committing
# (requires a reachable claude-mem worker, but no LLM API key)
memwiki ingest --dry-run

# 4. View wiki context for your next session
memwiki context

# 5. Check wiki health
memwiki lint
```

## Token Economics

Does memwiki actually save tokens? **Yes — typically 80-97% per session.**

| Scenario | Without memwiki | With memwiki | Savings |
|----------|----------------|--------------|---------|
| Small project (5 files) | ~32,000 tokens/session | ~2,000 tokens/session | ~94% |
| Medium project (20 files) | ~180,000 tokens/session | ~2,000 tokens/session | ~99% |
| Large project (100 files) | ~2,400,000 tokens/session | ~2,000 tokens/session | ~99.9% |

The wiki context is capped at 2,000 tokens. Ingest cost is a one-time ~6,500 tokens per run. **Break-even: session 2.**

Real measurement from this project: claude-mem reported **96% savings** — 2,461 tokens to read vs 66,907 tokens of work investment.

```bash
# Run the token economics test suite
npm run build && node --test dist/tests/token-economics.test.js
```

See [docs/TOKEN_ECONOMICS.md](docs/TOKEN_ECONOMICS.md) for the full analysis, formulas, and how to measure your own savings.

## Commands

### `memwiki install`

Initialize a wiki in the current project directory.

```bash
memwiki install              # Creates ./wiki/ and ./.memwiki/
memwiki install --global     # Creates ~/.memwiki/wiki/
```

Creates the directory structure (`entities/`, `sessions/`, `decisions/`, `topics/`, `skills/`), seed files (`index.md`, `log.md`), and config (`config.json`, `state.json`, `aliases.json`). Also updates `.gitignore`.

### `memwiki ingest`

Fetch new observations from claude-mem and promote them to wiki pages via LLM canonization.

```bash
memwiki ingest                         # Ingest all new observations
memwiki ingest --project my-app        # Filter by project
memwiki ingest --dry-run               # Preview without writing
memwiki ingest --verbose               # Detailed output
memwiki ingest --since 1745000000000   # Only since epoch ms
```

Features:
- Connects to claude-mem API to fetch observations since last ingest
- Sends observations + current wiki state to LLM for canonization
- Writes structured markdown pages with validated frontmatter
- Performs 3-way merge to preserve human edits
- Auto-commits changes to git
- `--dry-run` previews canonization without writing wiki files or creating git commits
- `--dry-run` still requires the claude-mem worker at `claudeMemUrl` to be reachable

### `memwiki context`

Output a summary of wiki state for session start. Paste this into your Claude Code session.

```bash
memwiki context                        # Default: 2000 tokens
memwiki context --max-tokens 4000      # More context
memwiki context --project my-app       # Filter by project
```

Outputs:
- Wiki index
- Last 5 session summaries
- Active entities (updated in last 7 days, confidence > 0.7)

### `memwiki lint`

Validate wiki health. Checks frontmatter schema, slug validity, broken wikilinks, orphan pages, fuzzy duplicates, and stale pages.

```bash
memwiki lint                # Print report
memwiki lint --fix          # Auto-fix where possible
memwiki lint --json         # Machine-readable output
```

Lint rules:
- **broken_link** -- wikilink target does not exist
- **invalid_frontmatter** -- missing required fields or invalid values
- **invalid_slug** -- slug is not valid kebab-case or doesn't match filename
- **orphan** (warning) -- page has no incoming wikilinks
- **fuzzy_duplicate** (warning) -- similar titles within same type
- **stale** (warning) -- not updated in 90+ days with low confidence

### `memwiki daemon`

Run a background daemon that polls claude-mem and runs ingest automatically.

```bash
memwiki daemon                      # Default: poll every 10 minutes
memwiki daemon --interval 300000    # Custom interval in ms (min 30000)
```

Features:
- PID-based process management (prevents duplicates)
- Lockfile prevents concurrent ingests
- Graceful shutdown on SIGINT/SIGTERM
- Logs activity to `.memwiki/daemon.log`

### `memwiki query` *(planned -- Phase 4)*

Search wiki pages. Not yet implemented.

### `memwiki mcp` *(planned -- Phase 4)*

Run as MCP stdio server. Not yet implemented.

## Configuration

Configuration is stored in `.memwiki/config.json`:

`memwiki install` seeds this file from the centralized defaults in `src/config/defaults.ts`. At runtime, missing fields are merged with those defaults before ingest runs.

```json
{
  "provider": "openrouter",
  "model": "openrouter/elephant-alpha",
  "baseUrl": "https://openrouter.ai/api/v1",
  "apiKeyEnv": "OPENROUTER_API_KEY",
  "claudeMemUrl": "http://127.0.0.1:37777",
  "maxTokens": 4096
}
```

| Field | Description |
|-------|-------------|
| `provider` | LLM provider: `openrouter`, `openai`, `ollama`, or `custom` |
| `model` | Model identifier to use (e.g. `openrouter/elephant-alpha`, `gpt-4o-mini`, `llama3`) |
| `baseUrl` | Base URL for the OpenAI-compatible chat completions endpoint |
| `apiKeyEnv` | Name of the environment variable holding the API key |
| `claudeMemUrl` | URL of the claude-mem HTTP API |
| `maxTokens` | Maximum tokens for LLM responses |

### Provider examples

**OpenRouter** (default -- free with elephant-alpha):
```json
{
  "provider": "openrouter",
  "model": "openrouter/elephant-alpha",
  "baseUrl": "https://openrouter.ai/api/v1",
  "apiKeyEnv": "OPENROUTER_API_KEY"
}
```

**OpenAI** (direct):
```json
{
  "provider": "openai",
  "model": "gpt-4o-mini",
  "baseUrl": "https://api.openai.com/v1",
  "apiKeyEnv": "OPENAI_API_KEY"
}
```

**Ollama** (local, no API key):
```json
{
  "provider": "ollama",
  "model": "llama3",
  "baseUrl": "http://localhost:11434/v1",
  "apiKeyEnv": ""
}
```

**LM Studio** (local, no API key):
```json
{
  "provider": "custom",
  "model": "my-model",
  "baseUrl": "http://localhost:1234/v1",
  "apiKeyEnv": ""
}
```

State is tracked in `.memwiki/state.json`:

```json
{
  "last_ingested_epoch": 1745000000000,
  "content_hashes": {
    "entities/my-repo.md": "a1b2c3d4..."
  }
}
```

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENROUTER_API_KEY` | If using OpenRouter | API key for OpenRouter |
| `OPENAI_API_KEY` | If using OpenAI | API key for OpenAI |
| `LLM_API_KEY` | Alternative | Generic API key, works with any provider |
| `MEMWIKI_API_KEY` | Alternative | Another generic API key option |
| `LLM_BASE_URL` | No | Override `baseUrl` from config.json |
| `LLM_MODEL` | No | Override `model` from config.json |

**API key resolution order**: `apiKeyEnv` (from config) → `MEMWIKI_API_KEY` → `LLM_API_KEY` → `OPENROUTER_API_KEY` → `OPENAI_API_KEY`. The first one found is used.

For local providers (Ollama, LM Studio), no API key is required.

## 3-way merge

memwiki uses a 3-way merge strategy to ensure human edits to wiki pages are never overwritten by LLM output:

1. **No human edits** (ours == base): Accept LLM version entirely
2. **Human edited, LLM unchanged** (theirs == base): Keep human version
3. **Both changed**: Merge -- preserve `<!-- human:start -->...<!-- human:end -->` blocks from the human version, use LLM version for the rest, mark as `authored_by: mixed`

## Development

```bash
npm run build       # Compile TypeScript
npm run dev         # Watch mode
npm run lint        # Type-check only
npm test            # Run tests
node --test dist/tests/install.contract.test.js dist/tests/provider.contract.test.js dist/tests/ingest-dry-run.contract.test.js
```

Contract coverage includes install defaults, provider defaults/API key resolution, and ingest dry-run behavior.

## Upstream dependencies

memwiki builds on these excellent projects:

| Dependency | Author | Description |
|------------|--------|-------------|
| [claude-mem](https://github.com/thedotmack/claude-mem) | [thedotmack](https://github.com/thedotmack) | Memory layer for Claude Code CLI. Provides HTTP API on localhost:37777 with observations, sessions, and search endpoints. memwiki consumes this API to fetch raw coding session data. |
| [OpenRouter](https://openrouter.ai) | OpenRouter | LLM proxy service. One of the supported providers -- memwiki uses it by default with elephant-alpha (free model) for canonizing observations into structured wiki pages. Any OpenAI-compatible provider can be used instead. |
| [gray-matter](https://github.com/jonschlinkert/gray-matter) | [jonschlinkert](https://github.com/jonschlinkert) | Parses and stringifies YAML frontmatter in markdown files. Core to the wiki page format. |
| [commander.js](https://github.com/tj/commander.js) | [tj](https://github.com/tj) | CLI framework. Powers the memwiki command-line interface. |
| [zod](https://github.com/colinhacks/zod) | [colinhacks](https://github.com/colinhacks) | Schema validation for frontmatter structures. |
| [ulidx](https://github.com/nickelc/ulidx) | [nickelc](https://github.com/nickelc) | ULID generation for unique page identifiers. |
| [fast-fuzzy](https://github.com/EthanRutherford/fast-fuzzy) | [EthanRutherford](https://github.com/EthanRutherford) | Fuzzy search for wiki page queries. |

### Inspirations

The wiki-as-git-repo approach with markdown + wikilinks is inspired by **Karpathy's LLM Wiki pattern** -- using a local directory of interlinked markdown files as a persistent knowledge layer that LLMs can read and write.

## Compatibility

- **Node.js**: >= 18.0.0 (uses `fetch`, `AbortSignal.timeout`, ESM)
- **TypeScript**: 5.7+, compiled with `Node16` module resolution
- **Module system**: ESM only (`"type": "module"`)
- **claude-mem**: Requires a running claude-mem worker on localhost:37777
- **Git**: Auto-commit works with any git repo; graceful no-op if not in a git repo

## License

[MIT](LICENSE) -- ideas24h
