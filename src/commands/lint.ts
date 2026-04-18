import * as fs from 'node:fs';
import * as path from 'node:path';
import { WikiStore, WikiPage, WikiFrontmatter } from '../wiki/store.js';
import { isValidSlug, typeFromPath, slugFromPath } from '../wiki/slug.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LintError {
  page: string;
  rule: 'broken_link' | 'invalid_frontmatter' | 'invalid_slug';
  detail: string;
}

interface LintWarning {
  page: string;
  rule: 'orphan' | 'fuzzy_duplicate' | 'stale';
  detail: string;
}

interface LintResult {
  errors: LintError[];
  warnings: LintWarning[];
  stats: { total: number; by_type: Record<string, number> };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 1; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] !== b[j - 1] ? 1 : 0),
      );
  return dp[m][n];
}

/** Extract wikilink targets like `entities/foo` from `[[entities/foo]]` or `[[entities/foo|Display]]` */
function extractWikilinks(body: string): string[] {
  const re = /\[\[([^\]|]+)/g;
  const targets: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    targets.push(match[1].trim());
  }
  return targets;
}

/** Resolve a wikilink target to a slug path that WikiStore.list() would return */
function resolveLinkTarget(target: string): string {
  // If it already looks like "entities/foo" or "entities/foo.md", use as-is (normalise .md)
  if (target.includes('/')) {
    return target.endsWith('.md') ? target : `${target}.md`;
  }
  // Bare slug — could be in any directory; we'll check existence later
  return target;
}

