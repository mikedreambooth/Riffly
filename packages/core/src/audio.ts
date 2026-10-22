import type { Riff, Tone } from "./schema.ts";
import { performRiff, type PerformedNote } from "./midi.ts";
import { PPQ, barTicks } from "./theory.ts";

/**
 * A small dependency-free guitar synth: Karplus-Strong plucked strings with
 * continuous pitch (so bends, vibrato and slides are real glides), followed by
 * an amp stage (drive + cabinet filter) and a touch of echo. Good enough to
 * audition riffs anywhere a MIDI player isn't available.
 */

export interface AudioOptions {
  sampleRate?: number;
  countInBars?: number;
}

interface ToneSettings {
  drive: number;      // pre-gain into tanh; 1 = clean
  cabinetHz: number;  // low-pass cutoff after the drive
  brightness: number; // 0..1 pick excitation brightness
  sustain: number;    // seconds for a note to decay by ~60 dB
  echo: number;       // echo mix
}

const TONES: Record<Tone, ToneSettings> = {
  nylon:      { drive: 1,  cabinetHz: 6000, brightness: 0.35, sustain: 2.5, echo: 0.08 },
  acoustic:   { drive: 1,  cabinetHz: 9000, brightness: 0.6,  sustain: 3,   echo: 0.08 },
  clean:      { drive: 1.5, cabinetHz: 7000, brightness: 0.5, sustain: 3,   echo: 0.15 },
  crunch:     { drive: 5,  cabinetHz: 5000, brightness: 0.6,  sustain: 4,   echo: 0.12 },
  overdrive:  { drive: 9,  cabinetHz: 4500, brightness: 0.65, sustain: 5,   echo: 0.18 },
  distortion: { drive: 18, cabinetHz: 4000, brightness: 0.7,  sustain: 6,   echo: 0.15 },
};

/** Deterministic PRNG so renders are reproducible. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296 * 2 - 1;
  };
}

const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

/** Pitch offset in semitones at an absolute tick, from a note's bend points. */
function bendAt(points: { tick: number; semitones: number }[], tick: number): number {
  if (points.length === 0 || tick <= points[0]!.tick) return points[0]?.semitones ?? 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    if (tick <= b.tick) return a.semitones + ((b.semitones - a.semitones) * (tick - a.tick)) / Math.max(1, b.tick - a.tick);
  }
  return points[points.length - 1]!.semitones;
}

function renderNote(
  out: Float32Array, n: PerformedNote, sr: number, ticksPerSecond: number, tone: ToneSettings,
  offsetTicks: number, palmMuted: boolean, random: () => number, cutTick: number,
) {
  const start = Math.round(((n.tick + offsetTicks) / ticksPerSecond) * sr);
  const noteLen = Math.round((n.durationTicks / ticksPerSecond) * sr);
  const release = Math.round(sr * (palmMuted ? 0.03 : 0.08));
  // A string sounds one note at a time: stop (with a tiny fade) when the next note on it starts.
  const cut = Math.round(((cutTick + offsetTicks) / ticksPerSecond) * sr);
  const end = Math.min(out.length, start + noteLen + release, cut);
  const fade = Math.round(sr * 0.004);
  const bends = [...n.bend].sort((a, b) => a.tick - b.tick);

  const size = 4096;
  const buf = new Float32Array(size);
  const baseHz = midiHz(n.midi);
  const period0 = sr / baseHz;

  // Excitation: low-passed noise burst, softer and darker for legato and palm-muted notes.
  const bright = palmMuted ? 0.15 : n.legato ? tone.brightness * 0.5 : tone.brightness;
  const amp = n.velocity * (n.legato ? 0.6 : 1);
  let lp = 0;
  for (let i = 0; i < Math.ceil(period0); i++) {
    lp += bright * (random() - lp);
    buf[i] = lp * amp;
  }

  const sustain = palmMuted ? 0.12 : tone.sustain;
  // Per-period loss so the note decays ~60 dB over `sustain` seconds.
  const loss = Math.pow(0.001, 1 / (sustain * baseHz));
  let w = Math.ceil(period0) % size;
  let prev = 0;

  for (let i = start; i < end; i++) {
    const t = i - start;
    const tick = n.tick + (t / sr) * ticksPerSecond;
    const hz = baseHz * 2 ** (bendAt(bends, tick) / 12);
    const period = Math.min(size - 2, sr / hz);
    let r = w - period;
    if (r < 0) r += size;
    const ri = Math.floor(r), frac = r - ri;
    const a = buf[ri % size]!, b = buf[(ri + 1) % size]!;
    const delayed = a + (b - a) * frac;
    // Two-point average = string damping low-pass.
    const y = 0.5 * (delayed + prev) * loss;
    prev = delayed;
    buf[w] = y;
    w = (w + 1) % size;
    // Linear release after note-off (the fretting hand lifting / muting).
    const env = (t < noteLen ? 1 : 1 - (t - noteLen) / release) * Math.min(1, (end - i) / fade);
    out[i]! += y * env;
  }
}

