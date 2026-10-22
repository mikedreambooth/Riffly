import { z } from "zod";

/**
 * Riffly riff format, version 1.
 *
 * A riff is a list of bars; each bar is a sequence of events (beats) played one
 * after another; each event has a duration and zero or more notes (zero = rest,
 * more than one = double-stop/chord). Notes are tab-first: string + fret is the
 * source of truth and `pitch` is a cross-check the generator must agree with.
 *
 * String numbering follows tab convention: string 1 is the highest-pitched
 * (thinnest) string. `meta.tuning[i]` is the open pitch of string i + 1.
 */

export const NOTE_NAMES = [
  "C", "C#", "Db", "D", "D#", "Eb", "E", "F", "F#", "Gb", "G", "G#", "Ab", "A", "A#", "Bb", "B",
] as const;

export const MODES = [
  "major", "minor", "dorian", "phrygian", "lydian", "mixolydian", "locrian", "harmonicMinor",
] as const;

export const DURATIONS = ["1", "2", "4", "8", "16", "32"] as const;

export const TONES = ["clean", "crunch", "overdrive", "distortion", "acoustic", "nylon"] as const;

export const TECHNIQUES = [
  "bend",        // pick, then bend up by `semitones` (pitch/fret are the unbent note)
  "bendRelease", // bend up by `semitones` and back down within the note
  "vibrato",     // `wide: true` for a wide vibrato
  "hammerOn",    // legato into the NEXT note on the same string (must be higher)
  "pullOff",     // legato into the NEXT note on the same string (must be lower)
  "slide",       // slide into the NEXT note on the same string
  "palmMute",
  "letRing",
  "deadNote",    // muted "x" note; fret is where the hand sits
  "harmonic",    // natural harmonic
  "pinchHarmonic", // picked "squeal": pick and thumb together, sounds an overtone
  "tap",         // picking-hand tap on the fret (usually followed by a pullOff)
  "whammyDive",  // whammy-bar dive down by `semitones` during the note (open strings OK)
  "accent",
] as const;

const pitchPattern = /^[A-G](#|b)?-?\d$/;

export const PitchSchema = z
  .string()
  .regex(pitchPattern)
  .describe('Scientific pitch, e.g. "E2", "C#4", "Bb3". Middle C is C4.');

export const KeySchema = z.object({
  tonic: z.enum(NOTE_NAMES),
  mode: z.enum(MODES),
});

export const TimeSignatureSchema = z.object({
  beats: z.number().int().min(1).max(16),
  beatUnit: z.union([z.literal(2), z.literal(4), z.literal(8), z.literal(16)]),
});

export const TechniqueSchema = z.object({
  type: z.enum(TECHNIQUES),
  semitones: z
    .number()
    .min(0.5)
    .max(12)
    .optional()
    .describe("Required for bend/bendRelease (0.5 = quarter-tone, 1 = half step, 2 = whole step, max 3) and whammyDive (depth, up to 12)"),
  wide: z.boolean().optional().describe("vibrato only: wide vibrato"),
});

export const NoteSchema = z.object({
  string: z.number().int().min(1).max(8).describe("1 = highest-pitched string"),
  fret: z.number().int().min(0).max(24),
  pitch: PitchSchema.describe("Pitch of string+fret (before any bend). Must match the tuning."),
  techniques: z.array(TechniqueSchema).optional(),
});

export const EventSchema = z.object({
  duration: z.enum(DURATIONS).describe('"4" = quarter, "8" = eighth, "16" = sixteenth, ...'),
  dotted: z.boolean().optional(),
  triplet: z.boolean().optional().describe("Part of a triplet: duration is 2/3 of normal"),
  notes: z.array(NoteSchema).describe("Notes struck together. Empty array = rest."),
});

export const BarSchema = z.object({
  events: z.array(EventSchema).min(1),
});

export const MetaSchema = z.object({
  style: z.string().min(1),
  key: KeySchema,
  tempo: z.number().int().min(30).max(300).describe("Quarter-note BPM"),
  timeSignature: TimeSignatureSchema,
  tuning: z.array(PitchSchema).min(4).max(8).describe("Open pitch of string 1 (highest) first"),
  tone: z.enum(TONES),
  difficulty: z.number().int().min(1).max(5),
});

export const RiffSchema = z.object({
  version: z.literal(1),
  title: z.string().min(1).max(80),
  meta: MetaSchema,
  bars: z.array(BarSchema).min(1).max(32),
  tips: z.string().max(400).optional().describe("One or two sentences of advice for the player"),
});

export type Key = z.infer<typeof KeySchema>;
export type Mode = (typeof MODES)[number];
export type NoteName = (typeof NOTE_NAMES)[number];
export type Duration = (typeof DURATIONS)[number];
export type Tone = (typeof TONES)[number];
export type TechniqueType = (typeof TECHNIQUES)[number];
export type TimeSignature = z.infer<typeof TimeSignatureSchema>;
export type Technique = z.infer<typeof TechniqueSchema>;
export type Note = z.infer<typeof NoteSchema>;
export type RiffEvent = z.infer<typeof EventSchema>;
export type Bar = z.infer<typeof BarSchema>;
export type RiffMeta = z.infer<typeof MetaSchema>;
export type Riff = z.infer<typeof RiffSchema>;

/** What the user asks for. Everything except `style` has a default. */
export const RiffRequestSchema = z.object({
  style: z.string().min(1).max(120),
  key: KeySchema.default({ tonic: "A", mode: "minor" }),
  tempo: z.number().int().min(30).max(300).default(100),
  bars: z.number().int().min(1).max(16).default(4),
  timeSignature: TimeSignatureSchema.default({ beats: 4, beatUnit: 4 }),
  difficulty: z.number().int().min(1).max(5).default(3),
  tuning: z.array(PitchSchema).min(4).max(8).default(["E4", "B3", "G3", "D3", "A2", "E2"]),
  extra: z.string().max(500).optional().describe("Free-text extra instructions"),
});

export type RiffRequest = z.infer<typeof RiffRequestSchema>;
export type RiffRequestInput = z.input<typeof RiffRequestSchema>;

/** JSON Schema of the riff format, used to constrain LLM output. */
export function riffJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(RiffSchema, { target: "draft-7" }) as Record<string, unknown>;
}