/** Simple frontmatter validation without zod. Checks required fields and types. */
function validateFrontmatter(slug: string, fm: any, pageType: string): LintError[] {
  const errors: LintError[] = [];

  const required: Array<keyof WikiFrontmatter> = [
    'id', 'type', 'title', 'slug', 'created_at', 'updated_at',
  ];

  for (const field of required) {
    if (fm[field] === undefined || fm[field] === null || fm[field] === '') {
      errors.push({
        page: slug,
        rule: 'invalid_frontmatter',
        detail: `missing required field: ${field}`,
      });
    }
  }

  const validTypes = ['entity', 'topic', 'decision', 'session', 'skill'];
  if (fm.type && !validTypes.includes(fm.type)) {
    errors.push({
      page: slug,
      rule: 'invalid_frontmatter',
      detail: `invalid type "${fm.type}", expected one of: ${validTypes.join(', ')}`,
    });
  }

  // Check type matches path directory
  if (fm.type && pageType !== fm.type) {
    errors.push({
      page: slug,
      rule: 'invalid_frontmatter',
      detail: `frontmatter type "${fm.type}" doesn't match path directory (expected "${pageType}")`,
    });
  }

  if (fm.confidence !== undefined && (typeof fm.confidence !== 'number' || fm.confidence < 0 || fm.confidence > 1)) {
    errors.push({
      page: slug,
      rule: 'invalid_frontmatter',
      detail: `confidence must be a number between 0 and 1, got: ${fm.confidence}`,
    });
  }

  const validAuthoredBy = ['human', 'memwiki', 'mixed'];
  if (fm.authored_by && !validAuthoredBy.includes(fm.authored_by)) {
    errors.push({
      page: slug,
      rule: 'invalid_frontmatter',
      detail: `invalid authored_by "${fm.authored_by}"`,
    });
  }

  // Entity-specific checks
  if (fm.type === 'entity') {
    const validKinds = ['person', 'service', 'repo', 'api', 'tool', 'unknown'];
    if (fm.kind && !validKinds.includes(fm.kind)) {
      errors.push({
        page: slug,
        rule: 'invalid_frontmatter',
        detail: `invalid entity kind "${fm.kind}"`,
      });
    }
    const validStatuses = ['active', 'archived', 'unknown'];
    if (fm.status && !validStatuses.includes(fm.status)) {
      errors.push({
        page: slug,
        rule: 'invalid_frontmatter',
        detail: `invalid entity status "${fm.status}"`,
      });
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Main lint function
// ---------------------------------------------------------------------------

export async function lint(opts: { fix?: boolean; json?: boolean }): Promise<void> {
  const cwd = process.cwd();
  const wikiRoot = path.join(cwd, 'wiki');
  const metaDir = path.join(cwd, '.memwiki');

  // 1. Find wiki root
  if (!fs.existsSync(wikiRoot) || !fs.existsSync(metaDir)) {
    console.error('Error: memwiki not initialized. No wiki/ or .memwiki/ found in current directory.');
    console.error('Run "memwiki install" first or cd into a memwiki project.');
    process.exit(1);
  }

  const store = new WikiStore(wikiRoot);

  // 2. Load all pages
  const allSlugs = store.list();
  const pages: WikiPage[] = [];
  for (const slug of allSlugs) {
    const page = store.read(slug);
    if (page) pages.push(page);
  }

  // Build stats
  const byType: Record<string, number> = {};
  for (const page of pages) {
    const t = page.frontmatter.type || typeFromPath(page.path);
    byType[t] = (byType[t] || 0) + 1;
  }

  const result: LintResult = {
    errors: [],
    warnings: [],
    stats: { total: pages.length, by_type: byType },
  };

  // Build set of known slugs for link resolution
  const knownSlugs = new Set(allSlugs);
  // Also build a map of bare slug -> full path for bare link resolution
  const bareSlugMap = new Map<string, string>();
  for (const s of allSlugs) {
    bareSlugMap.set(slugFromPath(s), s);
  }

  // Track incoming links for orphan detection
  const incomingLinks = new Map<string, Set<string>>();

  // Fixes to apply
  const fixes: Array<{ page: string; description: string }> = [];

  // 3. Validate each page
  // Track original paths for pages that get renamed
  const renamedFrom = new Map<string, string>(); // newPath -> originalPath

  for (const page of pages) {
    const fm = page.frontmatter;
    const pagePath = page.path;
    const pageType = typeFromPath(pagePath);
    const originalPath = pagePath;

    // 3a. Slug validity
    const fileSlug = slugFromPath(pagePath);
    if (!isValidSlug(fileSlug)) {
      result.errors.push({
        page: pagePath,
        rule: 'invalid_slug',
        detail: `slug "${fileSlug}" is not a valid kebab-case slug`,
      });
      // --fix: rename to valid slug if possible
      if (opts.fix) {
        const normalised = fileSlug
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 80);
        if (normalised && isValidSlug(normalised) && normalised !== fileSlug) {
          const dir = pagePath.split('/').slice(0, -1).join('/');
          const newPath = `${dir}/${normalised}.md`;
          if (!knownSlugs.has(newPath)) {
            fm.slug = normalised;
            page.path = newPath;
            renamedFrom.set(newPath, originalPath);
            fixes.push({ page: originalPath, description: `renamed slug "${fileSlug}" -> "${normalised}"` });
          }
        }
      }
    }

    // 3b. Slug / path mismatch
    if (fm.slug && fm.slug !== fileSlug) {
      result.errors.push({
        page: pagePath,
        rule: 'invalid_slug',
        detail: `frontmatter slug "${fm.slug}" doesn't match filename "${fileSlug}"`,
      });
    }

    // 3c. Frontmatter validation
    const fmErrors = validateFrontmatter(pagePath, fm, pageType);
    result.errors.push(...fmErrors);

    // 3d. Extract and validate wikilinks
    const links = extractWikilinks(page.body);
    for (const target of links) {
      const resolved = resolveLinkTarget(target);
      // Check full path first
      let found = knownSlugs.has(resolved) || knownSlugs.has(resolved.replace(/\.md$/, ''));
      // Try bare slug resolution
      if (!found) {
        const barePart = resolved.includes('/') ? resolved.split('/').pop()! : resolved;
        const bareClean = barePart.replace(/\.md$/, '');
        found = bareSlugMap.has(bareClean);
      }

      if (!found) {
        result.errors.push({
          page: pagePath,
          rule: 'broken_link',
          detail: `wikilink target "[[${target}]]" does not correspond to an existing page`,
        });
      }

      // Track incoming links
      const resolvedClean = resolved.replace(/\.md$/, '');
      if (!incomingLinks.has(resolvedClean)) {
        incomingLinks.set(resolvedClean, new Set());
      }
      incomingLinks.get(resolvedClean)!.add(pagePath);
    }
  }

  // 4. Orphan detection
  for (const page of pages) {
    const pagePathClean = page.path.replace(/\.md$/, '');
    const hasIncoming = incomingLinks.has(pagePathClean) && incomingLinks.get(pagePathClean)!.size > 0;
    if (!hasIncoming) {
      result.warnings.push({
        page: page.path,
        rule: 'orphan',
        detail: 'no incoming wikilinks from other pages',
      });
    }
  }

  // 5. Fuzzy duplicate detection (within same type)
  const pagesByType = new Map<string, WikiPage[]>();
  for (const page of pages) {
    const t = page.frontmatter.type || typeFromPath(page.path);
    if (!pagesByType.has(t)) pagesByType.set(t, []);
    pagesByType.get(t)!.push(page);
  }

  const duplicatePairs = new Set<string>();
  for (const [type, typePages] of pagesByType) {
    for (let i = 0; i < typePages.length; i++) {
      for (let j = i + 1; j < typePages.length; j++) {
        const a = typePages[i];
        const b = typePages[j];
        const titleA = (a.frontmatter.title || '').toLowerCase();
        const titleB = (b.frontmatter.title || '').toLowerCase();
        if (!titleA || !titleB) continue;
        const dist = levenshtein(titleA, titleB);
        if (dist < 3 && dist > 0) {
          // Avoid duplicate warnings for same pair
          const pairKey = [a.path, b.path].sort().join('|');
          if (!duplicatePairs.has(pairKey)) {
            duplicatePairs.add(pairKey);
            result.warnings.push({
              page: a.path,
              rule: 'fuzzy_duplicate',
              detail: `title "${a.frontmatter.title}" is similar to "${b.frontmatter.title}" on ${b.path} (distance: ${dist})`,
            });
            result.warnings.push({
              page: b.path,
              rule: 'fuzzy_duplicate',
              detail: `title "${b.frontmatter.title}" is similar to "${a.frontmatter.title}" on ${a.path} (distance: ${dist})`,
            });
          }
        }
      }
    }
  }

  // 6. Stale pages (updated_at > 90 days ago and confidence < 0.5)
  const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
  for (const page of pages) {
    const fm = page.frontmatter;
    const updatedAt = new Date(fm.updated_at || fm.created_at).getTime();
    const confidence = fm.confidence ?? 1;
    if (updatedAt < ninetyDaysAgo && confidence < 0.5) {
      const daysSince = Math.floor((Date.now() - updatedAt) / (24 * 60 * 60 * 1000));
      result.warnings.push({
        page: page.path,
        rule: 'stale',
        detail: `last updated ${daysSince} days ago with confidence ${confidence.toFixed(2)} (< 0.5)`,
      });
    }
  }

  // 7. Apply fixes if --fix
  if (opts.fix) {
    const validKinds = ['person', 'service', 'repo', 'api', 'tool', 'unknown'];

    // Apply ALL fixes to in-memory page objects FIRST, then write once
    for (const err of result.errors) {
      // Fix: remove broken links from page bodies
      if (err.rule === 'broken_link') {
        // Use renamedFrom to find the page even if it was renamed
        const page = pages.find(p => p.path === err.page || renamedFrom.get(p.path) === err.page);
        if (!page) continue;
        const targetMatch = err.detail.match(/\[\[([^\]]+)\]\]/);
        if (!targetMatch) continue;
        const linkTarget = targetMatch[1];
        // Remove [[target]] and [[target|Display]] variants
        const escapedTarget = linkTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        page.body = page.body.replace(new RegExp(`\\[\\[${escapedTarget}(\\|[^\\]]+)?\\]\\]`, 'g'), '');
        fixes.push({ page: err.page, description: `removed broken link [[${linkTarget}]]` });
      }

      // Fix: normalize invalid entity kinds to 'unknown'
      if (err.rule === 'invalid_frontmatter') {
        const page = pages.find(p => p.path === err.page || renamedFrom.get(p.path) === err.page);
        if (!page) continue;
        const fm = page.frontmatter as any;
        if (fm.kind && !validKinds.includes(fm.kind)) {
          const oldKind = fm.kind;
          fm.kind = 'unknown';
          fixes.push({ page: err.page, description: `normalized kind '${oldKind}' -> 'unknown'` });
        }
      }
    }

    // Remove fixed errors from result
    result.errors = result.errors.filter(err => {
      if (err.rule === 'broken_link') return false; // was fixed
      if (err.rule === 'invalid_frontmatter' && fixes.some(f => f.page === err.page && f.description.includes('normalized kind'))) return false;
      return true;
    });

    // Write modified pages (all fixes already applied in-memory)
    for (const page of pages) {
      store.write(page);
    }

    // Delete original files for renamed pages to avoid duplicates
    for (const [newPath, originalPath] of renamedFrom) {
      if (originalPath !== newPath) {
        store.delete(originalPath);
      }
    }
  }

  // 8. Output
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    // Formatted report
    console.log('');
    console.log(`=== memwiki lint report ===`);
    console.log(`Total pages: ${result.stats.total}`);
    for (const [type, count] of Object.entries(result.stats.by_type)) {
      console.log(`  ${type}: ${count}`);
    }
    console.log('');

    if (result.errors.length > 0) {
      console.log(`--- Errors (${result.errors.length}) ---`);
      for (const err of result.errors) {
        console.log(`  [${err.rule}] ${err.page}: ${err.detail}`);
      }
      console.log('');
    }

    if (result.warnings.length > 0) {
      console.log(`--- Warnings (${result.warnings.length}) ---`);
      for (const warn of result.warnings) {
        console.log(`  [${warn.rule}] ${warn.page}: ${warn.detail}`);
      }
      console.log('');
    }

    if (fixes.length > 0) {
      console.log(`--- Fixes Applied (${fixes.length}) ---`);
      for (const fix of fixes) {
        console.log(`  ${fix.page}: ${fix.description}`);
      }
      console.log('');
    }

    if (result.errors.length === 0 && result.warnings.length === 0) {
      console.log('All checks passed. Wiki is clean.');
    }

    console.log('');
    console.log(`${result.errors.length} error(s), ${result.warnings.length} warning(s)`);
  }

  // Exit code
  if (result.errors.length > 0) {
    process.exit(1);
  }
}