/** Render a riff to mono PCM samples in [-1, 1]. */
export function renderRiffAudio(riff: Riff, opts: AudioOptions = {}): { samples: Float32Array; sampleRate: number } {
  const sr = opts.sampleRate ?? 44100;
  const { meta } = riff;
  const tone = TONES[meta.tone];
  const ticksPerSecond = (meta.tempo / 60) * PPQ;
  const countIn = (opts.countInBars ?? 0) * barTicks(meta.timeSignature);
  const notes = performRiff(riff);
  const lastTick = Math.max(countIn + riff.bars.length * barTicks(meta.timeSignature),
    ...notes.map((n) => countIn + n.tick + n.durationTicks));
  const tail = 1.2; // seconds for ringing notes and echo
  const out = new Float32Array(Math.ceil((lastTick / ticksPerSecond + tail) * sr));
  const random = rng(1234);

  // Which performed notes are palm-muted (performRiff folds techniques into durations, so re-derive).
  const muted = new Set<string>();
  riff.bars.forEach((bar, bi) => bar.events.forEach((ev, ei) => ev.notes.forEach((note) => {
    if (note.techniques?.some((t) => t.type === "palmMute" || t.type === "deadNote")) muted.add(`${bi + 1}:${ei + 1}:${note.string}`);
  })));

  const isMuted = (n: PerformedNote) => muted.has(`${n.bar}:${n.event}:${n.string}`);
  for (const [i, n] of notes.entries()) {
    // Stop when the next note starts on the same string, or when a palm-muted note
    // starts anywhere (the palm resting across the strings damps everything).
    const next = notes.find((o, j) => j > i && o.tick > n.tick && (o.string === n.string || isMuted(o)));
    renderNote(out, n, sr, ticksPerSecond, tone, countIn, isMuted(n), random, next?.tick ?? Infinity);
  }

  // Amp: high-pass to remove mud, drive, then a 2-pole cabinet low-pass.
  const hpA = Math.exp((-2 * Math.PI * 90) / sr);
  const lpA = Math.exp((-2 * Math.PI * tone.cabinetHz) / sr);
  let hpX = 0, hpY = 0, lp1 = 0, lp2 = 0;
  const norm = Math.tanh(tone.drive);
  for (let i = 0; i < out.length; i++) {
    const x = out[i]!;
    hpY = hpA * (hpY + x - hpX);
    hpX = x;
    const driven = Math.tanh(hpY * tone.drive) / norm;
    lp1 += (1 - lpA) * (driven - lp1);
    lp2 += (1 - lpA) * (lp1 - lp2);
    out[i] = lp2;
  }

  // Echo: one dotted-eighth feedback delay, the classic lead-guitar trick.
  const delay = Math.round((60 / meta.tempo) * 0.75 * sr);
  if (tone.echo > 0) {
    const wet = new Float32Array(out.length);
    for (let i = delay; i < out.length; i++) wet[i] = out[i - delay]! + wet[i - delay]! * 0.35;
    for (let i = 0; i < out.length; i++) out[i]! += wet[i]! * tone.echo;
  }

  // Count-in clicks (short sine blips, accented downbeat).
  if (countIn > 0) {
    const beat = PPQ * (4 / meta.timeSignature.beatUnit);
    for (let t = 0; t < countIn; t += beat) {
      const s0 = Math.round((t / ticksPerSecond) * sr);
      const hz = t % barTicks(meta.timeSignature) === 0 ? 1760 : 1320;
      for (let i = 0; i < sr * 0.04 && s0 + i < out.length; i++) {
        out[s0 + i]! += 0.3 * Math.sin((2 * Math.PI * hz * i) / sr) * (1 - i / (sr * 0.04));
      }
    }
  }

  // Normalise to -1 dBFS.
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) {
    const g = 0.89 / peak;
    for (let i = 0; i < out.length; i++) out[i]! *= g;
  }
  return { samples: out, sampleRate: sr };
}

/** Encode mono samples as a 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(bytes.buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i]!)) * 0x7fff, true);
  }
  return bytes;
}

export function riffToWav(riff: Riff, opts: AudioOptions = {}): Uint8Array {
  const { samples, sampleRate } = renderRiffAudio(riff, opts);
  return encodeWav(samples, sampleRate);
}
