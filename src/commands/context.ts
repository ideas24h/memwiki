import * as fs from 'node:fs';
import * as path from 'node:path';
import { WikiStore, WikiFrontmatter } from '../wiki/store.js';

export async function showContext(opts: {
  project?: string;
  maxTokens?: string;
}): Promise<void> {
  const wikiRoot = path.join(process.cwd(), 'wiki');
  const maxTokens = parseInt(opts.maxTokens || '2000');
  const maxChars = maxTokens * 4; // rough estimate

  if (!fs.existsSync(wikiRoot)) {
    console.log('No wiki found. Run "memwiki install" first.');
    return;
  }

  const store = new WikiStore(wikiRoot);
  const parts: string[] = [];

  // 1. Index
  const index = store.readIndex();
  if (index) {
    parts.push('=== WIKI INDEX ===');
    parts.push(index);
    parts.push('');
  }

  // 2. Recent sessions (last 5)
  const sessions = store.list('session').slice(-5);
  if (sessions.length > 0) {
    parts.push('=== RECENT SESSIONS ===');
    for (const slug of sessions) {
      const page = store.read(slug);
      if (page) {
        const fm = page.frontmatter as any;
        parts.push(`- ${fm.title || slug} (${fm.created_at?.split('T')[0] || 'unknown'})`);
        if (page.body) parts.push(`  ${page.body.split('\n')[0].slice(0, 120)}`);
      }
    }
    parts.push('');
  }

  // 3. Hot entities (updated in last 7 days, confidence > 0.7)
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const entities = store.list('entity');
  const hotEntities: string[] = [];
  for (const slug of entities) {
    const page = store.read(slug);
    if (!page) continue;
    const fm = page.frontmatter;
    const updated = new Date(fm.updated_at || fm.created_at).getTime();
    if (updated > sevenDaysAgo && (fm.confidence ?? 0) > 0.7) {
      hotEntities.push(`- [[${slug}|${fm.title}]] (${(fm as any).kind || 'entity'})`);
    }
  }
  if (hotEntities.length > 0) {
    parts.push('=== ACTIVE ENTITIES ===');
    parts.push(...hotEntities);
    parts.push('');
  }

  // Trim to maxChars
  const output = parts.join('\n');
  if (output.length > maxChars) {
    console.log(output.slice(0, maxChars) + '\n... (truncated)');
  } else {
    console.log(output);
  }
}
