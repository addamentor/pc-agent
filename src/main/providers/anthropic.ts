import Anthropic from '@anthropic-ai/sdk'
import type { LlmProvider, LlmRequest, LlmResult } from './types'

// The agent wants short, cheap answers, so turn thinking off (or to its minimum)
// wherever the model allows it. Rules differ per model generation.
function cheapThinking(model: string): Record<string, unknown> {
  if (/opus-5-5|fable|mythos/.test(model)) return { output_config: { effort: 'low' } } // thinking can't be disabled
  if (/sonnet-5-5/.test(model)) return { thinking: { type: 'between_tools' }, output_config: { effort: 'low' } }
  if (/haiku-5|sonnet-5|opus-5|opus-4-[678]/.test(model)) return { thinking: { type: 'disabled' } }
  return {}
}

export class AnthropicProvider implements LlmProvider {
  private client: Anthropic

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 })
  }

  async complete(req: LlmRequest): Promise<LlmResult> {
    const base = {
      model: req.model,
      max_tokens: req.maxTokens,
      // Fixed system prompt first so it can be cached across wake-ups.
      system: [{ type: 'text' as const, text: req.system, cache_control: { type: 'ephemeral' as const } }],
      messages: req.messages
    }
    let res: Anthropic.Message
    try {
      res = await this.client.messages.create({ ...base, ...cheapThinking(req.model) } as Anthropic.MessageCreateParamsNonStreaming)
    } catch (err) {
      // An older/unknown model may reject the thinking tweaks; retry once without them.
      if (!(err instanceof Anthropic.BadRequestError)) throw err
      res = await this.client.messages.create(base)
    }

    let text = ''
    for (const block of res.content) if (block.type === 'text') text += block.text
    if (res.stop_reason === 'refusal') text = ''

    const u = res.usage
    return {
      text,
      truncated: res.stop_reason === 'max_tokens',
      usage: {
        input: u.input_tokens + (u.cache_creation_input_tokens ?? 0),
        output: u.output_tokens,
        cacheRead: u.cache_read_input_tokens ?? 0
      }
    }
  }

  async listModels(): Promise<string[]> {
    const ids: string[] = []
    for await (const m of this.client.models.list()) ids.push(m.id)
    return ids
  }
}
