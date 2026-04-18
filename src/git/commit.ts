import { execSync } from 'node:child_process';

export async function commitWiki(message: string, projectRoot: string): Promise<void> {
  // Check if git repo
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd: projectRoot, stdio: 'pipe' });
  } catch {
    return; // Not a git repo, skip silently
  }

  // Ensure there's a user configured (needed for fresh repos)
  try {
    execSync('git config user.name', { cwd: projectRoot, stdio: 'pipe' });
  } catch {
    execSync('git config user.name memwiki', { cwd: projectRoot, stdio: 'pipe' });
    execSync('git config user.email memwiki@local', { cwd: projectRoot, stdio: 'pipe' });
  }

  // Stage wiki/ (and .memwiki/ if not gitignored)
  try {
    execSync('git add wiki/', { cwd: projectRoot, stdio: 'pipe' });
  } catch {
    return;
  }
  // .memwiki/ is optional (may be in .gitignore)
  try {
    execSync('git add .memwiki/', { cwd: projectRoot, stdio: 'pipe' });
  } catch {
    // Ignore — likely gitignored
  }

  // Check if there are staged changes to commit
  try {
    const diff = execSync('git diff --cached --name-only', { cwd: projectRoot, encoding: 'utf-8' });
    if (!diff.trim()) return; // Nothing staged
  } catch {
    return;
  }

  // Commit
  execSync(`git commit -m "memwiki: ${message}" --author="memwiki <memwiki@local>"`, {
    cwd: projectRoot,
    stdio: 'pipe',
  });
}
