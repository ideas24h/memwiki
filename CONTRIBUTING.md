# Contributing to memwiki

Thanks for your interest in contributing! Here's how to get started.

## Prerequisites

- Node.js >= 18
- npm
- git
- A running [claude-mem](https://github.com/thedotmack/claude-mem) instance (for testing ingest)
- An LLM API key only if you are testing a real remote provider-backed ingest path (default: `OPENROUTER_API_KEY`; configurable via `apiKeyEnv`)
- No LLM API key is required to exercise the `ingest --dry-run` contract when the claude-mem worker is reachable

## Setup

```bash
git clone https://github.com/ideas24h/memwiki.git
cd memwiki
npm install
npm run build
npm link
```

## Development workflow

1. Create a branch: `git checkout -b feat/my-feature`
2. Make your changes in `src/`
3. Build: `npm run build`
4. Type-check: `npm run lint`
5. Test: `npm test`
6. Commit with conventional format: `feat: ...`, `fix: ...`, `refactor: ...`

## Project structure

```
src/
  cli.ts                  -- CLI entry point
  clients/claude-mem.ts   -- claude-mem HTTP client
  commands/               -- CLI command implementations
  config/defaults.ts      -- Centralized default LLM and memwiki configuration
  git/commit.ts           -- Git auto-commit
  llm/provider.ts         -- OpenAI-compatible multi-provider LLM client and API key resolution
  wiki/                   -- Core wiki engine (store, schema, diff, slug)
```

## Code conventions

- **TypeScript ESM** with `"type": "module"` and `Node16` module resolution
- **Strict mode** enabled in tsconfig
- Import extensions must include `.js` (e.g., `import { foo } from './bar.js'`)
- All async CLI commands use `async function` with `Promise<void>` return
- Frontmatter validation uses Zod schemas in `src/wiki/schema.ts`
- Slug format: lowercase kebab-case, max 80 characters, no special chars

## Commit format

Use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` -- new feature
- `fix:` -- bug fix
- `refactor:` -- code restructuring
- `docs:` -- documentation
- `test:` -- tests
- `chore:` -- maintenance

## Adding a new command

1. Create `src/commands/your-command.ts` exporting an `async function`
2. Register it in `src/cli.ts` with `program.command('your-command')`
3. Add any new schemas to `src/wiki/schema.ts` if needed
4. Update README.md with the new command docs

## Reporting issues

Open a [GitHub issue](https://github.com/ideas24h/memwiki/issues) with:

- Steps to reproduce
- Expected vs actual behavior
- Node.js version, OS, and memwiki version

## Pull requests

- Keep PRs focused on a single change
- Include a clear description of what and why
- Ensure `npm run build` and `npm run lint` pass
- New features should include tests in `src/tests/`
- Changes to install/config/provider/ingest behavior should update or extend the matching contract tests

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
