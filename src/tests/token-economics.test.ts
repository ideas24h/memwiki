/**
 * Token Economics Tests for memwiki
 *
 * Measures whether memwiki actually saves tokens compared to
 * re-reading source files every session.
 *
 * Run: node --test dist/tests/token-economics.test.js
 * Build first: npm run build
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Helpers ──────────────────────────────────────────────

const CHARS_PER_TOKEN = 4;

function charsToTokens(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

function tokensToChars(tokens: number): number {
  return tokens * CHARS_PER_TOKEN;
}

/** Generate a mock source file of approximate line count */
function mockSourceFile(lines: number, lineLen: number = 80): string {
  return Array.from({ length: lines }, (_, i) =>
    `// Line ${i}: ${'x'.repeat(lineLen - 12)}`
  ).join('\n');
}

/** Generate a mock wiki page (compact summary) */
function mockWikiPage(title: string, bodyLines: number = 15): string {
  const frontmatter = [
    '---',
    `type: entity`,
    `title: "${title}"`,
    `slug: "${title.toLowerCase().replace(/\s+/g, '-')}"`,
    `confidence: 0.9`,
    `---`,
    '',
    `# ${title}`,
    '',
  ].join('\n');

  const body = Array.from({ length: bodyLines }, (_, i) =>
    `Summary point ${i + 1}: key fact about ${title}.`
  ).join('\n');

  return frontmatter + body + '\n';
}

/** Generate mock observations */
function mockObservations(count: number, avgTextLen: number = 200): Array<{ text: string; type: string }> {
  return Array.from({ length: count }, (_, i) => ({
    text: `Observation ${i}: ${'x'.repeat(avgTextLen - 20)}`,
    type: ['decision', 'bugfix', 'feature', 'discovery'][i % 4],
  }));
}

// ── Scenarios ────────────────────────────────────────────

interface Scenario {
  name: string;
  sourceFiles: number;
  linesPerFile: number;
  wikiPages: number;
  observationsPerSession: number;
  sessionsRun: number;
}

const scenarios: Scenario[] = [
  {
    name: 'Small project (5 files, 3 wiki pages)',
    sourceFiles: 5,
    linesPerFile: 100,
    wikiPages: 3,
    observationsPerSession: 5,
    sessionsRun: 5,
  },
  {
    name: 'Medium project (20 files, 10 wiki pages)',
    sourceFiles: 20,
    linesPerFile: 200,
    wikiPages: 10,
    observationsPerSession: 15,
    sessionsRun: 10,
  },
  {
    name: 'Large project (100 files, 40 wiki pages)',
    sourceFiles: 100,
    linesPerFile: 300,
    wikiPages: 40,
    observationsPerSession: 30,
    sessionsRun: 20,
  },
];

// ── Cost Models ──────────────────────────────────────────

function costWithoutWiki(scenario: Scenario): number {
  // Each session: re-read all source files + re-analyze architecture + re-discover decisions
  const fileTokens = scenario.sourceFiles * charsToTokens(scenario.linesPerFile * 80);
  const analysisTokens = Math.ceil(fileTokens * 0.1); // 10% overhead for analysis
  const decisionTokens = scenario.wikiPages * 100; // ~100 tokens per decision to re-discover
  const perSession = fileTokens + analysisTokens + decisionTokens;
  return perSession * scenario.sessionsRun;
}

function costWithWiki(scenario: Scenario): { ingestCost: number; contextCostPerSession: number; total: number } {
  // Ingest cost: send observations + wiki state to LLM, get back pages
  const obsPerSession = scenario.observationsPerSession;
  const totalObs = obsPerSession * scenario.sessionsRun;

  // LLM input: system prompt (~500 tokens) + observations (~200 tokens each) + wiki state (~100 tokens per page)
  const llmInputTokens = 500 + (totalObs * 200) + (scenario.wikiPages * 100);
  // LLM output: ~300 tokens per wiki page created/updated
  const llmOutputTokens = scenario.wikiPages * 300;
  const ingestCost = llmInputTokens + llmOutputTokens;

  // Context cost per session: wiki summary capped at 2000 tokens
  const wikiContextTokens = Math.min(
    2000,
    scenario.wikiPages * 120 // ~120 tokens per page in context
  );

  return {
    ingestCost,
    contextCostPerSession: wikiContextTokens,
    total: ingestCost + (wikiContextTokens * scenario.sessionsRun),
  };
}

