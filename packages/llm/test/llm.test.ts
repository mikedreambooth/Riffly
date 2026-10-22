import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RiffRequestSchema, type Riff } from "@riffly/core";
import {
  DEFAULT_FIXTURE_DIR, FixtureRiffGenerator, LlmRiffGenerator, toPortableSchema,
  type JsonCompletionRequest, type LlmProvider,
} from "../src/index.ts";

const blues = JSON.parse(
  readFileSync(new URL("../../../fixtures/riffs/blues-rock-a-minor.json", import.meta.url), "utf8"),
) as Riff;

/** Replays canned responses and records what it was asked. */
class ScriptedProvider implements LlmProvider {
  readonly name = "scripted";
  readonly model = "test";
  readonly calls: JsonCompletionRequest[] = [];
  constructor(private readonly responses: string[]) {}
  async complete(req: JsonCompletionRequest) {
    this.calls.push(structuredClone(req));
    return { text: this.responses[this.calls.length - 1]!, model: this.model, latencyMs: 1 };
  }
}

const request = RiffRequestSchema.parse({ style: "blues rock", key: { tonic: "A", mode: "minor" }, tempo: 92, bars: 4 });

describe("LlmRiffGenerator", () => {
  it("accepts a good riff first time", async () => {
    const provider = new ScriptedProvider([JSON.stringify(blues)]);
    const result = await new LlmRiffGenerator(provider).generate(request);
    expect(result.ok).toBe(true);
    expect(result.attempts).toHaveLength(1);
    expect(provider.calls[0]!.messages[0]!.content).toContain("exactly 4 bars");
  });

  it("feeds validation errors back and retries", async () => {
    const broken = structuredClone(blues);
    broken.bars[0]!.events.pop(); // bar 1 is now a quarter short
    const provider = new ScriptedProvider(["not json at all", JSON.stringify(broken), JSON.stringify(blues)]);
    const result = await new LlmRiffGenerator(provider).generate(request);

    expect(result.ok).toBe(true);
    expect(result.attempts.map((a) => a.issues.some((i) => i.level === "error"))).toEqual([true, true, false]);
    const repair = provider.calls[2]!.messages.at(-1)!.content;
    expect(repair).toContain("Bar 1: events add up to 3 beats");
    expect(provider.calls[2]!.messages).toHaveLength(5);
  });

  it("gives up after maxAttempts and returns the best riff", async () => {
    const broken = structuredClone(blues);
    broken.bars[0]!.events.pop();
    const provider = new ScriptedProvider([JSON.stringify(broken), "{}"]);
    const result = await new LlmRiffGenerator(provider, { maxAttempts: 2 }).generate(request);
    expect(result.ok).toBe(false);
    expect(result.riff?.title).toBe(blues.title);
    expect(result.issues.some((i) => i.code === "bar_length")).toBe(true);
  });

  it("forces request parameters onto the riff", async () => {
    const provider = new ScriptedProvider([JSON.stringify({ ...blues, meta: { ...blues.meta, tempo: 200 } })]);
    const result = await new LlmRiffGenerator(provider).generate(request);
    expect(result.riff?.meta.tempo).toBe(92);
  });
});

describe("FixtureRiffGenerator", () => {
  const gen = new FixtureRiffGenerator(DEFAULT_FIXTURE_DIR);

  it("picks a matching fixture and fits it to the request", async () => {
    const req = RiffRequestSchema.parse({ style: "heavy metal", key: { tonic: "F#", mode: "minor" }, bars: 2, tempo: 170 });
    const result = await gen.generate(req);
    expect(result.generator).toBe("fixture:metal-gallop-e-minor");
    expect(result.ok).toBe(true);
    expect(result.riff!.bars).toHaveLength(2);
    expect(result.riff!.meta).toMatchObject({ tempo: 170, key: { tonic: "F#", mode: "minor" } });
  });

  it("loops short fixtures to the requested length", async () => {
    const req = RiffRequestSchema.parse({ style: "slow blues", timeSignature: { beats: 12, beatUnit: 8 }, bars: 4 });
    const result = await gen.generate(req);
    expect(result.ok).toBe(true);
    expect(result.riff!.bars).toHaveLength(4);
  });

  it("uses drop D fixtures for drop D requests", async () => {
    const req = RiffRequestSchema.parse({ style: "metal", tuning: ["E4", "B3", "G3", "D3", "A2", "D2"] });
    expect((await gen.generate(req)).generator).toBe("fixture:drop-d-metal-d-minor");
  });
});

describe("toPortableSchema", () => {
  it("strips unsupported keywords", () => {
    const out = toPortableSchema({
      $schema: "x",
      type: "object",
      properties: {
        version: { type: "number", const: 1 },
        unit: { anyOf: [{ type: "number", const: 2 }, { type: "number", const: 4 }] },
        pitch: { type: "string", pattern: "^[A-G]$" },
        mode: { type: "string", enum: ["major", "minor"] },
      },
    });
    expect(out).toEqual({
      type: "object",
      properties: {
        version: { type: "number", description: "Must be one of: 1." },
        unit: { type: "number", description: "Must be one of: 2, 4." },
        pitch: { type: "string" },
        mode: { type: "string", enum: ["major", "minor"] },
      },
    });
  });
});
