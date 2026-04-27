import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LLM_CONFIG } from '../config/defaults.js';
import { LLMProvider, resolveApiKey } from '../llm/provider.js';

const ORIGINAL_FETCH = globalThis.fetch;
const API_ENV_KEYS = ['CUSTOM_KEY', 'MEMWIKI_API_KEY', 'LLM_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY'] as const;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  for (const key of API_ENV_KEYS) {
    delete process.env[key];
  }
});

describe('provider contract', () => {
  it('resolveApiKey prioritizes the configured apiKeyEnv', () => {
    process.env.CUSTOM_KEY = 'custom-secret';
    process.env.MEMWIKI_API_KEY = 'memwiki-secret';

    assert.strictEqual(resolveApiKey({ apiKeyEnv: 'CUSTOM_KEY' }), 'custom-secret');
  });

  it('resolveApiKey follows the documented fallback order', () => {
    process.env.OPENAI_API_KEY = 'openai-secret';
    assert.strictEqual(resolveApiKey(), 'openai-secret');

    process.env.OPENROUTER_API_KEY = 'openrouter-secret';
    assert.strictEqual(resolveApiKey(), 'openrouter-secret');

    process.env.LLM_API_KEY = 'llm-secret';
    assert.strictEqual(resolveApiKey(), 'llm-secret');

    process.env.MEMWIKI_API_KEY = 'memwiki-secret';
    assert.strictEqual(resolveApiKey(), 'memwiki-secret');
  });

  it('uses the shared default LLM config for the default provider request', async () => {
    let observedUrl = '';
    let observedInit: RequestInit | undefined;

    globalThis.fetch = (async (url: string | URL | globalThis.Request, init?: RequestInit) => {
      observedUrl = String(url);
      observedInit = init;
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const provider = new LLMProvider({ apiKey: 'test-secret' });
    await provider.chat([{ role: 'user', content: 'hello' }]);

    assert.strictEqual(provider.providerName, DEFAULT_LLM_CONFIG.provider);
    assert.strictEqual(provider.modelName, DEFAULT_LLM_CONFIG.model);
    assert.strictEqual(observedUrl, `${DEFAULT_LLM_CONFIG.baseUrl}/chat/completions`);

    const headers = new Headers(observedInit?.headers as HeadersInit);
    const body = JSON.parse(String(observedInit?.body));

    assert.strictEqual(headers.get('Authorization'), 'Bearer test-secret');
    assert.strictEqual(headers.get('HTTP-Referer'), 'memwiki');
    assert.strictEqual(body.model, DEFAULT_LLM_CONFIG.model);
    assert.strictEqual(body.max_tokens, DEFAULT_LLM_CONFIG.maxTokens);
  });

  it('does not send the OpenRouter referer header to other providers', async () => {
    let observedInit: RequestInit | undefined;

    globalThis.fetch = (async (_url: string | URL | globalThis.Request, init?: RequestInit) => {
      observedInit = init;
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const provider = new LLMProvider({
      apiKey: 'test-secret',
      provider: 'openai',
      model: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
    });

    await provider.chat([{ role: 'user', content: 'hello' }]);

    const headers = new Headers(observedInit?.headers as HeadersInit);
    assert.strictEqual(headers.get('HTTP-Referer'), null);
  });
});
