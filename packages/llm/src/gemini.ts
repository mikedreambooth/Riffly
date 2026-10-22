import { GoogleGenAI } from "@google/genai";
import { toPortableSchema, type JsonCompletion, type JsonCompletionRequest, type LlmProvider } from "./provider.ts";

export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";

export interface GeminiOptions {
  model?: string;
  /** Defaults to GEMINI_API_KEY / GOOGLE_API_KEY, or Vertex AI via GOOGLE_GENAI_USE_VERTEXAI. */
  apiKey?: string;
}

export class GeminiProvider implements LlmProvider {
  readonly name = "gemini";
  readonly model: string;
  private readonly ai: GoogleGenAI;

  constructor(opts: GeminiOptions = {}) {
    this.model = opts.model ?? process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;
    const env = process.env;
    const vertex = /^(true|1)$/i.test(env.GOOGLE_GENAI_USE_VERTEXAI ?? "");
    if (!opts.apiKey && !env.GEMINI_API_KEY && !env.GOOGLE_API_KEY && !vertex) {
      throw new Error(
        "Gemini credentials not found: set GEMINI_API_KEY (or GOOGLE_API_KEY), or GOOGLE_GENAI_USE_VERTEXAI=true " +
          "with GOOGLE_CLOUD_PROJECT/GOOGLE_CLOUD_LOCATION. See .env.example.",
      );
    }
    // With no apiKey the SDK reads the standard Google env vars (API key or Vertex AI ADC).
    this.ai = new GoogleGenAI(opts.apiKey ? { apiKey: opts.apiKey } : {});
  }

  async complete(req: JsonCompletionRequest): Promise<JsonCompletion> {
    const started = Date.now();
    const res = await this.ai.models.generateContent({
      model: this.model,
      contents: req.messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      config: {
        systemInstruction: req.system,
        responseMimeType: "application/json",
        responseJsonSchema: toPortableSchema(req.jsonSchema),
        temperature: req.temperature,
      },
    });
    const text = res.text;
    if (!text) {
      const reason = res.candidates?.[0]?.finishReason ?? res.promptFeedback?.blockReason ?? "unknown";
      throw new Error(`Gemini returned no text (reason: ${reason})`);
    }
    return {
      text,
      model: res.modelVersion ?? this.model,
      usage: {
        inputTokens: res.usageMetadata?.promptTokenCount,
        outputTokens: res.usageMetadata?.candidatesTokenCount,
      },
      latencyMs: Date.now() - started,
    };
  }
}
