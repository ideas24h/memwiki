import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_MEMWIKI_CONFIG } from '../config/defaults.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(__dirname, '..', 'cli.js');

function makeTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'memwiki-install-contract-'));
}

function makeTempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'memwiki-home-'));
}

function runCli(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}, homeDir = makeTempHome()) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd,
    env: {
      ...process.env,
      HOME: homeDir,
      USERDIR: homeDir,
      ...env,
    },
    encoding: 'utf-8',
  });
}

describe('install contract', () => {
  it('creates config.json with the shared default memwiki config', () => {
    const cwd = makeTempProject();
    const homeDir = makeTempHome();
    const result = runCli(['install'], cwd, {}, homeDir);

    assert.strictEqual(result.status, 0, result.stderr || result.stdout);

    const configPath = path.join(cwd, '.memwiki', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.deepStrictEqual(config, DEFAULT_MEMWIKI_CONFIG);
  });

  it('respects LLM_MODEL and LLM_BASE_URL overrides without changing provider defaults', () => {
    const cwd = makeTempProject();
    const homeDir = makeTempHome();
    const result = runCli(['install'], cwd, {
      HOME: homeDir,
      USERDIR: homeDir,
      LLM_MODEL: 'custom/test-model',
      LLM_BASE_URL: 'https://example.com/v1',
    }, homeDir);

    assert.strictEqual(result.status, 0, result.stderr || result.stdout);

    const configPath = path.join(cwd, '.memwiki', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    assert.deepStrictEqual(config, {
      ...DEFAULT_MEMWIKI_CONFIG,
      model: 'custom/test-model',
      baseUrl: 'https://example.com/v1',
    });
  });

  it('is idempotent for .gitignore and existing config', () => {
    const cwd = makeTempProject();
    const homeDir = makeTempHome();
    const first = runCli(['install'], cwd, {}, homeDir);
    assert.strictEqual(first.status, 0, first.stderr || first.stdout);

    const configPath = path.join(cwd, '.memwiki', 'config.json');
    const originalConfig = fs.readFileSync(configPath, 'utf-8');

    const second = runCli(['install'], cwd, {}, homeDir);
    assert.strictEqual(second.status, 0, second.stderr || second.stdout);

    const gitignore = fs.readFileSync(path.join(cwd, '.gitignore'), 'utf-8');
    const matches = gitignore.match(/^\.memwiki\/$/gm) ?? [];

    assert.strictEqual(fs.readFileSync(configPath, 'utf-8'), originalConfig);
    assert.strictEqual(matches.length, 1, gitignore);
  });
});
