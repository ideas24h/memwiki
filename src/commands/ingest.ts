import * as fs from 'node:fs';
import * as path from 'node:path';
import { ClaudeMemClient } from '../clients/claude-mem.js';
import { WikiStore } from '../wiki/store.js';
import { LLMProvider } from '../llm/provider.js';
import { commitWiki } from '../git/commit.js';

const INGEST_PROMPT = `You are a wiki editor. Given observations from coding sessions and the current wiki state, output wiki page updates as JSON.

PAGE TYPES (path determines type):
- entities/<slug>.md — repos, services, APIs, tools, people
- sessions/<slug>.md — session summaries
- decisions/<slug>.md — ADR-lite decisions

ENTITY FRONTMATTER (required fields):
{
  "type": "entity",
  "kind": "person|service|repo|api|tool",
  "title": "Human-readable name",
  "slug": "kebab-case-slug",
  "aliases": ["alternative names"],
  "identifiers": {"github": "...", "url": "..."},
  "status": "active|archived|unknown",
  "sources": [1, 2],
  "confidence": 0.8
}

SESSION FRONTMATTER:
{
  "type": "session",
  "memory_session_id": "from observation",
  "files_modified": ["path/to/file"],
  "sources": [1, 2],
  "confidence": 0.9
}

RULES:
- Never invent data, URLs, emails, or identifiers
- Ambiguous entity -> stub with confidence 0.3, kind "unknown"
- Slug: lowercase, hyphens, no special chars
- Body: markdown with ## headings, use [[entities/slug|Name]] for cross-refs
- Preserve facts from observations faithfully
- Group related observations into the same entity

OUTPUT (JSON only, no markdown):
{
  "pages": [{"path": "entities/slug.md", "frontmatter": {...}, "body": "md", "action": "create|update"}],
  "new_aliases": {"alias": "slug"},
  "summary": "what was processed"
}`;

