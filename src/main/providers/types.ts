export interface LlmMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface LlmRequest {
  model: string
  system: string
  messages: LlmMessage[]
  maxTokens: number
}

export interface LlmUsage {
  input: number // uncached input tokens (incl. cache writes)
  output: number // includes any reasoning tokens the provider bills as output
  cacheRead: number
}

export interface LlmResult {
  text: string
  usage: LlmUsage
  truncated: boolean
}

export interface LlmProvider {
  complete(req: LlmRequest): Promise<LlmResult>
  listModels(): Promise<string[]>
}
