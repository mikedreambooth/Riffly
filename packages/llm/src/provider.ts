/** Minimal, provider-agnostic interface for "give me JSON matching this schema". */

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface JsonCompletionRequest {
  system: string;
  messages: ChatMessage[];
  jsonSchema: Record<string, unknown>;
  temperature?: number;
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface JsonCompletion {
  text: string;
  model: string;
  usage?: Usage;
  latencyMs: number;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  complete(req: JsonCompletionRequest): Promise<JsonCompletion>;
}

/**
 * Rewrite a JSON Schema into the conservative subset most LLM structured-output
 * APIs accept: no $schema, no regex patterns, `const` expressed as `enum`,
 * unions of constants collapsed into a single enum, and numeric enums moved
 * into the description. The validator still enforces
 * everything that gets dropped here.
 */
export function toPortableSchema(schema: unknown): unknown {
  return demoteNumericEnums(normalize(schema));
}

function mapSchema(schema: unknown, fn: (node: Record<string, unknown>) => Record<string, unknown>): unknown {
  if (Array.isArray(schema)) return schema.map((s) => mapSchema(s, fn));
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) out[k] = mapSchema(v, fn);
  return fn(out);
}

function normalize(schema: unknown): unknown {
  return mapSchema(schema, (node) => {
    const { $schema: _s, pattern: _p, const: constant, ...out } = node;
    if ("const" in node) out.enum = [constant];
    const union = (out.anyOf ?? out.oneOf) as Record<string, unknown>[] | undefined;
    if (union?.every((s) => Array.isArray(s.enum) && s.enum.length === 1)) {
      delete out.anyOf;
      delete out.oneOf;
      const values = union.map((s) => (s.enum as unknown[])[0]);
      out.type = typeof values[0] === "number" ? "number" : "string";
      out.enum = values;
    }
    return out;
  });
}

// Numeric enums are poorly supported; move them into the description instead.
function demoteNumericEnums(schema: unknown): unknown {
  return mapSchema(schema, (node) => {
    if (!Array.isArray(node.enum) || !node.enum.some((v) => typeof v === "number")) return node;
    const { enum: values, ...out } = node;
    const allowed = `Must be one of: ${(values as unknown[]).join(", ")}.`;
    out.description = out.description ? `${out.description}. ${allowed}` : allowed;
    out.type ??= "number";
    return out;
  });
}

/**
 * Plays back pre-written responses in order: lets a human (or another model in
 * another tool) stand in for the LLM while exercising the real generation loop.
 */
export class ReplayProvider implements LlmProvider {
  readonly name = "replay";
  readonly model: string;
  readonly calls: JsonCompletionRequest[] = [];

  constructor(private readonly responses: string[], model = "scripted") {
    this.model = model;
  }

  async complete(req: JsonCompletionRequest): Promise<JsonCompletion> {
    this.calls.push(structuredClone(req));
    const text = this.responses[this.calls.length - 1];
    if (text === undefined) throw new Error(`Replay ran out of responses after ${this.responses.length}`);
    return { text, model: this.model, latencyMs: 0 };
  }
}
