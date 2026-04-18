/**
 * MCP (Model Context Protocol) stdio server for memwiki.
 *
 * Protocol: newline-delimited JSON-RPC 2.0 over stdin/stdout.
 * Messages are one JSON object per line.
 *
 * Tools exposed:
 *   - wiki_search(query, type?, limit?) — search wiki pages
 *   - wiki_read(slug)                   — read a wiki page
 *   - wiki_context(project?, max_tokens?) — get wiki context summary
 *   - wiki_list(type?)                  — list all wiki pages
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import * as readline from 'node:readline';
import { WikiStore } from '../wiki/store.js';

// ── JSON-RPC types ──────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, any>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

// ── Tool definitions ────────────────────────────────────────────────────────

interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

const TOOLS: ToolDef[] = [
  {
    name: 'wiki_search',
    description: 'Search wiki pages by title and body content. Returns matching pages with relevance scores.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search terms' },
        type: { type: 'string', description: 'Optional page type filter (entity, topic, decision, session, skill)', enum: ['entity', 'topic', 'decision', 'session', 'skill'] },
        limit: { type: 'number', description: 'Max results to return', default: 10 },
      },
      required: ['query'],
    },
  },
  {
    name: 'wiki_read',
    description: 'Read a wiki page by its slug (e.g. "entities/claude.md"). Returns frontmatter metadata and body content.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'Page slug (path relative to wiki root, e.g. "entities/claude.md")' },
      },
      required: ['slug'],
    },
  },
  {
    name: 'wiki_context',
    description: 'Get a summary of wiki context — index, recent sessions, active entities. Useful for onboarding an AI session.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Optional project name filter' },
        max_tokens: { type: 'number', description: 'Approximate max tokens in response', default: 2000 },
      },
    },
  },
  {
    name: 'wiki_list',
    description: 'List all wiki page slugs, optionally filtered by type.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Optional page type filter (entity, topic, decision, session, skill)', enum: ['entity', 'topic', 'decision', 'session', 'skill'] },
      },
    },
  },
];

// ── Tool implementations ────────────────────────────────────────────────────

function findWikiRoot(): string | null {
  // Check cwd/wiki first, then ~/.memwiki/wiki
  const local = path.join(process.cwd(), 'wiki');
  if (fs.existsSync(local)) return local;
  const home = path.join(process.env.HOME || '/root', '.memwiki', 'wiki');
  if (fs.existsSync(home)) return home;
  return null;
}

function toolSearch(params: Record<string, any>): any {
  const wikiRoot = findWikiRoot();
  if (!wikiRoot) return { error: 'No wiki found. Run memwiki install first.' };

  const store = new WikiStore(wikiRoot);
  const query = params.query as string;
  const type = params.type as string | undefined;
  const limit = (params.limit as number) || 10;
  const terms = query.split(/\s+/).filter(Boolean);

  if (terms.length === 0) return [];

  const slugs = store.list(type);
  const results: any[] = [];

  for (const slug of slugs) {
    const page = store.read(slug);
    if (!page) continue;
    const title = page.frontmatter.title.toLowerCase();
    const body = page.body.toLowerCase();
    let score = 0;
    for (const term of terms) {
      const t = term.toLowerCase();
      let idx = -1;
      while ((idx = title.indexOf(t, idx + 1)) !== -1) score += 10;
      idx = -1;
      while ((idx = body.indexOf(t, idx + 1)) !== -1) score += 1;
    }
    if (score === 0) continue;
    results.push({
      slug,
      title: page.frontmatter.title,
      type: page.frontmatter.type,
      score,
      snippet: page.body.slice(0, 200).replace(/\n/g, ' ').trim(),
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

function toolRead(params: Record<string, any>): any {
  const wikiRoot = findWikiRoot();
  if (!wikiRoot) return { error: 'No wiki found.' };

  const store = new WikiStore(wikiRoot);
  const slug = params.slug as string;
  const page = store.read(slug);
  if (!page) return { error: `Page not found: ${slug}` };

  return {
    slug: page.path,
    frontmatter: page.frontmatter,
    body: page.body,
  };
}

function toolContext(params: Record<string, any>): any {
  const wikiRoot = findWikiRoot();
  if (!wikiRoot) return { error: 'No wiki found.' };

  const store = new WikiStore(wikiRoot);
  const maxTokens = (params.max_tokens as number) || 2000;
  const maxChars = maxTokens * 4;
  const parts: string[] = [];

  // Index
  const index = store.readIndex();
  if (index) {
    parts.push('=== WIKI INDEX ===');
    parts.push(index);
    parts.push('');
  }

  // Recent sessions
  const sessions = store.list('session').slice(-5);
  if (sessions.length > 0) {
    parts.push('=== RECENT SESSIONS ===');
    for (const slug of sessions) {
      const page = store.read(slug);
      if (page) {
        const fm = page.frontmatter;
        parts.push(`- ${fm.title || slug} (${fm.created_at?.split('T')[0] || 'unknown'})`);
        if (page.body) parts.push(`  ${page.body.split('\n')[0].slice(0, 120)}`);
      }
    }
    parts.push('');
  }

  // Hot entities (updated in last 7 days)
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const entities = store.list('entity');
  const hot: string[] = [];
  for (const slug of entities) {
    const page = store.read(slug);
    if (!page) continue;
    const fm = page.frontmatter;
    const updated = new Date(fm.updated_at || fm.created_at).getTime();
    if (updated > sevenDaysAgo && (fm.confidence ?? 0) > 0.7) {
      hot.push(`- ${fm.title} (${(fm as any).kind || 'entity'})`);
    }
  }
  if (hot.length > 0) {
    parts.push('=== ACTIVE ENTITIES ===');
    parts.push(...hot);
  }

  const output = parts.join('\n');
  if (output.length > maxChars) {
    return output.slice(0, maxChars) + '\n... (truncated)';
  }
  return output;
}

function toolList(params: Record<string, any>): any {
  const wikiRoot = findWikiRoot();
  if (!wikiRoot) return { error: 'No wiki found.' };

  const store = new WikiStore(wikiRoot);
  const type = params.type as string | undefined;
  const slugs = store.list(type);
  return slugs;
}

// ── Dispatch ────────────────────────────────────────────────────────────────

function dispatch(method: string, params: Record<string, any> = {}): any {
  switch (method) {
    case 'tools/list':
      return {
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      };

    case 'tools/call': {
      const toolName = params.name as string;
      const toolArgs = (params.arguments || {}) as Record<string, any>;

      switch (toolName) {
        case 'wiki_search': return toolSearch(toolArgs);
        case 'wiki_read': return toolRead(toolArgs);
        case 'wiki_context': return toolContext(toolArgs);
        case 'wiki_list': return toolList(toolArgs);
        default:
          throw new Error(`Unknown tool: ${toolName}`);
      }
    }

    case 'initialize':
      return {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: {
          name: 'memwiki',
          version: '0.1.0',
        },
      };

    default:
      throw new Error(`Unknown method: ${method}`);
  }
}

// ── Server entry ────────────────────────────────────────────────────────────

export async function startMcpServer(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin });

  // Log to stderr so it doesn't pollute the JSON-RPC stream on stdout
  const log = (msg: string) => process.stderr.write(`[memwiki-mcp] ${msg}\n`);
  log('MCP server starting (stdio mode)');

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let request: JsonRpcRequest;
    try {
      request = JSON.parse(trimmed);
    } catch {
      // Not valid JSON — skip
      log(`Invalid JSON: ${trimmed.slice(0, 80)}`);
      return;
    }

    // Handle notifications (no id) — just process silently
    const id = request.id ?? null;

    try {
      const result = dispatch(request.method, request.params);
      if (id !== null) {
        const response: JsonRpcResponse = { jsonrpc: '2.0', id, result };
        process.stdout.write(JSON.stringify(response) + '\n');
      }
    } catch (err: any) {
      if (id !== null) {
        const response: JsonRpcResponse = {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32603,
            message: err.message || 'Internal error',
          },
        };
        process.stdout.write(JSON.stringify(response) + '\n');
      }
      log(`Error handling ${request.method}: ${err.message}`);
    }
  });

  rl.on('close', () => {
    log('stdin closed, shutting down');
    process.exit(0);
  });

  // Signal ready on stderr
  log('MCP server ready');
}
