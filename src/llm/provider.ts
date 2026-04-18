export interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
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
  baseUrl: 'https://openrouter.ai/api/v1',
  model: 'openrouter/elephant-alpha',
  maxTokens: 4096,
};

export class LLMProvider {
  private config: LLMConfig;

  constructor(config: Partial<LLMConfig> & { apiKey: string }) {
    this.config = { ...DEFAULT_CONFIG, ...config } as LLMConfig;
  }

  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    const res = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
        'HTTP-Referer': 'memwiki',
      },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        max_tokens: this.config.maxTokens,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`LLM API error ${res.status}: ${err}`);
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
