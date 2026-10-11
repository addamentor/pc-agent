import { GoogleGenAI, type GenerateContentConfig, type GenerateContentResponse } from '@google/genai'
import type { LlmProvider, LlmRequest, LlmResult } from './types'

export class GeminiProvider implements LlmProvider {
  private ai: GoogleGenAI

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey })
  }

  async complete(req: LlmRequest): Promise<LlmResult> {
    const contents = req.messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }))
    const base: GenerateContentConfig = {
      systemInstruction: req.system,
      maxOutputTokens: req.maxTokens,
      responseMimeType: 'application/json'
    }
    let res: GenerateContentResponse
    try {
      // Thinking off where the model allows it; some models reject a zero budget.
      res = await this.ai.models.generateContent({
        model: req.model,
        contents,
        config: { ...base, thinkingConfig: { thinkingBudget: 0 } }
      })
    } catch {
      res = await this.ai.models.generateContent({ model: req.model, contents, config: base })
    }

    const u = res.usageMetadata
    const cached = u?.cachedContentTokenCount ?? 0
    return {
      text: res.text ?? '',
      truncated: res.candidates?.[0]?.finishReason === 'MAX_TOKENS',
      usage: {
        input: (u?.promptTokenCount ?? 0) - cached,
        output: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0),
        cacheRead: cached
      }
    }
  }

  async listModels(): Promise<string[]> {
    const ids: string[] = []
    const pager = await this.ai.models.list()
    for await (const m of pager) if (m.name) ids.push(m.name.replace(/^models\//, ''))
    return ids.sort()
  }
}
