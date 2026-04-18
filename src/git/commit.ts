import { execSync } from 'node:child_process';

export async function commitWiki(message: string, projectRoot: string): Promise<void> {
  // Check if git repo
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd: projectRoot, stdio: 'pipe' });
  } catch {
    return; // Not a git repo, skip silently
  }

  // Stage wiki and .memwiki
  try {
    execSync('git add wiki/ .memwiki/', { cwd: projectRoot, stdio: 'pipe' });
  } catch {
    return;
  }

  // Check if there are changes to commit
  try {
    const status = execSync('git status --porcelain wiki/ .memwiki/', { cwd: projectRoot, encoding: 'utf-8' });
    if (!status.trim()) return; // No changes
  } catch {
    return;
  }

  // Commit
  execSync(`git commit -m "memwiki: ${message}" --author="memwiki <memwiki@local>"`, {
    cwd: projectRoot,
    stdio: 'pipe',
  });
}
