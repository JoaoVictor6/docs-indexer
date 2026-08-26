import type { AppConfig } from "./config";

export interface EmbeddingClient {
  embed(text: string): Promise<number[]>;
}

export function createEmbeddingClient(config: AppConfig): EmbeddingClient {
  return new OpenRouterEmbeddingClient(config);
}

class OpenRouterEmbeddingClient implements EmbeddingClient {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(config: AppConfig) {
    this.apiKey = config.openrouterApiKey;
    this.baseUrl = config.openrouterBaseUrl;
    this.model = config.embeddingModel;
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        input: [text],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter returned ${response.status}`);
    }

    const result = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };

    if (!result.data || result.data.length === 0) {
      throw new Error("OpenRouter returned no embeddings");
    }

    return result.data[0].embedding;
  }
}
