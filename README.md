# Riffly

A guitar riff challenge app. You ask for a riff in a style, key and tempo, an LLM writes it as tab in the
Riffly JSON format, and you get the tab plus a MIDI file to play along with. Later stages will score your
playing (pitch, rhythm, bends, vibrato) against the original riff.

**Status: MVP step 1.** You can type a prompt, get a validated riff and download it as MIDI. The LLM is
Gemini, and there's a fixture stand-in for development.

## Layout

```
packages/core   Riff schema (Zod), music theory, validator, MIDI export, ASCII tab, transposition.
                Isomorphic: used by the server and directly in the browser.
packages/llm    Riff generation: prompt, provider interface, Gemini provider,
                validate-and-repair loop, fixture generator, JSONL logging. Server-only.
apps/server     Hono API (`/api/riffs`, `/api/midi`, `/api/schema`) + the `riff` CLI.
apps/web        Vite + React UI: prompt form, tab preview, MIDI/JSON download.
fixtures/riffs  Hand-written riffs used by the fixture generator and the tests.
```

## Quick start

```sh
npm install
cp .env.example .env      # set RIFFLY_PROVIDER=gemini and GEMINI_API_KEY to use Gemini
npm run dev               # API on :8787, web UI on http://localhost:5173
npm test                  # vitest
npm run typecheck
```

### CLI

```sh
npm run riff -- generate --style "blues rock" --key "A minor" --tempo 92 --bars 4 --count-in 1
npm run riff -- generate --provider gemini --style "surf rock" --key "E harmonicMinor" --difficulty 4
npm run riff -- prompt   --style "funk" --key "E dorian"      # print the exact LLM prompt
# stand in for the LLM: replay hand-written replies through the real loop (2nd file answers the repair prompt)
npm run riff -- generate --style "celtic jig" --time 6/8 --key D --response reply1.json --response reply2.json
npm run riff -- validate fixtures/riffs/*.json                  # check riffs + print tab
npm run riff -- midi path/to/riff.json --out out
```

`generate` writes `out/<title>.json` and `out/<title>.mid`. Every generation is appended to
`.riffly/logs/generations.jsonl`, with the request, each attempt's raw output, its issues and its latency,
so you can compare models and prompts.

## Generators

| `RIFFLY_PROVIDER` | What it does |
|---|---|
| `fixture` (default) | Picks the best-matching riff in `fixtures/riffs`, then transposes it to the requested key and fits it to the requested tempo and bar count. Needs no credentials. |
| `gemini` | Calls Gemini with structured JSON output. `GEMINI_MODEL` sets the model (default `gemini-3.6-flash`). Credentials come from `GEMINI_API_KEY`/`GOOGLE_API_KEY`, or from Vertex AI (`GOOGLE_GENAI_USE_VERTEXAI=true`). |

The LLM loop (`packages/llm/src/generate.ts`) works like this:

1. Send the system prompt, the user request and the riff JSON Schema.
2. Parse the reply and force the request's key, tempo, time signature and tuning onto it.
3. Validate it musically.
4. If there are errors, send them back as a repair message and retry (`RIFFLY_MAX_ATTEMPTS`, default 3).

To add another LLM, implement `LlmProvider` (one `complete()` method) and add it to `generatorFromEnv`.

## Riff format (v1)

The tab comes first: `string` and `fret` are the source of truth, and `pitch` is a cross-check the LLM
must get right. String 1 is the highest string, and `tuning[0]` is its open pitch.

```json
{
  "version": 1,
  "title": "Crossroads Ache",
  "meta": {
    "style": "blues rock", "key": { "tonic": "A", "mode": "minor" }, "tempo": 92,
    "timeSignature": { "beats": 4, "beatUnit": 4 },
    "tuning": ["E4", "B3", "G3", "D3", "A2", "E2"], "tone": "overdrive", "difficulty": 3
  },
  "bars": [
    { "events": [
      { "duration": "8", "notes": [{ "string": 2, "fret": 8, "pitch": "G4", "techniques": [{ "type": "bend", "semitones": 2 }] }] },
      { "duration": "8", "notes": [] },
      ...
    ] }
  ],
  "tips": "..."
}
```

- An event has a `duration` (`"1"`…`"32"`), can be `dotted` or `triplet`, and has `notes`. An empty `notes`
  array is a rest; two or more notes are a double-stop or chord.
- Techniques: `bend`, `bendRelease`, `vibrato`, `hammerOn`, `pullOff`, `slide`, `palmMute`, `letRing`,
  `deadNote`, `harmonic`, `accent`. Hammer-ons, pull-offs and slides connect to the next note on the same
  string.
- The full schema is in `packages/core/src/schema.ts` and is served at `GET /api/schema`.

The validator (`packages/core/src/validate.ts`) reports these as errors:

- bars whose durations don't add up to the time signature;
- a pitch that doesn't match its string and fret;
- hammer-ons or pull-offs going the wrong way, or with no target note;
- bends on open strings, or bends missing an amount;
- chord shapes you can't play;
- more than a quarter of the notes outside the key;
- the wrong number of bars.

It reports chromatic notes, large stretches and fast position jumps as warnings.

The MIDI export uses 480 PPQ. It picks a GM program from `tone` and sets the pitch-bend range to ±12. It
renders bends, bend-releases, vibrato and slides as pitch-bend curves, and palm mutes, dead notes and
accents as changes in note length and velocity. A metronome count-in is optional.

## Next steps

- Step 2: tab rendering and synced playback with alphaTab, mic or audio-interface input, latency calibration.
- Step 3: scoring pitch, timing, bends and vibrato against `performRiff()` (`packages/core/src/midi.ts`), which
  already turns a riff into the timed, technique-aware list of notes we expect the player to play.
