import "./env.ts";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";
import { parseRiff, riffToAscii, riffToMidi, riffToWav, validateRiff, type Issue, type Riff } from "@riffly/core";
import { buildUserPrompt, generatorFromEnv, LlmRiffGenerator, logGeneration, ReplayProvider, SYSTEM_PROMPT } from "@riffly/llm";
import { toRiffRequest } from "./request.ts";

const USAGE = `Usage: npm run riff -- <command> [options]

Commands:
  generate   Generate a riff and write <out>/<slug>.json + .mid
  prompt     Print the exact prompt an LLM would receive
  validate   Validate riff JSON file(s) and print the tab
  midi       Convert a riff JSON file to MIDI

Request options (generate, prompt, validate):
  --style "blues rock"   --key "A minor"   --tempo 92   --bars 4
  --time 4/4   --difficulty 3   --tuning standard|dropD|"E4 B3 G3 D3 A2 E2"   --extra "..."

Other options:
  --provider gemini|fixture   (default: $RIFFLY_PROVIDER or fixture)
  --response <file>           replay a hand-written LLM response instead of calling a provider;
                              repeat for repair attempts (2nd file answers the 1st repair prompt)
  --out <dir>                 (default: out)
  --count-in <bars>           metronome bars before the riff in the MIDI/audio file
  --audio                     also render <slug>.wav (and <slug>.mp3 if ffmpeg is installed)
`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    style: { type: "string" },
    key: { type: "string" },
    tempo: { type: "string" },
    bars: { type: "string" },
    time: { type: "string" },
    difficulty: { type: "string" },
    tuning: { type: "string" },
    extra: { type: "string" },
    provider: { type: "string" },
    response: { type: "string", multiple: true },
    out: { type: "string", default: "out" },
    "count-in": { type: "string", default: "0" },
    audio: { type: "boolean", default: false },
    help: { type: "boolean", short: "h" },
  },
});

const [command, ...files] = positionals;

function request() {
  return toRiffRequest({
    style: values.style ?? "rock",
    key: values.key,
    tempo: values.tempo,
    bars: values.bars,
    timeSignature: values.time,
    difficulty: values.difficulty,
    tuning: values.tuning,
    extra: values.extra,
  });
}

function printIssues(issues: Issue[]) {
  for (const i of issues) console.log(`${i.level === "error" ? "✗" : "!"} ${i.message}`);
}

function writeOutputs(riff: Riff): void {
  mkdirSync(values.out!, { recursive: true });
  const slug = riff.title.replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "riff";
  const base = join(values.out!, slug);
  writeFileSync(`${base}.json`, JSON.stringify(riff, null, 2) + "\n");
  const countInBars = Number(values["count-in"]);
  writeFileSync(`${base}.mid`, riffToMidi(riff, { countInBars }));
  const written = [`${base}.json`, `${base}.mid`];
  if (values.audio) {
    writeFileSync(`${base}.wav`, riffToWav(riff, { countInBars }));
    written.push(`${base}.wav`);
    try {
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", `${base}.wav`, "-b:a", "192k", `${base}.mp3`]);
      written.push(`${base}.mp3`);
    } catch {
      // ffmpeg not installed: the WAV is still there.
    }
  }
  console.log(`\nWrote ${written.join(", ")}`);
}

async function main() {
  if (values.help || !command) return console.log(USAGE);

  switch (command) {
    case "prompt": {
      console.log("=== SYSTEM ===\n" + SYSTEM_PROMPT + "\n\n=== USER ===\n" + buildUserPrompt(request()));
      return;
    }
    case "generate": {
      if (values.provider) process.env.RIFFLY_PROVIDER = values.provider;
      const replies = values.response?.map((f) => readFileSync(f, "utf8"));
      const generator = replies
        ? new LlmRiffGenerator(new ReplayProvider(replies), { maxAttempts: replies.length })
        : generatorFromEnv();
      const req = request();
      console.log(`Generating with ${generator.name}...`);
      const result = await generator.generate(req);
      logGeneration(".riffly/logs/generations.jsonl", result);
      console.log(`Generator: ${result.generator}  attempts: ${result.attempts.length || "-"}  ok: ${result.ok}\n`);
      result.attempts.forEach((a) =>
        console.log(`  attempt ${a.n}: ${a.latencyMs} ms, ${a.issues.filter((i) => i.level === "error").length} errors`));
      if (result.riff) console.log(riffToAscii(result.riff) + "\n");
      printIssues(result.issues);
      if (result.riff) writeOutputs(result.riff);
      process.exitCode = result.ok ? 0 : 1;
      return;
    }
    case "validate": {
      const req = values.style ? request() : undefined;
      for (const f of files) {
        console.log(`\n# ${f}`);
        const parsed = parseRiff(readFileSync(f, "utf8"));
        if (!parsed.ok) {
          printIssues(parsed.issues);
          process.exitCode = 1;
          continue;
        }
        console.log(riffToAscii(parsed.riff));
        const issues = validateRiff(parsed.riff, req);
        printIssues(issues);
        if (issues.some((i) => i.level === "error")) process.exitCode = 1;
        else console.log("✓ valid");
      }
      return;
    }
    case "midi": {
      for (const f of files) {
        const parsed = parseRiff(readFileSync(f, "utf8"));
        if (!parsed.ok) throw new Error(`${f}: ${parsed.issues.map((i) => i.message).join("; ")}`);
        writeOutputs(parsed.riff);
      }
      return;
    }
    default:
      console.log(USAGE);
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
