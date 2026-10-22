import type { Note, Riff } from "./schema.ts";
import { eventTicks, pitchToMidi } from "./theory.ts";

const RHYTHM: Record<string, string> = { "1": "w", "2": "h", "4": "q", "8": "e", "16": "s", "32": "t" };

function noteLabel(n: Note): string {
  const tech = new Map((n.techniques ?? []).map((t) => [t.type, t]));
  if (tech.has("deadNote")) return "x";
  let s = tech.has("harmonic") ? `<${n.fret}>` : String(n.fret);
  if (tech.has("tap")) s = `t${s}`;
  const bend = tech.get("bend") ?? tech.get("bendRelease");
  if (bend?.semitones) {
    const target = n.fret + bend.semitones;
    s += `b${Number.isInteger(target) ? target : `${Math.floor(target)}½`}`;
    if (bend.type === "bendRelease") s += `r${n.fret}`;
  }
  if (tech.has("hammerOn")) s += "h";
  if (tech.has("pullOff")) s += "p";
  if (tech.has("slide")) s += "/";
  if (tech.has("whammyDive")) s += `dv${tech.get("whammyDive")!.semitones ?? ""}`;
  if (tech.has("vibrato")) s += tech.get("vibrato")!.wide ? "~~" : "~";
  return s;
}

export interface AsciiOptions {
  width?: number;    // wrap systems at this many characters (default 100)
  tips?: boolean;    // append the riff's tips (default true)
}

/** Plain-text tab, handy for CLI output, logs and LLM repair prompts. */
export function riffToAscii(riff: Riff, { width = 100, tips = true }: AsciiOptions = {}): string {
  const { meta } = riff;
  const strings = meta.tuning.length;
  const names = meta.tuning.map((p, i) => {
    const name = p.replace(/-?\d$/, "");
    return i === 0 && pitchToMidi(p) > pitchToMidi(meta.tuning[strings - 1]!) ? name.toLowerCase() : name;
  });
  const nameWidth = Math.max(...names.map((n) => n.length));

  // Render each bar as: palm-mute / pinch-harmonic marks, one row per string, rhythm.
  const bars = riff.bars.map((bar) => {
    const rows = names.map(() => "");
    let marks = "";
    let rhythm = "";
    for (const ev of bar.events) {
      const labels = new Map(ev.notes.map((n) => [n.string, noteLabel(n)]));
      const longest = Math.max(1, ...[...labels.values()].map((l) => l.length));
      const w = Math.max(longest + 1, Math.round(eventTicks(ev) / 80));
      for (let s = 1; s <= strings; s++) rows[s - 1] += (labels.get(s) ?? "").padEnd(w, "-");
      const has = (type: string) => ev.notes.some((n) => n.techniques?.some((t) => t.type === type));
      marks += (has("pinchHarmonic") ? "PH" : has("palmMute") ? "PM" : "").padEnd(w);
      const r = ev.notes.length ? RHYTHM[ev.duration]! : "r";
      rhythm += `${r}${ev.dotted ? "." : ""}${ev.triplet ? "3" : ""}`.padEnd(w);
    }
    return { rows: rows.map((r) => r + "|"), marks: marks + " ", rhythm: rhythm + " " };
  });

  // Group bars into systems that fit the width.
  const systems: (typeof bars)[] = [];
  for (const bar of bars) {
    const last = systems.at(-1);
    const used = last ? last.reduce((n, b) => n + b.rows[0]!.length, nameWidth + 1) : 0;
    if (last && used + bar.rows[0]!.length <= width) last.push(bar);
    else systems.push([bar]);
  }

  const header = `${riff.title} — ${meta.style}, ${meta.key.tonic} ${meta.key.mode}, ${meta.tempo} BPM, ` +
    `${meta.timeSignature.beats}/${meta.timeSignature.beatUnit}, ${meta.tone}`;
  const lines = [header];
  const pad = " ".repeat(nameWidth + 1);
  for (const sys of systems) {
    lines.push("");
    const marks = sys.map((b) => b.marks).join("");
    if (marks.trim()) lines.push((pad + marks).trimEnd());
    names.forEach((n, i) => lines.push(n.padEnd(nameWidth) + "|" + sys.map((b) => b.rows[i]).join("")));
    lines.push((pad + sys.map((b) => b.rhythm).join("")).trimEnd());
  }
  if (tips && riff.tips) lines.push("", `Tip: ${riff.tips}`);
  return lines.join("\n");
}
