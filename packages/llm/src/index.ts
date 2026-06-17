import type { ChatChunk, ChatRequest, ChatResponse } from "@opensupportai/protocol";

export interface ChatModel {
  generate(input: ChatRequest): Promise<ChatResponse>;
  stream(input: ChatRequest): AsyncIterable<ChatChunk>;
}

export interface EmbeddingModel {
  embed(texts: string[]): Promise<number[][]>;
}

export type OpenAICompatibleConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  embeddingModel?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
    delta?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

type EmbeddingResponse = {
  data?: Array<{
    embedding?: number[];
  }>;
};

export class OpenAICompatibleClient implements ChatModel, EmbeddingModel {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: OpenAICompatibleConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async generate(input: ChatRequest): Promise<ChatResponse> {
    const response = await this.postJson<ChatCompletionResponse>("/chat/completions", {
      model: input.model || this.config.model,
      messages: input.messages,
      temperature: input.temperature,
      stream: false
    });
    const text = response.choices?.[0]?.message?.content ?? "";
    return {
      text,
      model: input.model || this.config.model,
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens
          }
        : undefined
    };
  }

  async *stream(input: ChatRequest): AsyncIterable<ChatChunk> {
    const response = await this.fetchImpl(this.url("/chat/completions"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: input.model || this.config.model,
        messages: input.messages,
        temperature: input.temperature,
        stream: true
      }),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 60_000)
    });

    if (!response.ok || !response.body) {
      throw new Error(`LLM stream request failed with status ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const chunk = parseStreamLine(line);
        if (!chunk) {
          continue;
        }
        if (chunk === "[DONE]") {
          yield { text: "", done: true };
          return;
        }
        const text = chunk.choices?.[0]?.delta?.content;
        if (text) {
          yield { text, done: false };
        }
      }
    }

    yield { text: "", done: true };
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.config.embeddingModel) {
      throw new Error("embeddingModel is required for embeddings");
    }
    const response = await this.postJson<EmbeddingResponse>("/embeddings", {
      model: this.config.embeddingModel,
      input: texts
    });
    return (response.data ?? []).map((item) => item.embedding ?? []);
  }

  private async postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await this.fetchImpl(this.url(path), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 60_000)
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`LLM request failed with status ${response.status}: ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.apiKey}`,
      "Content-Type": "application/json"
    };
  }

  private url(path: string): string {
    return `${this.config.baseUrl.replace(/\/$/, "")}${path}`;
  }
}

function parseStreamLine(line: string): ChatCompletionResponse | "[DONE]" | undefined {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("data:")) {
    return undefined;
  }
  const payload = trimmed.slice("data:".length).trim();
  if (payload === "[DONE]") {
    return "[DONE]";
  }
  const parsed: unknown = JSON.parse(payload);
  if (!parsed || typeof parsed !== "object") {
    return undefined;
  }
  return parsed as ChatCompletionResponse;
}

export const llmPackage = {
  provider: "openai_compatible"
} as const;
