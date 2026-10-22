import type { Key, Riff } from "./schema.ts";
import { fretToMidi, keyPrefersFlats, midiToPitch, tonicDelta } from "./theory.ts";

/** Recompute every note's `pitch` from string + fret, spelled for the riff's key. */
export function respellPitches(riff: Riff): Riff {
  const flats = keyPrefersFlats(riff.meta.key);
  return {
    ...riff,
    bars: riff.bars.map((bar) => ({
      events: bar.events.map((ev) => ({
        ...ev,
        notes: ev.notes.map((n) => ({
          ...n,
          pitch: midiToPitch(fretToMidi(riff.meta.tuning, n.string, n.fret), flats),
        })),
      })),
    })),
  };
}

/**
 * Move a riff to a new key by shifting every fret by the same amount, keeping
 * the shape. Open strings become fretted notes. Octave-shifts to stay on the neck.
 */
export function transposeToKey(riff: Riff, key: Key): Riff {
  let delta = tonicDelta(riff.meta.key.tonic, key.tonic);
  const frets = riff.bars.flatMap((b) => b.events.flatMap((e) => e.notes.map((n) => n.fret)));
  const min = Math.min(...frets), max = Math.max(...frets);
  if (min + delta < 0) delta += 12;
  else if (max + delta > 22) delta -= 12;
  if (min + delta < 0) delta += 12; // still off the neck: give up shifting down

  const shifted: Riff = {
    ...riff,
    meta: { ...riff.meta, key },
    bars: riff.bars.map((bar) => ({
      events: bar.events.map((ev) => ({
        ...ev,
        notes: ev.notes.map((n) => ({ ...n, fret: n.fret + delta })),
      })),
    })),
  };
  return respellPitches(shifted);
}
