import { fileURLToPath } from "node:url";
import { FixtureRiffGenerator } from "./fixtures.ts";
import { GeminiProvider } from "./gemini.ts";
import { LlmRiffGenerator, type RiffGenerator } from "./generate.ts";

export * from "./provider.ts";
export * from "./gemini.ts";
export * from "./prompt.ts";
export * from "./generate.ts";
export * from "./fixtures.ts";
export * from "./log.ts";

export const DEFAULT_FIXTURE_DIR = fileURLToPath(new URL("../../../fixtures/riffs", import.meta.url));

/** Build the generator selected by RIFFLY_PROVIDER ("fixture" by default, or "gemini"). */
export function generatorFromEnv(env: NodeJS.ProcessEnv = process.env): RiffGenerator {
  const provider = env.RIFFLY_PROVIDER ?? "fixture";
  switch (provider) {
    case "gemini":
      return new LlmRiffGenerator(new GeminiProvider({ model: env.GEMINI_MODEL }), {
        maxAttempts: env.RIFFLY_MAX_ATTEMPTS ? Number(env.RIFFLY_MAX_ATTEMPTS) : undefined,
      });
    case "fixture":
      return new FixtureRiffGenerator(env.RIFFLY_FIXTURE_DIR ?? DEFAULT_FIXTURE_DIR);
    default:
      throw new Error(`Unknown RIFFLY_PROVIDER "${provider}" (expected "gemini" or "fixture")`);
  }
}