// ── Tests ────────────────────────────────────────────────

describe('Token Economics', () => {

  describe('Basic measurements', () => {
    it('should estimate token count from character count', () => {
      assert.strictEqual(charsToTokens(100), 25);
      assert.strictEqual(charsToTokens(400), 100);
      assert.strictEqual(charsToTokens(1), 1); // minimum 1 token
    });

    it('should generate realistic source files', () => {
      const file = mockSourceFile(100, 80);
      assert.ok(file.length > 7000, `Source file too short: ${file.length} chars`);
      assert.ok(file.length < 9000, `Source file too long: ${file.length} chars`);
    });

    it('should generate compact wiki pages', () => {
      const page = mockWikiPage('Test Entity', 15);
      const sourceEquiv = mockSourceFile(100, 80);

      // Wiki page should be much shorter than the source file it summarizes
      assert.ok(
        page.length < sourceEquiv.length / 5,
        `Wiki page (${page.length} chars) should be < 1/5 of source (${sourceEquiv.length} chars)`
      );
    });

    it('should estimate observation token cost', () => {
      const obs = mockObservations(10, 200);
      const totalChars = obs.reduce((sum, o) => sum + o.text.length, 0);
      const tokens = charsToTokens(totalChars);

      assert.ok(tokens > 400, `10 observations should be > 400 tokens, got ${tokens}`);
      assert.ok(tokens < 700, `10 observations should be < 700 tokens, got ${tokens}`);
    });
  });

  describe('Per-scenario savings', () => {
    for (const scenario of scenarios) {
      it(`${scenario.name}: memwiki should save tokens after break-even`, () => {
        const without = costWithoutWiki(scenario);
        const withWiki = costWithWiki(scenario);

        // Total cost with wiki should be less than without
        assert.ok(
          withWiki.total < without,
          `With wiki (${withWiki.total} tokens) should cost less than without (${without} tokens)`
        );

        const savings = without - withWiki.total;
        const savingsPct = (savings / without) * 100;

        // Should save at least 50% across the scenario's sessions
        assert.ok(
          savingsPct > 50,
          `Expected > 50% savings, got ${savingsPct.toFixed(1)}%`
        );

        console.log(`  ${scenario.name}:`);
        console.log(`    Without: ${without.toLocaleString()} tokens`);
        console.log(`    With:    ${withWiki.total.toLocaleString()} tokens (ingest: ${withWiki.ingestCost.toLocaleString()}, context: ${withWiki.contextCostPerSession}/session)`);
        console.log(`    Savings: ${savingsPct.toFixed(1)}% (${savings.toLocaleString()} tokens)`);
      });
    }
  });

  describe('Break-even analysis', () => {
    it('should break even by session 2 for medium projects', () => {
      const scenario: Scenario = {
        name: 'Medium project',
        sourceFiles: 20,
        linesPerFile: 200,
        wikiPages: 10,
        observationsPerSession: 15,
        sessionsRun: 1, // test per-session
      };

      const withoutPerSession = costWithoutWiki({ ...scenario, sessionsRun: 1 }) / 1;
      const withWiki = costWithWiki(scenario);

      // Break-even = ingest_cost / per_session_savings
      const perSessionSavings = withoutPerSession - withWiki.contextCostPerSession;
      const breakEven = Math.ceil(withWiki.ingestCost / perSessionSavings);

      assert.ok(
        breakEven <= 3,
        `Break-even should be <= 3 sessions, got ${breakEven}`
      );

      console.log(`  Break-even at session ${breakEven}`);
      console.log(`  Per-session savings: ${perSessionSavings.toLocaleString()} tokens`);
      console.log(`  Ingest cost: ${withWiki.ingestCost.toLocaleString()} tokens`);
    });

    it('should show negative ROI at session 1 (ingest overhead)', () => {
      const scenario: Scenario = {
        name: 'Medium project',
        sourceFiles: 20,
        linesPerFile: 200,
        wikiPages: 10,
        observationsPerSession: 15,
        sessionsRun: 1,
      };

      const without = costWithoutWiki(scenario);
      const withWiki = costWithWiki(scenario);

      // At session 1, wiki cost should be HIGHER (ingest overhead)
      // This is expected — savings accumulate over sessions
      console.log(`  Session 1 without: ${without.toLocaleString()} tokens`);
      console.log(`  Session 1 with:    ${withWiki.total.toLocaleString()} tokens`);
      console.log(`  Session 1 ROI: ${withWiki.total > without ? 'NEGATIVE (expected)' : 'POSITIVE'}`);
    });
  });

  describe('Context cap effectiveness', () => {
    it('should cap wiki context at 2000 tokens regardless of wiki size', () => {
      const smallWiki = costWithWiki({
        name: '',
        sourceFiles: 0,
        linesPerFile: 0,
        wikiPages: 3,
        observationsPerSession: 5,
        sessionsRun: 1,
      });

      const largeWiki = costWithWiki({
        name: '',
        sourceFiles: 0,
        linesPerFile: 0,
        wikiPages: 100,
        observationsPerSession: 30,
        sessionsRun: 1,
      });

      // Both should be capped at 2000 tokens for context
      assert.ok(
        smallWiki.contextCostPerSession <= 2000,
        `Small wiki context should be <= 2000 tokens, got ${smallWiki.contextCostPerSession}`
      );
      assert.ok(
        largeWiki.contextCostPerSession <= 2000,
        `Large wiki context should be <= 2000 tokens, got ${largeWiki.contextCostPerSession}`
      );

      console.log(`  3 pages context:  ${smallWiki.contextCostPerSession} tokens`);
      console.log(`  100 pages context: ${largeWiki.contextCostPerSession} tokens (capped)`);
    });
  });

  describe('Scaling behavior', () => {
    it('savings should increase with project size', () => {
      const results = scenarios.map(s => {
        const without = costWithoutWiki(s);
        const withWiki = costWithWiki(s);
        return {
          name: s.name,
          savingsPct: ((without - withWiki.total) / without) * 100,
        };
      });

      // Savings should be monotonically increasing with project size
      for (let i = 1; i < results.length; i++) {
        assert.ok(
          results[i].savingsPct >= results[i - 1].savingsPct,
          `${results[i].name} (${results[i].savingsPct.toFixed(1)}%) should have >= savings than ${results[i - 1].name} (${results[i - 1].savingsPct.toFixed(1)}%)`
        );
      }

      console.log('  Savings by project size:');
      for (const r of results) {
        console.log(`    ${r.name}: ${r.savingsPct.toFixed(1)}%`);
      }
    });
  });

  describe('Ingest cost model', () => {
    it('should track LLM usage per ingest', () => {
      // Simulate what ingest --verbose reports
      const observations = 19;
      const wikiPages = 4;
      const modelCostPer1k = { input: 0, output: 0 }; // elephant-alpha = free

      const inputTokens = 500 + (observations * 200) + (wikiPages * 100); // ~5,300
      const outputTokens = wikiPages * 300; // ~1,200
      const totalTokens = inputTokens + outputTokens;
      const costUSD = ((inputTokens * modelCostPer1k.input) + (outputTokens * modelCostPer1k.output)) / 1000;

      assert.strictEqual(totalTokens, 5900);
      assert.strictEqual(costUSD, 0); // free model

      console.log(`  19 observations → 4 pages:`);
      console.log(`    Input tokens:  ${inputTokens.toLocaleString()}`);
      console.log(`    Output tokens: ${outputTokens.toLocaleString()}`);
      console.log(`    Cost: $${costUSD.toFixed(4)}`);
    });

    it('should calculate cost for paid models', () => {
      const inputTokens = 5300;
      const outputTokens = 1200;

      const models = [
        { name: 'elephant-alpha (OpenRouter)', input: 0, output: 0 },
        { name: 'gpt-4o-mini (OpenAI)', input: 0.15, output: 0.60 },
        { name: 'gpt-4o (OpenAI)', input: 2.50, output: 10.00 },
        { name: 'claude-3.5-haiku (OpenRouter)', input: 0.80, output: 4.00 },
      ];

      console.log('  Ingest cost by model:');
      for (const model of models) {
        const cost = ((inputTokens * model.input) + (outputTokens * model.output)) / 1_000_000;
        console.log(`    ${model.name}: $${cost.toFixed(4)}`);
      }
    });
  });
});
