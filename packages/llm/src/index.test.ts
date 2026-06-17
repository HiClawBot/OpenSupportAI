import { describe, expect, it } from "vitest";
import { OpenAICompatibleClient, llmPackage } from "./index";

describe("llm package skeleton", () => {
  it("declares the initial provider family", () => {
    expect(llmPackage.provider).toBe("openai_compatible");
  });

  it("generates text through an OpenAI-compatible chat endpoint", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "Hello" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
        }),
        { status: 200 }
      );
    const client = new OpenAICompatibleClient({
      baseUrl: "https://llm.example.test/v1",
      apiKey: "test",
      model: "demo",
      fetchImpl
    });

    await expect(
      client.generate({
        model: "demo",
        messages: [{ role: "user", content: "Hi" }]
      })
    ).resolves.toMatchObject({ text: "Hello", usage: { totalTokens: 2 } });
  });

  it("streams server-sent chat deltas", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n' +
              'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n' +
              "data: [DONE]\n\n"
          )
        );
        controller.close();
      }
    });
    const fetchImpl: typeof fetch = async () => new Response(stream, { status: 200 });
    const client = new OpenAICompatibleClient({
      baseUrl: "https://llm.example.test/v1",
      apiKey: "test",
      model: "demo",
      fetchImpl
    });

    const chunks: string[] = [];
    for await (const chunk of client.stream({
      model: "demo",
      messages: [{ role: "user", content: "Hi" }]
    })) {
      chunks.push(chunk.text);
    }

    expect(chunks.join("")).toBe("Hello");
  });
});
