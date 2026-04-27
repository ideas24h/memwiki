# memwiki Test Results

Date: 2026-04-18
Environment:
- Repo: `/home/raul/dev/active/memwiki`
- Temp test repo: `/tmp/memwiki-codex-test`
- Node entrypoint tested: `dist/cli.js`

## Summary

`npm run build` succeeded.

The basic install/context/lint flow works in a clean repo. The previous dry-run credential issue is no longer reproducible under the current contract tests. One significant issue remains in `lint --fix` for invalid-slug pages with concurrent problems.

## 1. Build

Command:

```bash
npm run build
```

Result:
- Exit code: `0`
- Output: `tsc`
- No compile errors.

## 2. Full Workflow Test

Fresh repo setup:

```bash
rm -rf /tmp/memwiki-codex-test
mkdir -p /tmp/memwiki-codex-test
git init /tmp/memwiki-codex-test
```

### 2a. Install

Command:

```bash
node /home/raul/dev/active/memwiki/dist/cli.js install
```

Result:
- Exit code: `0`
- Reported successful initialization.

Verified created paths:
- `.memwiki/config.json`
- `.memwiki/aliases.json`
- `.memwiki/state.json`
- `wiki/entities/`
- `wiki/topics/`
- `wiki/decisions/`
- `wiki/sessions/`
- `wiki/skills/`
- `wiki/index.md`
- `wiki/log.md`

Observed `.memwiki/config.json`:

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

### 2b. Context

Command:

```bash
node /home/raul/dev/active/memwiki/dist/cli.js context
```

Result:
- Exit code: `0`
- Printed wiki index successfully.

### 2c. Lint

Command:

```bash
node /home/raul/dev/active/memwiki/dist/cli.js lint
```

Result:
- Exit code: `0`
- Reported:

```text
Total pages: 0
All checks passed. Wiki is clean.
0 error(s), 0 warning(s)
```

### 2d. Lint JSON

Command:

```bash
node /home/raul/dev/active/memwiki/dist/cli.js lint --json
```

Result:
- Exit code: `0`
- Returned:

```json
{
  "errors": [],
  "warnings": [],
  "stats": {
    "total": 0,
    "by_type": {}
  }
}
```

### 2e. Ingest Dry Run

Command:

```bash
node /home/raul/dev/active/memwiki/dist/cli.js ingest --dry-run
```

Result under current contract tests:
- `ingest --dry-run` succeeds without an LLM API key when the claude-mem worker is reachable.
- `ingest --dry-run` does not write wiki files or create git commits.
- `ingest --dry-run` still exits with code `1` if the claude-mem worker is not reachable.

Validated contract:
- No credential dependency for preview mode.
- Worker availability is still required because observations are fetched from claude-mem.

### 2f. Manual Bad Page Creation

Created test page:

`/tmp/memwiki-codex-test/wiki/entities/Bad Page.md`

Properties of the test page:
- Invalid filename slug: `Bad Page.md`
- Frontmatter slug mismatch: `slug: wrong-slug`
- Invalid entity kind: `kind: nonsense`
- Broken wikilink in body: `[[entities/does-not-exist]]`

### 2g. Lint Against Bad Page

Command:

```bash
node /home/raul/dev/active/memwiki/dist/cli.js lint
```

Result:
- Exit code: `1`
- `lint` correctly detected the invalid page.

Observed output:

```text
--- Errors (4) ---
[invalid_slug] entities/Bad Page.md: slug "Bad Page" is not a valid kebab-case slug
[invalid_slug] entities/Bad Page.md: frontmatter slug "wrong-slug" doesn't match filename "Bad Page"
[invalid_frontmatter] entities/Bad Page.md: invalid entity kind "nonsense"
[broken_link] entities/Bad Page.md: wikilink target "[[entities/does-not-exist]]" does not correspond to an existing page

--- Warnings (1) ---
[orphan] entities/Bad Page.md: no incoming wikilinks from other pages
```

### 2h. Lint Fix

Command:

```bash
node /home/raul/dev/active/memwiki/dist/cli.js lint --fix
```

Result:
- Exit code: `1`
- Reported only one applied fix:

```text
entities/Bad Page.md: renamed slug "Bad Page" -> "bad-page"
```

Filesystem state after `--fix`:

```text
wiki/entities/Bad Page.md
wiki/entities/bad-page.md
```

Observed problems:
- The original invalid file remained.
- A second file was created at `wiki/entities/bad-page.md`.
- The new file still contained the invalid `kind: nonsense`.
- The new file still contained the broken wikilink.
- The old file also still contained the invalid `kind` and broken wikilink.

Re-running lint after `--fix` produced:
- Exit code: `1`
- `Total pages: 2`
- `6 error(s), 2 warning(s)`

This means `lint --fix` made the repository worse in the tested case by duplicating the page.

## 3. Help Output and Command Count

Command:

```bash
node /home/raul/dev/active/memwiki/dist/cli.js --help
```

Result:
- Exit code: `0`
- The expected 7 commands are present:
  - `install`
  - `ingest`
  - `context`
  - `lint`
  - `query`
  - `daemon`
  - `mcp`

Also present:
- `help [command]` from Commander

## Findings

### Validated behavior: `ingest --dry-run` no longer requires API credentials

Severity: Resolved

Why it matters:
- A dry run should be usable to validate workflow setup safely.
- The current contract verifies preview mode without requiring remote LLM credentials.

Validated behavior:
- `ingest --dry-run` succeeds without an LLM API key when the claude-mem worker is reachable.
- `ingest --dry-run` does not write wiki files or create git commits.

### Constraint: `ingest --dry-run` still depends on claude-mem worker availability

Severity: Expected constraint

Why it matters:
- Dry-run still needs live observations from claude-mem, so worker connectivity remains part of setup verification.

Validated behavior:
- `ingest --dry-run` exits with code `1` when the claude-mem worker is unavailable.

### Issue 2: `lint --fix` duplicates renamed files instead of replacing them

Severity: High

Why it matters:
- Running an auto-fix command should not create duplicate wiki pages and increase error count.
- The tested repository went from 1 invalid page to 2 invalid pages after `--fix`.

Observed behavior:
- Invalid-slug page `wiki/entities/Bad Page.md` remained on disk.
- New file `wiki/entities/bad-page.md` was created in addition to the original.
- Subsequent lint showed more total errors and warnings.

### Issue 3: `lint --fix` did not fix the broken link in the tested page

Severity: Medium

Why it matters:
- Broken-link removal appears to be part of intended `--fix` behavior.

Observed behavior:
- Both the original and renamed file still contained `[[entities/does-not-exist]]` after `lint --fix`.

### Issue 4: `lint --fix` did not normalize invalid entity kind in the tested page

Severity: Medium

Why it matters:
- Invalid `kind` normalization also appears to be intended `--fix` behavior.

Observed behavior:
- `kind: nonsense` remained in both files after `lint --fix`.

## Overall Assessment

What works:
- Build
- Install
- Context
- Lint on a clean wiki
- Lint JSON output
- Help output and command inventory
- Detection of malformed wiki pages
- `ingest --dry-run` without API credentials when the claude-mem worker is reachable

What does not fully work:
- `ingest --dry-run` when the claude-mem worker is unavailable
- `lint --fix` on invalid-slug pages with other simultaneous issues
