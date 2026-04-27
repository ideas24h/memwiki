import { DEFAULT_LLM_CONFIG } from '../config/defaults.js';

export type LLMProviderName = 'openrouter' | 'openai' | 'ollama' | 'custom';

export interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
  provider: LLMProviderName;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  usage: { prompt_tokens: number; completion_tokens: number };
}

const DEFAULT_CONFIG: Partial<LLMConfig> = {
  provider: DEFAULT_LLM_CONFIG.provider,
  model: DEFAULT_LLM_CONFIG.model,
  baseUrl: DEFAULT_LLM_CONFIG.baseUrl,
  maxTokens: DEFAULT_LLM_CONFIG.maxTokens,
};

export class LLMProvider {
  private config: LLMConfig;

  constructor(config: Partial<LLMConfig> & { apiKey: string }) {
    // Allow env vars to override baseUrl and model if not explicitly provided
    const baseUrl = config.baseUrl || process.env.LLM_BASE_URL || DEFAULT_CONFIG.baseUrl!;
    const model = config.model || process.env.LLM_MODEL || DEFAULT_CONFIG.model!;
    const provider = config.provider || DEFAULT_CONFIG.provider!;

    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      baseUrl,
      model,
      provider,
    } as LLMConfig;
  }

  get providerName(): LLMProviderName {
    return this.config.provider;
  }

  get modelName(): string {
    return this.config.model;
  }

  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.apiKey}`,
    };

    // HTTP-Referer header is required by OpenRouter but should not be sent to other providers
    if (this.config.provider === 'openrouter') {
      headers['HTTP-Referer'] = 'memwiki';
    }

    const res = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.config.model,
        messages,
        max_tokens: this.config.maxTokens,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`LLM API error (${this.config.provider}/${this.config.model}) ${res.status}: ${err}`);
    }

    const data = await res.json() as any;
    return {
      content: data.choices?.[0]?.message?.content ?? '',
      usage: {
        prompt_tokens: data.usage?.prompt_tokens ?? 0,
        completion_tokens: data.usage?.completion_tokens ?? 0,
      },
    };
  }

  async chatJSON<T>(messages: LLMMessage[]): Promise<T> {
    const response = await this.chat(messages);
    // Extract JSON from response (handle markdown code blocks)
    let text = response.content.trim();
    const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) text = jsonMatch[1];
    // Try to find JSON object/array in the text
    const jsonStart = text.indexOf('{');
    const jsonStartArr = text.indexOf('[');
    if (jsonStart >= 0 && (jsonStartArr < 0 || jsonStart < jsonStartArr)) {
      text = text.slice(jsonStart);
    } else if (jsonStartArr >= 0) {
      text = text.slice(jsonStartArr);
    }
    return JSON.parse(text) as T;
  }
}

/**
 * Resolve API key from config or environment variables.
 * Priority: config.apiKeyEnv -> MEMWIKI_API_KEY -> LLM_API_KEY -> OPENROUTER_API_KEY -> OPENAI_API_KEY
 */
export function resolveApiKey(config: { apiKeyEnv?: string } = {}): string {
  // If a specific env var is configured, use it first
  if (config.apiKeyEnv) {
    const key = process.env[config.apiKeyEnv];
    if (key) return key;
  }

  // Fallback chain
  const fallbacks = ['MEMWIKI_API_KEY', 'LLM_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY'];
  for (const envVar of fallbacks) {
    const key = process.env[envVar];
    if (key) {
      return key;
    }
  }

  return '';
}
