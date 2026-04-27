export const DEFAULT_LLM_CONFIG = {
  provider: 'openrouter',
  model: 'openrouter/elephant-alpha',
  baseUrl: 'https://openrouter.ai/api/v1',
  maxTokens: 4096,
  apiKeyEnv: 'OPENROUTER_API_KEY',
} as const;

export const DEFAULT_MEMWIKI_CONFIG = {
  ...DEFAULT_LLM_CONFIG,
  claudeMemUrl: 'http://127.0.0.1:37777',
} as const;
