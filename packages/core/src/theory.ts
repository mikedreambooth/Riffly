import { MODES, NOTE_NAMES, type Duration, type Key, type Mode, type NoteName, type RiffEvent, type TimeSignature } from "./schema.ts";

/** MIDI ticks per quarter note used everywhere in Riffly. */
export const PPQ = 480;

const PITCH_CLASS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

export const STANDARD_TUNING = ["E4", "B3", "G3", "D3", "A2", "E2"];

export const TUNINGS: Record<string, string[]> = {
  standard: STANDARD_TUNING,
  dropD: ["E4", "B3", "G3", "D3", "A2", "D2"],
  halfStepDown: ["Eb4", "Bb3", "Gb3", "Db3", "Ab2", "Eb2"],
  dStandard: ["D4", "A3", "F3", "C3", "G2", "D2"],
  dropC: ["D4", "A3", "F3", "C3", "G2", "C2"],
};

const MODE_INTERVALS: Record<Mode, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
};

export function pitchClass(name: string): number {
  const base = PITCH_CLASS[name[0]!];
  if (base === undefined) throw new Error(`Bad note name: ${name}`);
  const acc = name[1] === "#" ? 1 : name[1] === "b" ? -1 : 0;
  return (base + acc + 12) % 12;
}

/** "C#4" -> 61. Throws on malformed input. */
export function pitchToMidi(pitch: string): number {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(pitch);
  if (!m) throw new Error(`Bad pitch: ${pitch}`);
  const [, letter, acc = "", octave] = m;
  // Use the raw letter + accidental offset so "B#3" / "Cb4" style octave edges stay correct.
  return (Number(octave) + 1) * 12 + PITCH_CLASS[letter!]! + (acc === "#" ? 1 : acc === "b" ? -1 : 0);
}

export function midiToPitch(midi: number, preferFlats = false): string {
  const names = preferFlats ? FLAT_NAMES : SHARP_NAMES;
  return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

/** Keys conventionally spelled with flats (F major, D minor, Bb..., etc.). */
export function keyPrefersFlats(key: Key): boolean {
  if (key.tonic.includes("b")) return true;
  if (key.tonic.includes("#")) return false;
  // Relative-major tonic decides: flat keys are F, Bb, Eb, Ab, Db, Gb.
  const majorOffset: Record<Mode, number> = {
    major: 0, minor: 3, dorian: -2, phrygian: -4, lydian: -5, mixolydian: -7, locrian: 1, harmonicMinor: 3,
  };
  const relMajor = (pitchClass(key.tonic) + majorOffset[key.mode] + 24) % 12;
  return [5, 10, 3, 8, 1, 6].includes(relMajor);
}

export function scalePitchClasses(key: Key): Set<number> {
  const root = pitchClass(key.tonic);
  return new Set(MODE_INTERVALS[key.mode].map((i) => (root + i) % 12));
}

/** Blue notes / chromatic colour notes that are idiomatic in many rock & blues styles. */
export function bluesColourPitchClasses(key: Key): Set<number> {
  const root = pitchClass(key.tonic);
  // b3, b5, b7 relative to the tonic (b3 and b7 matter in major keys).
  return new Set([3, 6, 10].map((i) => (root + i) % 12));
}

export function fretToMidi(tuning: string[], string: number, fret: number): number {
  const open = tuning[string - 1];
  if (open === undefined) throw new Error(`String ${string} not in tuning`);
  return pitchToMidi(open) + fret;
}

const DURATION_QUARTERS: Record<Duration, number> = {
  "1": 4, "2": 2, "4": 1, "8": 0.5, "16": 0.25, "32": 0.125,
};

export function eventTicks(e: Pick<RiffEvent, "duration" | "dotted" | "triplet">): number {
  let q = DURATION_QUARTERS[e.duration];
  if (e.dotted) q *= 1.5;
  if (e.triplet) q *= 2 / 3;
  return Math.round(q * PPQ);
}

export function barTicks(ts: TimeSignature): number {
  return Math.round(ts.beats * (4 / ts.beatUnit) * PPQ);
}

/** Semitones to move from `from` tonic to `to` tonic, in the range -6..5. */
export function tonicDelta(from: string, to: string): number {
  let d = (pitchClass(to) - pitchClass(from) + 12) % 12;
  if (d > 5) d -= 12;
  return d;
}

const MODE_ALIASES: Record<string, Mode> = {
  "": "major", maj: "major", m: "minor", min: "minor", aeolian: "minor", ionian: "major",
  "harmonic minor": "harmonicMinor", harmonicminor: "harmonicMinor",
};

/** Parse "A minor", "Am", "F# dorian", "Bb" (major) into a Key. */
export function parseKey(text: string): Key {
  const m = /^\s*([A-Ga-g])([#b]?)\s*(.*?)\s*$/.exec(text);
  if (!m) throw new Error(`Can't parse key "${text}"`);
  const tonic = (m[1]!.toUpperCase() + m[2]) as NoteName;
  const modeText = m[3]!.toLowerCase();
  const mode = MODE_ALIASES[modeText] ?? MODES.find((x) => x.toLowerCase() === modeText);
  if (!NOTE_NAMES.includes(tonic) || !mode) throw new Error(`Can't parse key "${text}"`);
  return { tonic, mode };
}
