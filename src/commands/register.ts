import * as fs from 'node:fs';
import * as path from 'node:path';
import { install } from './install.js';

const HOME = process.env.HOME || process.env.USERDIR || '~';

export interface ProjectEntry {
  path: string;
  registered_at: string;
  last_ingest: string | null;
  observations_count: number;
  pages_count: number;
}

export interface ProjectsRegistry {
  projects: Record<string, ProjectEntry>;
}

function getRegistryPath(): string {
  return path.join(HOME, '.memwiki', 'projects.json');
}

function getProjectsDir(): string {
  return path.join(HOME, '.memwiki', 'projects');
}

export function loadRegistry(): ProjectsRegistry {
  const registryPath = getRegistryPath();
  if (!fs.existsSync(registryPath)) {
    return { projects: {} };
  }
  return JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
}

export function saveRegistry(registry: ProjectsRegistry): void {
  const registryPath = getRegistryPath();
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf-8');
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

export async function register(opts: { path?: string }): Promise<void> {
  const projectPath = opts.path
    ? path.resolve(opts.path)
    : process.cwd();

  const name = path.basename(projectPath);

  console.log(`Registering project "${name}" at ${projectPath}...`);

  // Check if wiki/ and .memwiki/ exist
  const wikiDir = path.join(projectPath, 'wiki');
  const metaDir = path.join(projectPath, '.memwiki');
  const hasWiki = fs.existsSync(wikiDir);
  const hasMeta = fs.existsSync(metaDir);

  // If not initialized, run install first
  if (!hasWiki || !hasMeta) {
    console.log(`Wiki not found at ${projectPath}. Running install...`);
    const originalCwd = process.cwd();
    try {
      process.chdir(projectPath);
      await install({ global: false });
    } finally {
      process.chdir(originalCwd);
    }
  }

  // Load or create registry
  const registry = loadRegistry();

  // Check if already registered
  if (registry.projects[name]) {
    const existing = registry.projects[name];
    if (existing.path === projectPath) {
      console.log(`Project "${name}" is already registered.`);
      return;
    }
    // Same name but different path — warn and update
    console.log(`Updating project "${name}" path from ${existing.path} to ${projectPath}`);
  }

  // Add/update project entry
  registry.projects[name] = {
    path: projectPath,
    registered_at: registry.projects[name]?.registered_at || new Date().toISOString(),
    last_ingest: registry.projects[name]?.last_ingest || null,
    observations_count: registry.projects[name]?.observations_count || 0,
    pages_count: countPages(wikiDir),
  };

  // Save registry
  saveRegistry(registry);

  // Create symlink: ~/.memwiki/projects/<name> -> <project>/.memwiki/
  const projectsDir = getProjectsDir();
  const linkPath = path.join(projectsDir, name);
  const linkTarget = metaDir;

  fs.mkdirSync(projectsDir, { recursive: true });

  // Remove existing symlink/dir if present
  try {
    if (fs.existsSync(linkPath)) {
      const stat = fs.lstatSync(linkPath);
      if (stat.isSymbolicLink() || stat.isDirectory()) {
        fs.rmSync(linkPath, { force: true });
      }
    }
  } catch {
    // Path doesn't exist yet, that's fine
  }

  try {
    fs.symlinkSync(linkTarget, linkPath, 'dir');
    console.log(`Symlink created: ${linkPath} -> ${linkTarget}`);
  } catch (err: any) {
    console.warn(`Warning: Could not create symlink: ${err.message}`);
  }

  console.log(`Project "${name}" registered successfully.`);
  console.log(`  Path: ${projectPath}`);
  console.log(`  Pages: ${registry.projects[name].pages_count}`);
}
