import type { ProviderId } from '@shared/types'
import { getApiKey, getSettings } from '../settings'
import { AnthropicProvider } from './anthropic'
import { GeminiProvider } from './gemini'
import { OpenAICompatProvider } from './openai-compat'
import type { LlmProvider } from './types'

export function makeProvider(id: ProviderId): LlmProvider {
  const cfg = getSettings().providers[id]
  const key = getApiKey(id)
  if (id !== 'ollama' && !key) throw new Error(`No API key set for ${id}. Add one in Settings.`)
  switch (id) {
    case 'anthropic':
      return new AnthropicProvider(key!)
    case 'gemini':
      return new GeminiProvider(key!)
    case 'openai':
      return new OpenAICompatProvider('openai', key, cfg.baseUrl || undefined)
    case 'openrouter':
    case 'ollama':
      return new OpenAICompatProvider(id, key, cfg.baseUrl)
  }
}

export type { LlmProvider, LlmRequest, LlmResult, LlmMessage } from './types'