export async function ingest(opts: {
  project?: string;
  dryRun?: boolean;
  verbose?: boolean;
  since?: string;
}): Promise<void> {
  const cwd = process.cwd();
  const wikiRoot = path.join(cwd, 'wiki');
  const metaDir = path.join(cwd, '.memwiki');
  const configPath = path.join(metaDir, 'config.json');
  const statePath = path.join(metaDir, 'state.json');

  // Check wiki exists
  if (!fs.existsSync(metaDir)) {
    console.error('Error: memwiki not initialized. Run "memwiki install" first.');
    process.exit(1);
  }

  // Load config and state
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
  const sinceEpoch = opts.since ? parseInt(opts.since) : state.last_ingested_epoch;

  // Connect to claude-mem
  const memClient = new ClaudeMemClient({ baseUrl: config.claudeMemUrl });
  const health = await memClient.health();
  if (!health.ok) {
    console.error('Error: claude-mem worker not reachable at ' + config.claudeMemUrl);
    console.error('Make sure claude-mem is installed and the worker is running.');
    process.exit(1);
  }

  if (opts.verbose) console.log(`Connected to claude-mem v${health.version}`);

  // Fetch new observations
  const observations = await memClient.getObservationsSince(sinceEpoch, opts.project);
  if (observations.length === 0) {
    console.log('No new observations to ingest.');
    return;
  }

  if (opts.verbose) console.log(`Found ${observations.length} new observations since ${new Date(sinceEpoch).toISOString()}`);

  // Fetch recent summaries for context
  const summaries = await memClient.getSummaries({ limit: 5, project: opts.project });

  // Load current wiki state
  const store = new WikiStore(wikiRoot);
  const existingSlugs = store.list();
  const aliases = store.getAliases();

  // Build context for LLM
  const wikiContext = {
    existing_pages: existingSlugs,
    aliases: Object.fromEntries(aliases),
    recent_summaries: summaries.map(s => ({
      id: s.id,
      request: s.request,
      learned: s.learned,
      completed: s.completed,
    })),
  };

  // Prepare observations for LLM (use narrative if available, fallback to text)
  const obsData = observations.map(o => ({
    id: o.id,
    type: o.type,
    title: o.title || o.text?.slice(0, 100),
    subtitle: o.subtitle,
    narrative: o.narrative || o.text,
    facts: o.facts ? JSON.parse(o.facts) : undefined,
    concepts: o.concepts ? JSON.parse(o.concepts) : undefined,
    files_read: o.files_read ? JSON.parse(o.files_read) : undefined,
    files_modified: o.files_modified ? JSON.parse(o.files_modified) : undefined,
    project: o.project,
    created_at: o.created_at,
  }));

  // Call LLM
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('Error: OPENROUTER_API_KEY environment variable not set.');
    console.error('Set it with: export OPENROUTER_API_KEY=your-key');
    process.exit(1);
  }

  const llm = new LLMProvider({ apiKey, model: config.model, baseUrl: config.baseUrl });

  if (opts.verbose) console.log('Calling LLM to canonize observations...');

  const result = await llm.chatJSON<{
    pages: Array<{
      path: string;
      frontmatter: any;
      body: string;
      action: string;
    }>;
    new_aliases: Record<string, string>;
    summary: string;
  }>([
    { role: 'system', content: INGEST_PROMPT },
    {
      role: 'user',
      content: `## Current Wiki State\n\`\`\`json\n${JSON.stringify(wikiContext, null, 2)}\n\`\`\`\n\n## New Observations\n\`\`\`json\n${JSON.stringify(obsData, null, 2)}\n\`\`\`\n\nProcess these observations and return wiki updates as JSON.`,
    },
  ]);

  if (opts.dryRun) {
    console.log('=== DRY RUN ===');
    console.log(`Would create/update ${result.pages.length} pages`);
    for (const page of result.pages) {
      console.log(`  ${page.action}: ${page.path}`);
    }
    console.log(`\nSummary: ${result.summary}`);
    return;
  }

  // Write pages
  for (const page of result.pages) {
    const fm = page.frontmatter;
    // Ensure required schema fields
    if (!fm.id) fm.id = crypto.randomUUID();
    if (!fm.type) {
      // Infer type from path
      if (page.path.startsWith('entities/')) fm.type = 'entity';
      else if (page.path.startsWith('sessions/')) fm.type = 'session';
      else if (page.path.startsWith('decisions/')) fm.type = 'decision';
      else fm.type = 'entity';
    }
    if (!fm.slug) {
      fm.slug = page.path.replace(/\.md$/, '').split('/').pop() || 'unknown';
    }
    if (fm.type === 'entity' && !fm.kind) fm.kind = 'unknown';
    if (fm.type === 'entity' && !fm.status) fm.status = 'active';
    if (fm.type === 'entity' && !fm.identifiers) fm.identifiers = {};
    if (!fm.title) fm.title = fm.slug || page.path;
    if (!fm.aliases) fm.aliases = [];
    if (!fm.created_at) fm.created_at = new Date().toISOString();
    fm.updated_at = new Date().toISOString();
    fm.schema_version = 1;
    if (!fm.authored_by) fm.authored_by = 'memwiki';
    if (!fm.confidence) fm.confidence = 0.7;
    if (!fm.sources) fm.sources = observations.map(o => o.id);
    if (!fm.related) fm.related = [];

    store.write({
      path: page.path,
      frontmatter: fm,
      body: page.body,
    });

    if (opts.verbose) console.log(`  ${page.action}: ${page.path}`);
  }

  // Update aliases
  if (result.new_aliases && Object.keys(result.new_aliases).length > 0) {
    const currentAliases = store.getAliases();
    for (const [alias, slug] of Object.entries(result.new_aliases)) {
      currentAliases.set(alias, slug);
    }
    store.saveAliases(currentAliases);
  }

  // Update state
  const maxEpoch = Math.max(...observations.map(o => o.created_at_epoch));
  state.last_ingested_epoch = maxEpoch;
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');

  // Append to log
  store.appendLog(`Ingested ${observations.length} observations -> ${result.pages.length} pages`);

  // Git commit
  try {
    await commitWiki(`ingest ${observations.length} observations`, cwd);
    if (opts.verbose) console.log('Committed changes to git.');
  } catch (err: any) {
    if (opts.verbose) console.log(`Git commit skipped: ${err.message}`);
  }

  console.log(`Ingested ${observations.length} observations into ${result.pages.length} wiki pages.`);
  console.log(`Summary: ${result.summary}`);
}
