import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { barTicks, parseRiff, transposeToKey, validateRiff, hasErrors, type Riff, type RiffRequest } from "@riffly/core";
import { applyRequest, type GenerationResult, type RiffGenerator } from "./generate.ts";

export interface Fixture {
  id: string;
  riff: Riff;
}

export function loadFixtures(dir: string): Fixture[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const parsed = parseRiff(readFileSync(join(dir, f), "utf8"));
      if (!parsed.ok) throw new Error(`Fixture ${f} is invalid: ${parsed.issues.map((i) => i.message).join("; ")}`);
      return { id: f.replace(/\.json$/, ""), riff: parsed.riff };
    });
}

const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));

export function scoreFixture(f: Fixture, req: RiffRequest): number {
  const m = f.riff.meta;
  if (barTicks(m.timeSignature) !== barTicks(req.timeSignature)) return -Infinity;
  if (m.tuning.join() !== req.tuning.join()) return -Infinity;
  const want = words(req.style + " " + (req.extra ?? ""));
  const have = words(m.style + " " + f.riff.title);
  let score = 0;
  for (const w of want) if (have.has(w)) score += 3;
  if (m.key.mode === req.key.mode) score += 2;
  score -= Math.abs(m.difficulty - req.difficulty) * 0.5;
  score -= Math.abs(m.tempo - req.tempo) / 40;
  return score;
}

/** Fit a riff to the requested bar count by truncating or looping its bars. */
function fitBars(riff: Riff, bars: number): Riff {
  const out = Array.from({ length: bars }, (_, i) => riff.bars[i % riff.bars.length]!);
  return { ...riff, bars: out };
}

/**
 * Stand-in for an LLM while developing: picks the best-matching hand-written
 * riff, transposes it to the requested key and fits it to the request.
 */
export class FixtureRiffGenerator implements RiffGenerator {
  readonly name = "fixture";
  private readonly fixtures: Fixture[];

  constructor(dirOrFixtures: string | Fixture[]) {
    this.fixtures = typeof dirOrFixtures === "string" ? loadFixtures(dirOrFixtures) : dirOrFixtures;
  }

  async generate(req: RiffRequest): Promise<GenerationResult> {
    const ranked = this.fixtures
      .map((f) => ({ f, score: scoreFixture(f, req) }))
      .filter((x) => x.score > -Infinity)
      .sort((a, b) => b.score - a.score);
    const pick = ranked[0]?.f;
    if (!pick) {
      return {
        ok: false, riff: null, attempts: [], generator: this.name, request: req,
        issues: [{ level: "error", code: "no_fixture",
          message: `No fixture in ${req.timeSignature.beats}/${req.timeSignature.beatUnit} with tuning ${req.tuning.join(" ")}.` }],
      };
    }

    const riff = applyRequest(fitBars(transposeToKey(pick.riff, req.key), req.bars), req);
    const issues = validateRiff(riff, req);
    return {
      ok: !hasErrors(issues),
      riff,
      issues,
      attempts: [],
      generator: `${this.name}:${pick.id}`,
      request: req,
    };
  }
}
