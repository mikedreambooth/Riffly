import { RiffSchema, type Note, type Riff, type RiffRequest } from "./schema.ts";
import {
  PPQ,
  barTicks,
  bluesColourPitchClasses,
  eventTicks,
  fretToMidi,
  keyPrefersFlats,
  midiToPitch,
  pitchToMidi,
  scalePitchClasses,
} from "./theory.ts";

export type IssueLevel = "error" | "warning";

export interface Issue {
  level: IssueLevel;
  code: string;
  message: string;
  bar?: number;   // 1-based
  event?: number; // 1-based
}

export type ParseResult =
  | { ok: true; riff: Riff }
  | { ok: false; issues: Issue[] };

/** Parse raw LLM text (or an object) into a Riff, reporting schema problems as issues. */
export function parseRiff(input: unknown): ParseResult {
  let data = input;
  if (typeof input === "string") {
    try {
      data = JSON.parse(stripCodeFences(input));
    } catch (err) {
      return {
        ok: false,
        issues: [{ level: "error", code: "invalid_json", message: `Response is not valid JSON: ${(err as Error).message}` }],
      };
    }
  }
  const res = RiffSchema.safeParse(data);
  if (res.success) return { ok: true, riff: res.data };
  return {
    ok: false,
    issues: res.error.issues.slice(0, 20).map((i) => ({
      level: "error" as const,
      code: "schema",
      message: `${i.path.join(".") || "(root)"}: ${i.message}`,
    })),
  };
}

function stripCodeFences(s: string): string {
  const m = /```(?:json)?\s*([\s\S]*?)```/.exec(s);
  return (m ? m[1]! : s).trim();
}

const LEGATO = new Set(["hammerOn", "pullOff", "slide"]);
const BEND = new Set(["bend", "bendRelease"]);

interface FlatNote {
  bar: number;
  event: number;
  tick: number; // absolute start tick
  note: Note;
}

/**
 * Musical validation of a schema-valid riff. Errors mean the riff is wrong and
 * should be regenerated/repaired; warnings are worth showing but acceptable.
 */
