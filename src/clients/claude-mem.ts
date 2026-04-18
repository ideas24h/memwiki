export interface ClaudeMemConfig {
  baseUrl: string;
  timeout: number;
}

export interface Observation {
  id: number;
  memory_session_id: string;
  project: string;
  text: string | null;
  type: 'decision' | 'bugfix' | 'feature' | 'refactor' | 'discovery' | 'change';
  created_at: string;
  created_at_epoch: number;
  title?: string;
  subtitle?: string;
  narrative?: string;
  facts?: string;
  concepts?: string;
  concept?: string;
  source_files?: string;
  files_read?: string;
  files_modified?: string;
  prompt_number?: number;
}

export interface SessionSummary {
  id: number;
  memory_session_id: string;
  project: string;
  request: string | null;
  investigated: string | null;
  learned: string | null;
  completed: string | null;
  next_steps: string | null;
  created_at: string;
  created_at_epoch: number;
}

export class ClaudeMemClient {
  private baseUrl: string;
  private timeout: number;

  constructor(config?: Partial<ClaudeMemConfig>) {
    this.baseUrl = config?.baseUrl ?? 'http://127.0.0.1:37777';
    this.timeout = config?.timeout ?? 5000;
  }

  /** Extract array from paginated responses: { items: [...] } or { observations: [...] } or bare array */
  private extractArray(data: any): any[] {
    return data.items ?? data.observations ?? data.summaries ?? data.results ?? (Array.isArray(data) ? data : []);
  }

  async health(): Promise<{ ok: boolean; version?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/api/health`, { signal: AbortSignal.timeout(this.timeout) });
      if (!res.ok) return { ok: false };
      const data = await res.json() as any;
      return { ok: true, version: data.version };
    } catch {
      return { ok: false };
    }
  }

  async getObservations(params: { offset?: number; limit?: number; project?: string } = {}): Promise<Observation[]> {
    const qs = new URLSearchParams();
    if (params.offset) qs.set('offset', String(params.offset));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.project) qs.set('project', params.project);
    try {
      const res = await fetch(`${this.baseUrl}/api/observations?${qs}`);
      if (!res.ok) return [];
      const data = await res.json() as any;
      return this.extractArray(data);
    } catch { return []; }
  }

  async getObservationsSince(sinceEpoch: number, project?: string): Promise<Observation[]> {
    // Paginate through all observations and filter by epoch
    const all: Observation[] = [];
    let offset = 0;
    const limit = 100;
    while (true) {
      const batch = await this.getObservations({ offset, limit, project });
      if (batch.length === 0) break;
      const filtered = batch.filter(o => o.created_at_epoch > sinceEpoch);
      all.push(...filtered);
      // If we got filtered results but batch was full, might be more older ones to skip
      if (batch.length < limit) break;
      // If all items are older than sinceEpoch, stop
      if (batch.every(o => o.created_at_epoch <= sinceEpoch)) break;
      offset += limit;
    }
    return all.sort((a, b) => a.created_at_epoch - b.created_at_epoch);
  }

  async getObservationsBatch(ids: number[]): Promise<Observation[]> {
    if (ids.length === 0) return [];
    try {
      const res = await fetch(`${this.baseUrl}/api/observations/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) return [];
      const data = await res.json() as any;
      return this.extractArray(data);
    } catch { return []; }
  }

  async getSummaries(params: { offset?: number; limit?: number; project?: string } = {}): Promise<SessionSummary[]> {
    const qs = new URLSearchParams();
    if (params.offset) qs.set('offset', String(params.offset));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.project) qs.set('project', params.project);
    try {
      const res = await fetch(`${this.baseUrl}/api/summaries?${qs}`);
      if (!res.ok) return [];
      const data = await res.json() as any;
      return this.extractArray(data);
    } catch { return []; }
  }

  async search(params: { query: string; limit?: number; project?: string }): Promise<Observation[]> {
    const qs = new URLSearchParams({ query: params.query });
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.project) qs.set('project', params.project);
    try {
      const res = await fetch(`${this.baseUrl}/api/search?${qs}`);
      if (!res.ok) return [];
      const data = await res.json() as any;
      return this.extractArray(data);
    } catch { return []; }
  }

  async getRecent(params: { project?: string; limit?: number } = {}): Promise<{ summaries: SessionSummary[]; observations: Observation[] }> {
    const qs = new URLSearchParams();
    if (params.project) qs.set('project', params.project);
    if (params.limit) qs.set('limit', String(params.limit));
    try {
      const res = await fetch(`${this.baseUrl}/api/context/recent?${qs}`);
      if (!res.ok) return { summaries: [], observations: [] };
      return await res.json() as any;
    } catch { return { summaries: [], observations: [] }; }
  }
}
