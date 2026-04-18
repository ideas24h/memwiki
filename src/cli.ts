#!/usr/bin/env node
import { Command } from 'commander';
import { install } from './commands/install.js';
import { ingest } from './commands/ingest.js';
import { showContext } from './commands/context.js';
import { lint } from './commands/lint.js';
import { daemon } from './commands/daemon.js';
import { query } from './commands/query.js';
import { register } from './commands/register.js';
import { ingestAll } from './commands/ingest-all.js';
import { projects } from './commands/projects.js';
import { startMcpServer } from './mcp/server.js';

const program = new Command()
  .name('memwiki')
  .description('Persistent wiki memory for AI coding sessions')
  .version('0.1.0');

program.command('install')
  .description('Initialize wiki/ in current project')
  .option('--global', 'Use ~/.memwiki/ instead of ./wiki/')
  .action(async (opts) => {
    await install(opts);
  });

program.command('ingest')
  .description('Promote claude-mem observations into wiki pages')
  .option('--project <name>', 'Filter by project name')
  .option('--dry-run', 'Show what would change without writing')
  .option('--verbose', 'Show detailed output')
  .option('--since <epoch>', 'Only process observations since epoch ms')
  .action(async (opts) => {
    await ingest(opts);
  });

program.command('context')
  .description('Output wiki context for session start')
  .option('--project <name>', 'Filter by project')
  .option('--max-tokens <n>', 'Max tokens to output', '2000')
  .action(async (opts) => {
    await showContext(opts);
  });

program.command('lint')
  .description('Check wiki health')
  .option('--fix', 'Auto-fix where possible')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    await lint(opts);
  });

program.command('query')
  .description('Search wiki pages')
  .argument('<query>', 'Search query')
  .option('--type <type>', 'Filter by page type')
  .option('--limit <n>', 'Max results', '10')
  .option('--json', 'Output as JSON')
  .action(async (queryStr, opts) => {
    await query(queryStr, opts);
  });

program.command('daemon')
  .description('Run background daemon that polls claude-mem')
  .option('--interval <ms>', 'Polling interval', '600000')
  .action(async (opts) => {
    await daemon(opts);
  });

program.command('mcp')
  .description('Run as MCP stdio server')
  .action(async () => {
    await startMcpServer();
  });

// Multi-repo commands
program.command('register')
  .description('Register a project for multi-repo management')
  .argument('[path]', 'Path to project (defaults to CWD)')
  .action(async (projectPath?: string) => {
    await register({ path: projectPath });
  });

program.command('ingest-all')
  .description('Ingest all registered projects')
  .option('--verbose', 'Show detailed output')
  .action(async (opts) => {
    await ingestAll(opts);
  });

program.command('projects')
  .description('List registered projects with status')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    await projects(opts);
  });

program.parse();
