import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DEFAULT_MEMWIKI_CONFIG } from '../config/defaults.js';
import { install } from '../commands/install.js';
import { ingest } from '../commands/ingest.js';

const ORIGINAL_CWD = process.cwd();
const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_EXIT = process.exit;
const ORIGINAL_LOG = console.log;
const ORIGINAL_ERROR = console.error;
const ORIGINAL_USERDIR = process.env.USERDIR;
const ORIGINAL_HOME = process.env.HOME;

function makeTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'memwiki-ingest-dry-run-'));
}

function makeTempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'memwiki-home-'));
}

function setTempHome(homeDir: string) {
  process.env.HOME = homeDir;
  process.env.USERDIR = homeDir;
}

async function withCwd<T>(cwd: string, fn: () => Promise<T> | T): Promise<T> {
  const previous = process.cwd();
  process.chdir(cwd);
  try {
    return await fn();
  } finally {
    process.chdir(previous);
  }
}

function git(cwd: string, args: string[]) {
  return spawnSync('git', args, { cwd, encoding: 'utf-8' });
}

function snapshotFiles(cwd: string): Record<string, string> {
  const files = [
    '.gitignore',
    '.memwiki/config.json',
    '.memwiki/state.json',
    '.memwiki/aliases.json',
    'wiki/index.md',
    'wiki/log.md',
  ];
  return Object.fromEntries(
    files.map((file) => [file, fs.readFileSync(path.join(cwd, file), 'utf-8')]),
  );
}

function captureConsole() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  console.log = (...args: unknown[]) => { stdout.push(args.map(String).join(' ')); };
  console.error = (...args: unknown[]) => { stderr.push(args.map(String).join(' ')); };
  return {
    stdout,
    stderr,
    restore() {
      console.log = ORIGINAL_LOG;
      console.error = ORIGINAL_ERROR;
    },
  };
}

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  globalThis.fetch = ORIGINAL_FETCH;
  process.exit = ORIGINAL_EXIT;
  if (ORIGINAL_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = ORIGINAL_HOME;
  if (ORIGINAL_USERDIR === undefined) delete process.env.USERDIR;
  else process.env.USERDIR = ORIGINAL_USERDIR;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.LLM_API_KEY;
  delete process.env.MEMWIKI_API_KEY;
});

describe('ingest --dry-run contract', () => {
  it('does not require an API key and does not write files or create commits', async () => {
    const cwd = makeTempProject();
    const homeDir = makeTempHome();
    setTempHome(homeDir);

    await withCwd(cwd, async () => {
      await install({ global: false });
    });

    const configPath = path.join(cwd, '.memwiki', 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      ...DEFAULT_MEMWIKI_CONFIG,
      claudeMemUrl: 'http://127.0.0.1:37777',
    }, null, 2));

    globalThis.fetch = (async (url: string | URL | globalThis.Request) => {
      const href = String(url);
      if (href.endsWith('/api/health')) {
        return new Response(JSON.stringify({ version: 'test' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (href.includes('/api/observations?')) {
        return new Response(JSON.stringify({
          items: [{
            id: 1,
            memory_session_id: 'sess-1',
            project: 'demo',
            text: 'Observed a useful fact',
            type: 'discovery',
            created_at: '2026-04-27T12:00:00.000Z',
            created_at_epoch: 1745755200000,
          }],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (href.includes('/api/summaries?')) {
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    assert.strictEqual(git(cwd, ['init']).status, 0);
    assert.strictEqual(git(cwd, ['config', 'user.email', 'test@example.com']).status, 0);
    assert.strictEqual(git(cwd, ['config', 'user.name', 'Test User']).status, 0);
    assert.strictEqual(git(cwd, ['add', '.']).status, 0);
    assert.strictEqual(git(cwd, ['commit', '-m', 'baseline']).status, 0);

    const beforeFiles = snapshotFiles(cwd);
    const beforeHead = git(cwd, ['rev-parse', 'HEAD']).stdout.trim();
    const captured = captureConsole();

    try {
      await withCwd(cwd, async () => {
        await ingest({ dryRun: true });
      });
    } finally {
      captured.restore();
    }

    const stdout = captured.stdout.join('\n');
    const stderr = captured.stderr.join('\n');
    const afterFiles = snapshotFiles(cwd);
    const afterHead = git(cwd, ['rev-parse', 'HEAD']).stdout.trim();
    const worktreeStatus = git(cwd, ['status', '--short']).stdout.trim();

    assert.match(stdout, /=== DRY RUN ===/);
    assert.match(stdout, /Observation types:/);
    assert.match(stdout, /discovery: 1/);
    assert.match(stdout, /No LLM call made — no changes written\./);
    assert.doesNotMatch(stderr, /No API key found/);
    assert.deepStrictEqual(afterFiles, beforeFiles);
    assert.strictEqual(afterHead, beforeHead);
    assert.strictEqual(worktreeStatus, '');
  });

  it('still requires the claude-mem worker to be reachable', async () => {
    const cwd = makeTempProject();
    const homeDir = makeTempHome();
    setTempHome(homeDir);

    await withCwd(cwd, async () => {
      await install({ global: false });
    });

    const configPath = path.join(cwd, '.memwiki', 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      ...DEFAULT_MEMWIKI_CONFIG,
      claudeMemUrl: 'http://127.0.0.1:9',
    }, null, 2));

    globalThis.fetch = (async () => {
      throw new Error('connect ECONNREFUSED');
    }) as typeof fetch;

    const captured = captureConsole();
    process.exit = ((code?: number) => {
      throw new Error(`EXIT:${code ?? 0}`);
    }) as typeof process.exit;

    await assert.rejects(
      () => withCwd(cwd, async () => ingest({ dryRun: true })),
      /EXIT:1/,
    );

    const stderr = captured.stderr.join('\n');
    captured.restore();

    assert.match(stderr, /claude-mem worker not reachable/);
  });
});
