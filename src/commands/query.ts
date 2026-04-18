import * as path from 'node:path';
import * as fs from 'node:fs';
import { WikiStore, WikiPage } from '../wiki/store.js';

export interface QueryOptions {
  type?: string;
  limit?: string;
  json?: boolean;
}

export interface QueryResult {
  slug: string;
  title: string;
  type: string;
  score: number;
  snippet: string;
}

/**
 * Simple case-insensitive text search across wiki pages.
 * Scores by counting occurrences of query terms in title + body.
 */
function scorePage(page: WikiPage, terms: string[]): number {
  const title = page.frontmatter.title.toLowerCase();
  const body = page.body.toLowerCase();
  let score = 0;
  for (const term of terms) {
    const t = term.toLowerCase();
    // Title matches worth 10x
    let idx = -1;
    while ((idx = title.indexOf(t, idx + 1)) !== -1) score += 10;
    // Body matches
    idx = -1;
    while ((idx = body.indexOf(t, idx + 1)) !== -1) score += 1;
  }
  return score;
}

function makeSnippet(body: string, terms: string[], maxLen = 160): string {
  const lower = body.toLowerCase();
  // Find first occurrence of any term
  let bestPos = 0;
  for (const term of terms) {
    const idx = lower.indexOf(term.toLowerCase());
    if (idx !== -1) {
      bestPos = idx;
      break;
    }
  }
  const start = Math.max(0, bestPos - 40);
  const end = Math.min(body.length, start + maxLen);
  let snippet = body.slice(start, end).replace(/\n/g, ' ').trim();
  if (start > 0) snippet = '...' + snippet;
  if (end < body.length) snippet = snippet + '...';
  return snippet;
}

export async function query(queryStr: string, opts: QueryOptions): Promise<void> {
  const wikiRoot = path.join(process.cwd(), 'wiki');
  if (!fs.existsSync(wikiRoot)) {
    console.log('No wiki found. Run "memwiki install" first.');
    return;
  }

  const store = new WikiStore(wikiRoot);
  const limit = parseInt(opts.limit || '10');
  const terms = queryStr.split(/\s+/).filter(Boolean);

  if (terms.length === 0) {
    console.log('Empty query.');
    return;
  }

  // List all slugs, optionally filtered by type
  const slugs = store.list(opts.type);
  const results: QueryResult[] = [];

  for (const slug of slugs) {
    const page = store.read(slug);
    if (!page) continue;
    const score = scorePage(page, terms);
    if (score === 0) continue;
    results.push({
      slug,
      title: page.frontmatter.title,
      type: page.frontmatter.type,
      score,
      snippet: makeSnippet(page.body, terms),
    });
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);
  const top = results.slice(0, limit);

  if (opts.json) {
    console.log(JSON.stringify(top, null, 2));
    return;
  }

  if (top.length === 0) {
    console.log(`No results for "${queryStr}".`);
    return;
  }

  console.log(`Found ${results.length} result(s), showing top ${top.length}:\n`);
  for (const r of top) {
    console.log(`  [${r.type}] ${r.title} (${r.slug})`);
    console.log(`    ${r.snippet}`);
    console.log(`    score: ${r.score}`);
    console.log();
  }
}
