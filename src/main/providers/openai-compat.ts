import OpenAI from 'openai'
import type { LlmProvider, LlmRequest, LlmResult } from './types'

// Serves OpenAI, OpenRouter and Ollama: all speak the OpenAI chat-completions API.
export class OpenAICompatProvider implements LlmProvider {
  private client: OpenAI

  constructor(
    private kind: 'openai' | 'openrouter' | 'ollama',
    apiKey: string | null,
    baseURL?: string
  ) {
    this.client = new OpenAI({ apiKey: apiKey ?? 'ollama', baseURL, maxRetries: 1, timeout: 120_000 })
  }

  async complete(req: LlmRequest): Promise<LlmResult> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: req.system },
      ...req.messages
    ]
    const base: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = { model: req.model, messages }
    // OpenAI deprecated max_tokens in favour of max_completion_tokens; the others still use max_tokens.
    if (this.kind === 'openai') base.max_completion_tokens = req.maxTokens
    else base.max_tokens = req.maxTokens

    const tuned: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      ...base,
      response_format: { type: 'json_object' },
      ...(this.kind === 'openai' && /^(o\d|gpt-5)/.test(req.model) ? { reasoning_effort: 'low' as const } : {})
    }

    let res: OpenAI.Chat.ChatCompletion
    try {
      res = await this.client.chat.completions.create(tuned)
    } catch (err) {
      if (!(err instanceof OpenAI.BadRequestError)) throw err
      res = await this.client.chat.completions.create(base)
    }

    const choice = res.choices[0]
    const cached = res.usage?.prompt_tokens_details?.cached_tokens ?? 0
    return {
      text: choice?.message?.content ?? '',
      truncated: choice?.finish_reason === 'length',
      usage: {
        input: (res.usage?.prompt_tokens ?? 0) - cached,
        output: res.usage?.completion_tokens ?? 0,
        cacheRead: cached
      }
    }
  }

  async listModels(): Promise<string[]> {
    const ids: string[] = []
    for await (const m of this.client.models.list()) ids.push(m.id)
    return ids.sort()
  }
}
