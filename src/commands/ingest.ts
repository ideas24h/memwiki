import * as fs from 'node:fs';
import * as path from 'node:path';
import { ClaudeMemClient } from '../clients/claude-mem.js';
import { WikiStore } from '../wiki/store.js';
import { LLMProvider } from '../llm/provider.js';
import { commitWiki } from '../git/commit.js';

const INGEST_PROMPT = `You are a wiki editor for a project knowledge base.

Given observations from coding sessions (from claude-mem) and the current wiki state, produce updates to the wiki.

Rules:
- Create/update entity pages for repos, APIs, services, tools, and people mentioned
- Create session summaries
- Use existing aliases when possible
- Never invent data, URLs, or identifiers
- Ambiguous references -> create stub with confidence 0.3
- Output valid JSON only

Output format:
{
  "pages": [
    {
      "path": "entities/slug.md",
      "frontmatter": { ... },
      "body": "markdown content",
      "action": "create" | "update"
    }
  ],
  "new_aliases": { "alias_text": "canonical_slug" },
  "summary": "Brief description of what was ingested"
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
    if (!page.frontmatter.id) page.frontmatter.id = crypto.randomUUID();
    if (!page.frontmatter.created_at) page.frontmatter.created_at = new Date().toISOString();
    page.frontmatter.updated_at = new Date().toISOString();
    page.frontmatter.schema_version = 1;
    if (!page.frontmatter.authored_by) page.frontmatter.authored_by = 'memwiki';
    if (!page.frontmatter.confidence) page.frontmatter.confidence = 0.7;
    if (!page.frontmatter.sources) page.frontmatter.sources = observations.map(o => o.id);
    if (!page.frontmatter.related) page.frontmatter.related = [];

    store.write({
      path: page.path,
      frontmatter: page.frontmatter,
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
