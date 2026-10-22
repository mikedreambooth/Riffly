import * as ToneMidi from "@tonejs/midi";
import type { Riff, Tone } from "./schema.ts";
import { PPQ, barTicks, eventTicks, fretToMidi } from "./theory.ts";

// @tonejs/midi is CommonJS in Node and ESM in the browser; handle both shapes.
const Midi: typeof ToneMidi.Midi =
  ToneMidi.Midi ?? (ToneMidi as unknown as { default: typeof ToneMidi }).default.Midi;

/** General MIDI programs (0-based) per tone. */
const PROGRAMS: Record<Tone, number> = {
  nylon: 24,
  acoustic: 25,
  clean: 27,
  crunch: 29,
  overdrive: 29,
  distortion: 30,
};

/** Pitch-bend range we program into the synth, in semitones. */
const BEND_RANGE = 12;

export interface BendPoint {
  tick: number;      // absolute
  semitones: number; // offset from the note's pitch
}

/** A note as it should sound: the bridge between the tab and MIDI (and, later, scoring). */
export interface PerformedNote {
  bar: number;   // 1-based
  event: number; // 1-based
  string: number;
  fret: number;
  midi: number;
  tick: number;
  durationTicks: number;
  velocity: number; // 0..1
  legato: boolean;  // reached by hammer-on / pull-off / slide (no pick attack)
  bend: BendPoint[];
}

/** Expand a riff into concrete timed notes, applying techniques. */
export function performRiff(riff: Riff): PerformedNote[] {
  const { meta } = riff;
  const barLen = barTicks(meta.timeSignature);
  const beatLen = PPQ * (4 / meta.timeSignature.beatUnit);
  const ticksPerSecond = (meta.tempo / 60) * PPQ;
  const out: PerformedNote[] = [];
  let legatoStrings = new Set<number>();
  const slides: number[] = [];

  riff.bars.forEach((bar, bi) => {
    let tick = bi * barLen;
    bar.events.forEach((ev, ei) => {
      const len = eventTicks(ev);
      const nextLegato = new Set<number>();

      for (const note of ev.notes) {
        const tech = new Map((note.techniques ?? []).map((t) => [t.type, t]));
        let midi = fretToMidi(meta.tuning, note.string, note.fret);
        let duration = Math.round(len * 0.95);
        const onBeat = (tick - bi * barLen) % beatLen === 0;
        let velocity = onBeat ? 0.85 : 0.75;
        const legato = legatoStrings.has(note.string);

        if (legato) velocity -= 0.15;
        if (tech.has("accent")) velocity += 0.12;
        if (tech.has("palmMute")) { duration = Math.round(len * 0.45); velocity -= 0.1; }
        if (tech.has("deadNote")) { duration = Math.min(duration, PPQ / 8); velocity = 0.5; }
        if (tech.has("letRing")) duration = len * 2;
        if (tech.has("harmonic")) midi += note.fret === 7 || note.fret === 19 ? 19 : note.fret === 5 ? 24 : 12;
        if (tech.has("pinchHarmonic")) { midi += 19; velocity += 0.1; } // the octave-plus-fifth squeal
        if (tech.has("hammerOn") || tech.has("pullOff") || tech.has("slide")) {
          duration = len; // connect into the next note
          nextLegato.add(note.string);
        }

        const bend: BendPoint[] = [];
        const b = tech.get("bend") ?? tech.get("bendRelease");
        if (b?.semitones) {
          const rise = Math.min(Math.round(duration * 0.35), PPQ / 2);
          bend.push({ tick, semitones: 0 }, { tick: tick + rise, semitones: b.semitones });
          if (b.type === "bendRelease") {
            const fallStart = tick + Math.round(duration * 0.6);
            bend.push({ tick: fallStart, semitones: b.semitones },
              { tick: fallStart + Math.round(duration * 0.3), semitones: 0 });
          }
        }
        const dive = tech.get("whammyDive");
        if (dive?.semitones) {
          const from = bend.length ? bend[bend.length - 1]!.semitones : 0;
          const startDive = tick + Math.round(duration * 0.25);
          bend.push({ tick: startDive, semitones: from });
          for (let k = 1; k <= 8; k++) {
            // Ease-in curve: slow start, then the bar drops away.
            bend.push({ tick: startDive + Math.round(((duration * 0.7) * k) / 8), semitones: from - dive.semitones * (k / 8) ** 2 });
          }
        }
        const vib = dive ? undefined : tech.get("vibrato");
        if (vib) {
          const depth = vib.wide ? 0.5 : 0.25; // semitones
          const base = bend.length ? bend[bend.length - 1]!.semitones : 0;
          const start = Math.max(tick + Math.round(duration * 0.15), bend[1]?.tick ?? 0);
          const period = ticksPerSecond / 5.5; // ~5.5 Hz
          for (let t = start; t < tick + duration; t += Math.max(10, Math.round(period / 8))) {
            const phase = ((t - start) / period) * 2 * Math.PI;
            bend.push({ tick: t, semitones: base + depth * Math.sin(phase) });
          }
        }
        out.push({
          bar: bi + 1, event: ei + 1, string: note.string, fret: note.fret, midi,
          tick, durationTicks: Math.max(1, duration),
          velocity: Math.min(1, Math.max(0.2, velocity)), legato, bend,
        });
        if (tech.has("slide") && !b && !vib && !dive) slides.push(out.length - 1);
      }
      legatoStrings = nextLegato;
      tick += len;
    });
  });

  // Slides glide toward the next note on the same string over the last quarter of the note.
  for (const i of slides) {
    const n = out[i]!;
    const target = out.find((o, j) => j > i && o.tick > n.tick && o.string === n.string);
    if (!target) continue;
    const glideStart = n.tick + Math.round(n.durationTicks * 0.75);
    n.bend.push({ tick: glideStart, semitones: 0 });
    for (let k = 1; k <= 6; k++) {
      n.bend.push({
        tick: glideStart + Math.round(((n.durationTicks - 1) * 0.25 * k) / 6),
        semitones: ((target.midi - n.midi) * k) / 6,
      });
    }
  }
  return out;
}

