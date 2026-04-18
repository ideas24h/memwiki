import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadRegistry, saveRegistry, type ProjectsRegistry } from './register.js';
import { ingest } from './ingest.js';

interface IngestResult {
  project: string;
  success: boolean;
  pagesCreated: number;
  error?: string;
}

function countPages(wikiRoot: string): number {
  if (!fs.existsSync(wikiRoot)) return 0;
  let count = 0;
  const dirs = ['entities', 'topics', 'decisions', 'sessions', 'skills'];
  for (const dir of dirs) {
    const dirPath = path.join(wikiRoot, dir);
    if (!fs.existsSync(dirPath)) continue;
    const files = fs.readdirSync(dirPath);
    count += files.filter(f => f.endsWith('.md')).length;
  }
  return count;
}

export async function ingestAll(opts: { verbose?: boolean }): Promise<void> {
  const registry = loadRegistry();
  const projectNames = Object.keys(registry.projects);

  if (projectNames.length === 0) {
    console.log('No projects registered. Run "memwiki register" first.');
    return;
  }

  console.log(`Ingesting ${projectNames.length} registered project(s)...\n`);

  const results: IngestResult[] = [];
  let totalPages = 0;
  let totalErrors = 0;

  for (const name of projectNames) {
    const entry = registry.projects[name];
    const projectPath = entry.path;

    // Verify project path still exists
    if (!fs.existsSync(projectPath)) {
      console.log(`  [SKIP] ${name}: path ${projectPath} does not exist`);
      results.push({ project: name, success: false, pagesCreated: 0, error: 'Path not found' });
      totalErrors++;
      continue;
    }

    // Verify wiki is initialized
    const metaDir = path.join(projectPath, '.memwiki');
    if (!fs.existsSync(metaDir)) {
      console.log(`  [SKIP] ${name}: wiki not initialized at ${projectPath}`);
      results.push({ project: name, success: false, pagesCreated: 0, error: 'Wiki not initialized' });
      totalErrors++;
      continue;
    }

    const pagesBefore = countPages(path.join(projectPath, 'wiki'));

    if (opts.verbose) {
      console.log(`  [INGEST] ${name} (${projectPath})`);
    }

    // Change to project directory and run ingest
    const originalCwd = process.cwd();
    try {
      process.chdir(projectPath);

      // Capture console output to count pages
      let output = '';
      const origLog = console.log;
      if (!opts.verbose) {
        console.log = (...args: any[]) => {
          output += args.join(' ') + '\n';
        };
      }

      await ingest({ verbose: opts.verbose });

      if (!opts.verbose) {
        console.log = origLog;
      }

      const pagesAfter = countPages(path.join(projectPath, 'wiki'));
      const pagesCreated = Math.max(0, pagesAfter - pagesBefore);
      totalPages += pagesCreated;

      // Update registry entry
      registry.projects[name].last_ingest = new Date().toISOString();
      registry.projects[name].pages_count = pagesAfter;

      results.push({ project: name, success: true, pagesCreated });
      if (opts.verbose) {
        console.log(`  [OK] ${name}: ${pagesCreated} new pages (${pagesAfter} total)`);
      } else {
        console.log(`  ${name}: ${pagesCreated} new page(s)`);
      }
    } catch (err: any) {
      console.error(`  [ERROR] ${name}: ${err.message}`);
      results.push({ project: name, success: false, pagesCreated: 0, error: err.message });
      totalErrors++;
    } finally {
      process.chdir(originalCwd);
    }
  }

  // Save updated registry
  saveRegistry(registry);

  // Print summary
  const successCount = results.filter(r => r.success).length;
  console.log('');
  console.log('=== Ingest Summary ===');
  console.log(`Projects processed: ${successCount}/${projectNames.length}`);
  console.log(`New pages created: ${totalPages}`);
  if (totalErrors > 0) {
    console.log(`Errors: ${totalErrors}`);
  }
}
