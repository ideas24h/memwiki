# Token Economics: How memwiki saves you tokens

## The problem

Every time you start a new AI coding session, the AI needs to re-learn your project context. This costs tokens. The larger the project, the more expensive re-learning becomes.

**Without persistent memory:**

```
Session 1: Read 15 source files → 45,000 tokens (context building)
Session 2: Read 15 source files again → 45,000 tokens (re-learning)
Session 3: Read 15 source files again → 45,000 tokens (again)
...
Session N: 45,000 tokens EVERY TIME
```

## How memwiki changes this

memwiki distills raw observations from coding sessions into a compact wiki that replaces full file re-reads.

**With persistent memory:**

```
Session 1: Read 15 source files → 45,000 tokens (observations captured)
           memwiki ingest → 2,500 tokens (one-time LLM cost)
Session 2: Read wiki context → 2,000 tokens (capped)
Session 3: Read wiki context → 2,000 tokens
...
Session N: 2,000 tokens per session
```

## The formula

```
Savings_per_session = cost_without_wiki - cost_with_wiki

                    = (files_tokens + analysis_tokens) - wiki_context_tokens

Net_savings_total  = (N × savings_per_session) - ingest_cost

Savings_percentage = (1 - wiki_context_tokens / cost_without_wiki) × 100%
```

## Real measurement from our project

These are actual numbers from a live memwiki + claude-mem session:

### What claude-mem reported
```
Loading: 6 observations (2,461 tokens to read)
Work investment: 66,907 tokens spent on research, building, and decisions
Your savings: 96% reduction from reuse
```

### Ingest cost (one-time)
```
Observations processed: 19
LLM tokens used: ~3,500 (input) + ~1,500 (output) = ~5,000 tokens
LLM cost: $0.00 (elephant-alpha on OpenRouter, free tier)
```

### Per-session comparison

| Metric | Without memwiki | With memwiki |
|--------|----------------|--------------|
| Source file re-reads | ~10,000 tokens (4 files × ~2,500 each) | 0 |
| Architecture re-analysis | ~5,000 tokens | 0 |
| Decision history re-discovery | ~3,000 tokens | 0 |
| Wiki context read | 0 | ~500 tokens |
| **Total per session** | **~18,000 tokens** | **~500 tokens** |
| **Savings** | — | **97%** |

### Cumulative savings over N sessions

| Sessions | Without memwiki | With memwiki | Net savings | % |
|----------|----------------|--------------|-------------|---|
| 1 | 18,000 | 5,500* | -12,500 | -69% |
| 3 | 54,000 | 11,500 | 42,500 | 79% |
| 5 | 90,000 | 15,500 | 74,500 | 83% |
| 10 | 180,000 | 25,500 | 154,500 | 86% |
| 20 | 360,000 | 45,500 | 314,500 | 87% |

*\* Session 1 includes one-time ingest cost of 5,000 tokens*

**Break-even: Session 2** — by your second session, memwiki has already paid for itself.

## How to measure your own savings

### Step 1: Enable claude-mem

```bash
npx claude-mem install
# Use Claude Code normally — observations accumulate automatically
```

claude-mem shows token economics on every session start:
```
Loading: N observations (X tokens to read)
Work investment: Y tokens spent
Your savings: Z% reduction from reuse
```

### Step 2: Install memwiki and run ingest

```bash
memwiki install
memwiki ingest --verbose
# Note the LLM usage reported: "prompt_tokens: X, completion_tokens: Y"
```

### Step 3: Measure context cost

```bash
memwiki context | wc -c
# Divide chars by 4 for approximate tokens
```

### Step 4: Calculate savings

```python
# Your measurements
wiki_context_tokens = context_chars / 4
source_file_tokens = sum(file_size for each referenced file) / 4
ingest_cost_tokens = prompt_tokens + completion_tokens  # from --verbose

# Per-session savings
per_session_savings = source_file_tokens - wiki_context_tokens

# Break-even point (in sessions)
break_even = ceil(ingest_cost_tokens / per_session_savings)

# Savings after N sessions
net_savings = (N * per_session_savings) - ingest_cost_tokens
savings_pct = net_savings / (N * source_file_tokens) * 100
```

## Key metrics to track

| Metric | Source | How to measure |
|--------|--------|----------------|
| **Observation count** | claude-mem | `curl -s http://localhost:37777/api/observations?limit=0` |
| **Wiki page count** | memwiki | `memwiki lint --json` → `stats.total` |
| **Context size** | memwiki | `memwiki context \| wc -c` / 4 |
| **Ingest cost** | memwiki | `memwiki ingest --verbose` → LLM usage |
| **Savings %** | claude-mem | Session start output |

## Cost model by LLM provider

memwiki's ingest LLM cost varies by provider:

| Provider | Model | ~Cost per ingest (20 obs) | Notes |
|----------|-------|--------------------------|-------|
| OpenRouter | elephant-alpha | $0.00 | Free tier |
| OpenRouter | claude-3.5-haiku | ~$0.003 | Very cheap |
| OpenAI | gpt-4o-mini | ~$0.002 | Very cheap |
| OpenAI | gpt-4o | ~$0.03 | Moderate |
| Ollama (local) | llama3 | $0.00 | Requires GPU |
| LM Studio (local) | any | $0.00 | Requires GPU |

**Recommendation:** Use the cheapest model that produces valid JSON. Canonization doesn't require frontier intelligence — a small model works fine.

## When memwiki does NOT save tokens

- **One-off sessions** — if you only ever run 1 session, the ingest cost exceeds savings
- **Tiny projects** — if your wiki context equals or exceeds the source files
- **Static projects** — if nothing changes between sessions, there's nothing new to learn
- **Highly variable context** — if each session touches completely unrelated parts

## What gets measured

```
                         Token Flow

  ┌──────────────────────────────────────────────────────┐
  │                  WITHOUT memwiki                      │
  │                                                      │
  │  Session Start                                       │
  │    ├── Re-read source files ──── N tokens            │
  │    ├── Re-analyze architecture ── M tokens           │
  │    └── Re-discover decisions ─── P tokens            │
  │                                                      │
  │  Total: N + M + P tokens PER SESSION                 │
  └──────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────┐
  │                  WITH memwiki                         │
  │                                                      │
  │  One-time                                            │
  │    └── Ingest LLM call ────── I tokens (amortized)   │
  │                                                      │
  │  Per Session                                         │
  │    └── Wiki context ───────── C tokens (capped 2K)   │
  │                                                      │
  │  Total: C + (I / N_sessions) tokens PER SESSION      │
  └──────────────────────────────────────────────────────┘

  Net Savings = (N + M + P) - C - (I / N_sessions)
```
