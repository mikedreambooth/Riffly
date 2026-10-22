import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { GenerationResult } from "./generate.ts";

/** Append one JSON line per generation: handy for comparing models and prompts. */
export function logGeneration(path: string, result: GenerationResult): void {
  mkdirSync(dirname(path), { recursive: true });
  const entry = {
    at: new Date().toISOString(),
    generator: result.generator,
    ok: result.ok,
    request: result.request,
    errors: result.issues.filter((i) => i.level === "error").length,
    warnings: result.issues.filter((i) => i.level === "warning").length,
    attempts: result.attempts,
    riff: result.riff,
  };
  appendFileSync(path, JSON.stringify(entry) + "\n");
}