export function validateRiff(riff: Riff, request?: RiffRequest): Issue[] {
  const issues: Issue[] = [];
  const { meta } = riff;
  const tuning = meta.tuning;
  const barLen = barTicks(meta.timeSignature);
  const beatTicks = PPQ * (4 / meta.timeSignature.beatUnit);
  const at = (bar: number, event?: number) => (event ? `Bar ${bar}, event ${event}` : `Bar ${bar}`);
  const flat: FlatNote[] = [];

  if (request && riff.bars.length !== request.bars) {
    issues.push({
      level: "error",
      code: "bar_count",
      message: `Riff has ${riff.bars.length} bars but ${request.bars} were requested.`,
    });
  }

  riff.bars.forEach((bar, bi) => {
    const b = bi + 1;
    let tick = 0;
    const tripletCounts = new Map<string, number>();

    bar.events.forEach((ev, ei) => {
      const e = ei + 1;
      const strings = new Set<number>();
      const fretted: number[] = [];
      if (ev.triplet) tripletCounts.set(ev.duration, (tripletCounts.get(ev.duration) ?? 0) + 1);

      for (const note of ev.notes) {
        const where = `${at(b, e)}, string ${note.string} fret ${note.fret}`;
        if (note.string > tuning.length) {
          issues.push({ level: "error", code: "bad_string", bar: b, event: e,
            message: `${where}: the tuning only has ${tuning.length} strings.` });
          continue;
        }
        if (strings.has(note.string)) {
          issues.push({ level: "error", code: "duplicate_string", bar: b, event: e,
            message: `${at(b, e)}: two notes on string ${note.string} at the same time.` });
        }
        strings.add(note.string);
        if (note.fret > 0) fretted.push(note.fret);

        const actual = fretToMidi(tuning, note.string, note.fret);
        if (pitchToMidi(note.pitch) !== actual) {
          issues.push({ level: "error", code: "pitch_mismatch", bar: b, event: e,
            message: `${where}: pitch is written as ${note.pitch} but string ${note.string} (open ${tuning[note.string - 1]}) at fret ${note.fret} sounds ${midiToPitch(actual, keyPrefersFlats(meta.key))}. Fix the fret or the pitch.` });
        }
        if (note.fret > 22) {
          issues.push({ level: "warning", code: "high_fret", bar: b, event: e,
            message: `${where}: fret ${note.fret} is above the 22nd fret many guitars have.` });
        }
        for (const t of note.techniques ?? []) {
          if (BEND.has(t.type) && (t.semitones ?? 0) > 3) {
            issues.push({ level: "error", code: "bend_amount", bar: b, event: e,
              message: `${where}: a ${t.semitones}-semitone bend is not physically possible; max 3.` });
          }
          if ((BEND.has(t.type) || t.type === "whammyDive") && t.semitones === undefined) {
            issues.push({ level: "error", code: "bend_amount", bar: b, event: e,
              message: `${where}: ${t.type} needs "semitones".` });
          }
          if (BEND.has(t.type) && note.fret === 0) {
            issues.push({ level: "error", code: "open_bend", bar: b, event: e,
              message: `${where}: open strings can't be bent.` });
          }
        }
        flat.push({ bar: b, event: e, tick: (b - 1) * barLen + tick, note });
      }

      if (fretted.length > 1) {
        const span = Math.max(...fretted) - Math.min(...fretted);
        if (span > 4) {
          issues.push({ level: span > 5 ? "error" : "warning", code: "chord_span", bar: b, event: e,
            message: `${at(b, e)}: notes span ${span} frets, which is ${span > 5 ? "unplayable" : "a big stretch"}.` });
        }
      }
      tick += eventTicks(ev);
    });

    if (tick !== barLen) {
      const fmt = (t: number) => `${+(t / beatTicks).toFixed(3)} beats`;
      issues.push({ level: "error", code: "bar_length", bar: b,
        message: `${at(b)}: events add up to ${fmt(tick)} but a ${meta.timeSignature.beats}/${meta.timeSignature.beatUnit} bar needs ${fmt(barLen)}. Add/remove notes or rests or change durations.` });
    }
    for (const [dur, n] of tripletCounts) {
      if (n % 3 !== 0) {
        issues.push({ level: "warning", code: "triplet_group", bar: b,
          message: `${at(b)}: ${n} triplet 1/${dur} notes; triplets normally come in groups of 3.` });
      }
    }
  });

  if (flat.length === 0) {
    issues.push({ level: "error", code: "empty", message: "The riff has no notes." });
    return issues;
  }

  // Legato techniques connect to the next note on the same string.
  flat.forEach((fn, i) => {
    for (const t of fn.note.techniques ?? []) {
      if (!LEGATO.has(t.type)) continue;
      const nextTick = flat.find((o, j) => j > i && o.tick > fn.tick)?.tick;
      const next = flat.find((o) => o.tick === nextTick && o.note.string === fn.note.string);
      const where = `${at(fn.bar, fn.event)}, string ${fn.note.string} fret ${fn.note.fret}`;
      if (!next) {
        issues.push({ level: "error", code: "legato_target", bar: fn.bar, event: fn.event,
          message: `${where}: ${t.type} must be followed by a note on the same string in the next event.` });
      } else if (t.type === "hammerOn" && next.note.fret <= fn.note.fret) {
        issues.push({ level: "error", code: "hammer_direction", bar: fn.bar, event: fn.event,
          message: `${where}: hammer-on must go to a higher fret (next note is fret ${next.note.fret}). Use pullOff or slide.` });
      } else if (t.type === "pullOff" && next.note.fret >= fn.note.fret) {
        issues.push({ level: "error", code: "pull_direction", bar: fn.bar, event: fn.event,
          message: `${where}: pull-off must go to a lower fret (next note is fret ${next.note.fret}). Use hammerOn or slide.` });
      } else if (t.type === "slide" && next.note.fret === fn.note.fret) {
        issues.push({ level: "error", code: "slide_target", bar: fn.bar, event: fn.event,
          message: `${where}: slide target is the same fret.` });
      }
    }
  });

  // Fast, wide position shifts.
  const secondsPerTick = 60 / meta.tempo / PPQ;
  for (let i = 1; i < flat.length; i++) {
    const a = flat[i - 1]!, b = flat[i]!;
    if (a.note.fret === 0 || b.note.fret === 0 || a.tick === b.tick) continue;
    const gap = (b.tick - a.tick) * secondsPerTick;
    const jump = Math.abs(b.note.fret - a.note.fret);
    if (jump > 7 && gap < 0.2) {
      issues.push({ level: "warning", code: "position_jump", bar: b.bar, event: b.event,
        message: `${at(b.bar, b.event)}: ${jump}-fret jump in ${Math.round(gap * 1000)} ms is very hard to play.` });
    }
  }

  // Key adherence. Blue notes are fine; a few chromatic passing notes are fine.
  const scale = scalePitchClasses(meta.key);
  const colour = bluesColourPitchClasses(meta.key);
  const pitched = flat.filter((f) => !f.note.techniques?.some((t) => t.type === "deadNote"));
  const outside = pitched.filter((f) => {
    const pc = fretToMidi(tuning, f.note.string, f.note.fret) % 12;
    return !scale.has(pc) && !colour.has(pc);
  });
  const keyName = `${meta.key.tonic} ${meta.key.mode}`;
  if (pitched.length > 0 && outside.length / pitched.length > 0.25) {
    issues.push({ level: "error", code: "off_key",
      message: `${outside.length} of ${pitched.length} notes are outside ${keyName}; the riff should be in ${keyName}.` });
  } else {
    for (const f of outside) {
      issues.push({ level: "warning", code: "chromatic", bar: f.bar, event: f.event,
        message: `${at(f.bar, f.event)}: ${f.note.pitch} is outside ${keyName} (fine if it's a passing note).` });
    }
  }

  return issues;
}

export const hasErrors = (issues: Issue[]) => issues.some((i) => i.level === "error");
