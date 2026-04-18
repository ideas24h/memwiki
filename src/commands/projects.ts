import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadRegistry } from './register.js';

export async function projects(opts: { json?: boolean }): Promise<void> {
  const registry = loadRegistry();
  const projectNames = Object.keys(registry.projects);

  if (projectNames.length === 0) {
    console.log('No projects registered.');
    console.log('Run "memwiki register [path]" to register a project.');
    return;
  }

  if (opts.json) {
    console.log(JSON.stringify(registry, null, 2));
    return;
  }

  console.log(`Registered projects (${projectNames.length}):\n`);

  // Calculate column widths
  const rows = projectNames.map(name => {
    const entry = registry.projects[name];
    const exists = fs.existsSync(entry.path);
    const hasWiki = fs.existsSync(path.join(entry.path, '.memwiki'));
    const status = !exists ? 'MISSING' : !hasWiki ? 'NO-WIKI' : 'OK';
    const lastIngest = entry.last_ingest
      ? formatRelativeTime(new Date(entry.last_ingest))
      : 'never';

    return {
      name,
      status,
      pages: entry.pages_count,
      lastIngest,
      path: entry.path,
    };
  });

  // Print table
  const nameWidth = Math.max(4, ...rows.map(r => r.name.length));
  const statusWidth = Math.max(6, ...rows.map(r => r.status.length));
  const pagesWidth = Math.max(5, ...rows.map(r => String(r.pages).length));
  const lastWidth = Math.max(10, ...rows.map(r => r.lastIngest.length));

  const header = `  ${'Name'.padEnd(nameWidth)}  ${'Status'.padEnd(statusWidth)}  ${'Pages'.padEnd(pagesWidth)}  ${'Last Ingest'.padEnd(lastWidth)}  Path`;
  console.log(header);
  console.log('  ' + '-'.repeat(header.length - 2));

  for (const row of rows) {
    const statusIcon = row.status === 'OK' ? '✓' : row.status === 'MISSING' ? '✗' : '⚠';
    console.log(
      `${statusIcon} ${row.name.padEnd(nameWidth)}  ${row.status.padEnd(statusWidth)}  ${String(row.pages).padEnd(pagesWidth)}  ${row.lastIngest.padEnd(lastWidth)}  ${row.path}`
    );
  }

  console.log('');
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toISOString().split('T')[0];
}
