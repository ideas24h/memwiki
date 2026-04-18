#!/usr/bin/env node
import { Command } from 'commander';
import { install } from './commands/install.js';
import { ingest } from './commands/ingest.js';
import { showContext } from './commands/context.js';
import { lint } from './commands/lint.js';

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
  .action(async (query, opts) => {
    console.log(`Query "${query}" not implemented yet (Phase 4)`);
  });

program.command('daemon')
  .description('Run background daemon that polls claude-mem')
  .option('--interval <ms>', 'Polling interval', '600000')
  .action(async (opts) => {
    console.log('Daemon not implemented yet (Phase 3)');
  });

program.command('mcp')
  .description('Run as MCP stdio server')
  .action(async () => {
    console.log('MCP server not implemented yet (Phase 4)');
  });

program.parse();
