import { useEffect, useState, type FormEvent } from "react";
import { MODES, riffToAscii, riffToMidi, TUNINGS, type Riff } from "@riffly/core";
import { generateRiff, health, type GenerateResponse, type RiffForm } from "./api.ts";

const TONICS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const STYLE_IDEAS = ["blues rock", "classic rock", "heavy metal gallop", "funk", "country chicken pickin'",
  "surf rock", "slow blues", "drop D groove metal", "indie pop arpeggios", "folk waltz"];
const TIME_SIGNATURES = ["4/4", "3/4", "6/8", "12/8"];

function slug(riff: Riff) {
  return riff.title.replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "riff";
}

function download(bytes: BlobPart, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

export function App() {
  const [form, setForm] = useState<RiffForm>({
    style: "blues rock", key: "A minor", tempo: 92, bars: 4, timeSignature: "4/4",
    difficulty: 3, tuning: "standard", extra: "",
  });
  const [tonic, mode] = form.key.split(" ");
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [countIn, setCountIn] = useState(true);
  const [generator, setGenerator] = useState<string>("…");

  useEffect(() => {
    health().then((h) => setGenerator(h.generator)).catch(() => setGenerator("API offline"));
  }, []);

  const set = <K extends keyof RiffForm>(k: K, v: RiffForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setResult(await generateRiff(form));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const riff = result?.riff;

  return (
    <main>
      <header>
        <h1>Riffly</h1>
        <span className="muted">Generator: {generator}</span>
      </header>

      <form onSubmit={onSubmit} className="card">
        <label className="wide">
          Style
          <input value={form.style} onChange={(e) => set("style", e.target.value)} list="styles" required />
          <datalist id="styles">{STYLE_IDEAS.map((s) => <option key={s} value={s} />)}</datalist>
        </label>
        <label className="key">
          Key
          <span className="row nowrap">
            <select value={tonic} onChange={(e) => set("key", `${e.target.value} ${mode}`)}>
              {TONICS.map((t) => <option key={t}>{t}</option>)}
            </select>
            <select value={mode} onChange={(e) => set("key", `${tonic} ${e.target.value}`)}>
              {MODES.map((m) => <option key={m}>{m}</option>)}
            </select>
          </span>
        </label>
        <label>
          Tempo (BPM)
          <input type="number" min={30} max={300} value={form.tempo} onChange={(e) => set("tempo", Number(e.target.value))} />
        </label>
        <label>
          Bars
          <input type="number" min={1} max={16} value={form.bars} onChange={(e) => set("bars", Number(e.target.value))} />
        </label>
        <label>
          Time
          <select value={form.timeSignature} onChange={(e) => set("timeSignature", e.target.value)}>
            {TIME_SIGNATURES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label>
          Tuning
          <select value={form.tuning} onChange={(e) => set("tuning", e.target.value)}>
            {Object.keys(TUNINGS).map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label>
          Difficulty: {form.difficulty}
          <input type="range" min={1} max={5} value={form.difficulty} onChange={(e) => set("difficulty", Number(e.target.value))} />
        </label>
        <label className="wide">
          Extra instructions (optional)
          <input value={form.extra} placeholder="e.g. lots of double-stops, end on a big bend"
            onChange={(e) => set("extra", e.target.value)} />
        </label>
        <button type="submit" disabled={busy}>{busy ? "Generating…" : "Generate riff"}</button>
      </form>

      {error && <p className="error">{error}</p>}

      {result && (
        <section className="card">
          <div className="row spread">
            <span className="muted">
              {result.generator}
              {result.attempts.length > 0 && ` · ${result.attempts.length} attempt(s)`}
              {result.ok ? " · ✓ valid" : " · ✗ has errors"}
            </span>
            {riff && (
              <span className="row">
                <label className="inline">
                  <input type="checkbox" checked={countIn} onChange={(e) => setCountIn(e.target.checked)} /> 1-bar count-in
                </label>
                <button onClick={() => download(riffToMidi(riff, { countInBars: countIn ? 1 : 0 }) as BlobPart, "audio/midi", `${slug(riff)}.mid`)}>
                  Download MIDI
                </button>
                <button className="secondary" onClick={() => download(JSON.stringify(riff, null, 2), "application/json", `${slug(riff)}.json`)}>
                  JSON
                </button>
              </span>
            )}
          </div>
          {riff && <pre className="tab">{riffToAscii(riff, { tips: false })}</pre>}
          {riff?.tips && <p className="tip"><strong>Tip:</strong> {riff.tips}</p>}
          {result.issues.length > 0 && (
            <ul className="issues">
              {result.issues.map((i, k) => <li key={k} className={i.level}>{i.message}</li>)}
            </ul>
          )}
          {riff && (
            <details>
              <summary>Riff JSON</summary>
              <pre>{JSON.stringify(riff, null, 2)}</pre>
            </details>
          )}
        </section>
      )}
    </main>
  );
}
