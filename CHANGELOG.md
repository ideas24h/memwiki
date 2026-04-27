# Changelog

All notable changes to memwiki are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Contract tests for install defaults, provider defaults/API key resolution, and ingest dry-run behavior

### Changed

- Centralized LLM and memwiki defaults in `src/config/defaults.ts`
- `memwiki install` now seeds `.memwiki/config.json` from `DEFAULT_MEMWIKI_CONFIG`
- `ingest` now merges user config with `DEFAULT_MEMWIKI_CONFIG` instead of relying on inline fallbacks
- `LLMProvider` now uses `DEFAULT_LLM_CONFIG` for provider/model/baseUrl/maxTokens defaults

### Clarified

- `ingest --dry-run` does not require an LLM API key when the claude-mem worker is reachable
- `ingest --dry-run` still fails when the claude-mem worker is unavailable

## [0.1.0] - 2026-04-18

### Phase 3: 3-way merge + daemon

- Added 3-way merge engine (`src/wiki/diff.ts`) to prevent overwriting human edits during ingest
- Human-protected zones via `<!-- human:start -->...<!-- human:end -->` markers
- Content hash tracking in `state.json` for merge base detection
- `memwiki daemon` command for background polling of claude-mem
- PID-based process management and lockfile for concurrent ingest prevention
- Graceful shutdown on SIGINT/SIGTERM
- Activity logging to `.memwiki/daemon.log`
- `authored_by: 'mixed'` flag for pages with both human and LLM edits
- `memwiki context` command for session-start wiki summary
  - Shows wiki index, recent sessions, and active entities
  - Configurable max token output

### Phase 2: Schema validation + lint

- Zod schemas for all page types (entity, topic, decision, session, skill) in `src/wiki/schema.ts`
- Discriminated union validation via `z.discriminatedUnion`
- `memwiki lint` command with comprehensive wiki health checks:
  - Frontmatter validation (required fields, type checking, entity kinds/statuses)
  - Slug validity (kebab-case, filename consistency)
  - Broken wikilink detection
  - Orphan page detection
  - Fuzzy duplicate detection (Levenshtein distance)
  - Stale page detection (90+ days, low confidence)
- `--fix` flag for auto-fixing lint issues (broken link removal, slug normalization)
- `--json` flag for machine-readable output

### Phase 1: Initial scaffold

- CLI tool built with commander.js
- `memwiki install` command to initialize wiki directory structure
- `memwiki ingest` command to promote claude-mem observations to wiki pages
- LLM provider for OpenRouter-compatible chat completions (`src/llm/provider.ts`)
- claude-mem HTTP client with pagination and search (`src/clients/claude-mem.ts`)
- WikiStore for markdown CRUD with gray-matter frontmatter (`src/wiki/store.ts`)
- Slug normalization with accent handling (`src/wiki/slug.ts`)
- Auto-commit to git after ingest (`src/git/commit.ts`)
- Project-level (`./wiki/`) and global (`~/.memwiki/wiki/`) wiki support
- State tracking for incremental ingestion
- Alias management for entity name resolution

### Fixes

- Adapted claude-mem client to handle paginated response formats (`items`, `observations`, `summaries`, bare arrays)
- Enforced schema fields in ingest (id, type, slug, timestamps, confidence)
- Improved git commit reliability (auto-configure user if needed, skip gracefully)

[0.1.0]: https://github.com/ideas24h/memwiki/releases/tag/v0.1.0
