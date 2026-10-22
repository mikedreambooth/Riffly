import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as ToneMidi from "@tonejs/midi";
import {
  hasErrors, keyPrefersFlats, parseKey, parseRiff, pitchToMidi, riffToAscii, riffToMidi,
  renderRiffAudio, RiffRequestSchema, riffToWav, transposeToKey, validateRiff, type Riff,
} from "../src/index.ts";

const Midi = ToneMidi.Midi ?? (ToneMidi as unknown as { default: typeof ToneMidi }).default.Midi;
const fixtureDir = new URL("../../../fixtures/riffs/", import.meta.url);
const load = (name: string): Riff => {
  const parsed = parseRiff(readFileSync(new URL(name, fixtureDir), "utf8"));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.riff;
};
const clone = (r: Riff): Riff => structuredClone(r);
const codes = (r: Riff) => validateRiff(r).filter((i) => i.level === "error").map((i) => i.code);

describe("theory", () => {
  it("converts pitches to MIDI numbers", () => {
    expect(pitchToMidi("C4")).toBe(60);
    expect(pitchToMidi("E2")).toBe(40);
    expect(pitchToMidi("Bb3")).toBe(pitchToMidi("A#3"));
  });

  it("parses keys", () => {
    expect(parseKey("A minor")).toEqual({ tonic: "A", mode: "minor" });
    expect(parseKey("Am")).toEqual({ tonic: "A", mode: "minor" });
    expect(parseKey("F# dorian")).toEqual({ tonic: "F#", mode: "dorian" });
    expect(parseKey("Bb")).toEqual({ tonic: "Bb", mode: "major" });
    expect(() => parseKey("H minor")).toThrow();
  });

  it("knows flat keys", () => {
    expect(keyPrefersFlats({ tonic: "D", mode: "minor" })).toBe(true);
    expect(keyPrefersFlats({ tonic: "E", mode: "minor" })).toBe(false);
    expect(keyPrefersFlats({ tonic: "F", mode: "major" })).toBe(true);
  });
});

describe("fixtures", () => {
  const files = readdirSync(fixtureDir).filter((f) => f.endsWith(".json"));
  it.each(files)("%s is a valid riff", (f) => {
    const issues = validateRiff(load(f));
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
  });
});

describe("validateRiff", () => {
  const base = load("blues-rock-a-minor.json");

  it("rejects bars that don't add up", () => {
    const r = clone(base);
    r.bars[0]!.events.pop();
    expect(codes(r)).toContain("bar_length");
  });

  it("rejects pitches that don't match string + fret", () => {
    const r = clone(base);
    r.bars[0]!.events[1]!.notes[0]!.pitch = "B4";
    expect(codes(r)).toContain("pitch_mismatch");
  });

  it("rejects hammer-ons that go down", () => {
    const r = clone(base);
    // bar 1 event 6 is fret 5 hammerOn -> fret 7; make the target lower
    r.bars[0]!.events[6]!.notes[0] = { string: 3, fret: 4, pitch: "B3" };
    expect(codes(r)).toContain("hammer_direction");
  });

  it("rejects bending open strings and missing bend amounts", () => {
    const r = clone(base);
    r.bars[1]!.events[0]!.notes[0]!.techniques = [{ type: "bend" }];
    expect(codes(r)).toEqual(expect.arrayContaining(["bend_amount", "open_bend"]));
  });

  it("rejects riffs mostly outside the key", () => {
    const r = clone(base);
    r.meta.key = { tonic: "F#", mode: "major" };
    expect(codes(r)).toContain("off_key");
  });

  it("checks bar count against the request", () => {
    const req = RiffRequestSchema.parse({ style: "blues", bars: 8 });
    expect(validateRiff(base, req).map((i) => i.code)).toContain("bar_count");
  });
});

describe("transposeToKey", () => {
  it("keeps the riff valid in the new key", () => {
    const r = transposeToKey(load("blues-rock-a-minor.json"), { tonic: "E", mode: "minor" });
    expect(r.meta.key.tonic).toBe("E");
    expect(hasErrors(validateRiff(r))).toBe(false);
  });
});

describe("riffToMidi", () => {
  it("round-trips notes, tempo and bends", () => {
    const riff = load("blues-rock-a-minor.json");
    const midi = new Midi(riffToMidi(riff));
    expect(midi.header.tempos[0]!.bpm).toBeCloseTo(92, 0);
    const track = midi.tracks[0]!;
    const noteCount = riff.bars.flatMap((b) => b.events.flatMap((e) => e.notes)).length;
    expect(track.notes).toHaveLength(noteCount);
    expect(track.notes[0]!.midi).toBe(pitchToMidi("G4"));
    expect(track.instrument.number).toBe(29);
    expect(track.pitchBends.length).toBeGreaterThan(0);
  });

  it("adds a count-in track and shifts the riff", () => {
    const riff = load("beginner-rock-a-minor.json");
    const midi = new Midi(riffToMidi(riff, { countInBars: 1 }));
    expect(midi.tracks).toHaveLength(2);
    expect(midi.tracks[0]!.notes[0]!.ticks).toBe(4 * 480);
    expect(midi.tracks[1]!.notes).toHaveLength(4);
  });
});

describe("riffToAscii", () => {
  it("renders techniques", () => {
    const tab = riffToAscii(load("blues-rock-a-minor.json"));
    expect(tab).toContain("8b10");
    expect(tab).toContain("5h");
    expect(tab).toContain("PM");
  });
});

describe("audio", () => {
  it("renders the riff at the right length with sane levels", () => {
    const riff = load("beginner-rock-a-minor.json"); // 4 bars of 4/4 at 80 BPM = 12 s
    const { samples, sampleRate } = renderRiffAudio(riff, { sampleRate: 16000 });
    const seconds = samples.length / sampleRate;
    expect(seconds).toBeGreaterThan(12);
    expect(seconds).toBeLessThan(14);
    let peak = 0;
    for (const v of samples) {
      expect(Number.isFinite(v)).toBe(true);
      peak = Math.max(peak, Math.abs(v));
    }
    expect(peak).toBeCloseTo(0.89, 2);
  });

  it("writes a valid WAV header", () => {
    const wav = riffToWav(load("folk-waltz-g-major-3-4.json"), { sampleRate: 8000 });
    const text = new TextDecoder().decode(wav.subarray(0, 16));
    expect(text.startsWith("RIFF")).toBe(true);
    expect(text.slice(8, 16)).toBe("WAVEfmt ");
    expect(new DataView(wav.buffer).getUint32(24, true)).toBe(8000);
  });
});