export interface MidiOptions {
  /** Bars of metronome count-in on the GM percussion channel. */
  countInBars?: number;
}

/** Render a riff to a Standard MIDI File. */
export function riffToMidi(riff: Riff, opts: MidiOptions = {}): Uint8Array {
  const { meta } = riff;
  const countIn = (opts.countInBars ?? 0) * barTicks(meta.timeSignature);
  const midi = new Midi();
  midi.header.name = riff.title;
  midi.header.setTempo(meta.tempo);
  midi.header.timeSignatures.push({
    ticks: 0,
    timeSignature: [meta.timeSignature.beats, meta.timeSignature.beatUnit],
    measures: 0,
  });

  const track = midi.addTrack();
  track.name = `${riff.title} (${meta.style})`;
  track.channel = 0;
  track.instrument.number = PROGRAMS[meta.tone];

  // RPN 0: pitch-bend sensitivity = BEND_RANGE semitones.
  const cc = (number: number, value: number) =>
    track.addCC({ number, ticks: 0, value: (value + 0.5) / 127 });
  cc(101, 0); cc(100, 0); cc(6, BEND_RANGE); cc(38, 0); cc(101, 127); cc(100, 127);

  const toBend = (semitones: number) =>
    Math.max(-8192, Math.min(8191, Math.round((semitones / BEND_RANGE) * 8192)));

  for (const n of performRiff(riff)) {
    track.addNote({
      midi: n.midi,
      ticks: n.tick + countIn,
      durationTicks: n.durationTicks,
      velocity: n.velocity,
    });
    if (n.bend.length) {
      for (const p of n.bend) track.addPitchBend({ ticks: p.tick + countIn, value: toBend(p.semitones) });
      track.addPitchBend({ ticks: n.tick + countIn + n.durationTicks, value: 0 });
    }
  }

  if (countIn > 0) {
    const click = midi.addTrack();
    click.name = "Count-in";
    click.channel = 9;
    const beat = PPQ * (4 / meta.timeSignature.beatUnit);
    for (let t = 0; t < countIn; t += beat) {
      const downbeat = t % barTicks(meta.timeSignature) === 0;
      click.addNote({ midi: downbeat ? 76 : 77, ticks: t, durationTicks: beat / 2, velocity: downbeat ? 0.9 : 0.7 });
    }
  }

  return midi.toArray();
}
