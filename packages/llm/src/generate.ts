import {
  hasErrors,
  parseRiff,
  riffJsonSchema,
  validateRiff,
  type Issue,
  type Riff,
  type RiffRequest,
} from "@riffly/core";
import { buildRepairPrompt, buildUserPrompt, SYSTEM_PROMPT } from "./prompt.ts";
import type { ChatMessage, LlmProvider, Usage } from "./provider.ts";

export interface Attempt {
  n: number;
  raw: string;
  issues: Issue[];
  latencyMs: number;
  usage?: Usage;
}

export interface GenerationResult {
  ok: boolean;          // true when the returned riff has no errors
  riff: Riff | null;    // best riff produced (may still have errors when ok = false)
  issues: Issue[];      // issues of the returned riff (warnings only when ok)
  attempts: Attempt[];
  generator: string;    // e.g. "gemini:gemini-3.6-flash" or "fixture:blues-rock-a-minor"
  request: RiffRequest;
}

/** Anything that turns a request into a riff: an LLM, fixtures, a human... */
export interface RiffGenerator {
  readonly name: string;
  generate(req: RiffRequest): Promise<GenerationResult>;
}

/**
 * Force the request's fixed parameters onto the riff. The LLM is asked to echo
 * them, but the request is authoritative; mismatches it caused (e.g. pitches
 * written for another tuning) then show up in validation.
 */
export function applyRequest(riff: Riff, req: RiffRequest): Riff {
  return {
    ...riff,
    meta: {
      ...riff.meta,
      style: req.style,
      key: req.key,
      tempo: req.tempo,
      timeSignature: req.timeSignature,
      tuning: req.tuning,
      difficulty: req.difficulty,
    },
  };
}

export interface LlmGeneratorOptions {
  maxAttempts?: number;
  temperature?: number;
}

export class LlmRiffGenerator implements RiffGenerator {
  readonly name: string;

  constructor(private readonly provider: LlmProvider, private readonly opts: LlmGeneratorOptions = {}) {
    this.name = `${provider.name}:${provider.model}`;
  }

  async generate(req: RiffRequest): Promise<GenerationResult> {
    const maxAttempts = this.opts.maxAttempts ?? 3;
    const messages: ChatMessage[] = [{ role: "user", content: buildUserPrompt(req) }];
    const jsonSchema = riffJsonSchema();
    const attempts: Attempt[] = [];
    let best: { riff: Riff; issues: Issue[] } | null = null;
    const errorCount = (issues: Issue[]) => issues.filter((i) => i.level === "error").length;

    for (let n = 1; n <= maxAttempts; n++) {
      const res = await this.provider.complete({
        system: SYSTEM_PROMPT,
        messages,
        jsonSchema,
        temperature: this.opts.temperature ?? 0.9,
      });
      const parsed = parseRiff(res.text);
      let issues: Issue[];
      if (parsed.ok) {
        const riff = applyRequest(parsed.riff, req);
        issues = validateRiff(riff, req);
        if (!best || errorCount(issues) < errorCount(best.issues)) best = { riff, issues };
      } else {
        issues = parsed.issues;
      }
      attempts.push({ n, raw: res.text, issues, latencyMs: res.latencyMs, usage: res.usage });
      if (!hasErrors(issues)) break;

      messages.push(
        { role: "assistant", content: res.text },
        { role: "user", content: buildRepairPrompt(issues.filter((i) => i.level === "error")) },
      );
    }

    return {
      ok: !!best && !hasErrors(best.issues),
      riff: best?.riff ?? null,
      issues: best?.issues ?? attempts.at(-1)?.issues ?? [],
      attempts,
      generator: this.name,
      request: req,
    };
  }
}
