import { barTicks, PPQ, type Issue, type RiffRequest } from "@riffly/core";

const EXAMPLE = {
  version: 1,
  title: "Example Lick",
  meta: {
    style: "blues rock",
    key: { tonic: "A", mode: "minor" },
    tempo: 90,
    timeSignature: { beats: 4, beatUnit: 4 },
    tuning: ["E4", "B3", "G3", "D3", "A2", "E2"],
    tone: "overdrive",
    difficulty: 2,
  },
  bars: [
    {
      events: [
        { duration: "8", notes: [{ string: 3, fret: 7, pitch: "D4", techniques: [{ type: "bend", semitones: 2 }] }] },
        { duration: "8", notes: [{ string: 2, fret: 5, pitch: "E4" }] },
        { duration: "8", notes: [{ string: 2, fret: 8, pitch: "G4", techniques: [{ type: "pullOff" }] }] },
        { duration: "8", notes: [{ string: 2, fret: 5, pitch: "E4" }] },
        { duration: "8", notes: [{ string: 3, fret: 7, pitch: "D4" }] },
        { duration: "8", notes: [{ string: 3, fret: 5, pitch: "C4" }] },
        { duration: "4", notes: [{ string: 4, fret: 7, pitch: "A3", techniques: [{ type: "vibrato" }] }] },
      ],
    },
  ],
  tips: "Push the bend on the G string all the way up to E; check it against the B-string 5th fret.",
};

const DIFFICULTY = [
  "",
  "1 = beginner: mostly quarter/eighth notes, one position, no fast techniques.",
  "2 = easy: eighth notes, simple hammer-ons/pull-offs, at most one bend.",
  "3 = intermediate: sixteenths allowed, bends, slides, some syncopation.",
  "4 = advanced: fast sixteenth runs, position shifts, combined techniques.",
  "5 = expert: virtuosic phrasing, wide stretches, triplet/sixteenth bursts.",
];

export const SYSTEM_PROMPT = `You are Riffly, an expert guitarist, transcriber and teacher. You compose short,
idiomatic, playable guitar riffs and licks and write them as JSON in the Riffly tab format.

FORMAT
- A riff is a list of bars. Each bar is a list of events played one after another.
- Each event has a duration ("1" whole, "2" half, "4" quarter, "8" eighth, "16" sixteenth, "32"),
  optional "dotted": true (x1.5) or "triplet": true (x2/3, use in groups of three), and a list of notes.
- "notes": [] means a rest. More than one note means they are struck together (double-stop/chord).
- Each note gives "string" (1 = highest/thinnest string), "fret" (0 = open) and "pitch".
- "pitch" MUST be exactly the pitch of that string and fret in the given tuning, before any bend.
  The tuning array lists open strings from string 1 (highest) to the lowest string.
  Pitch = open string pitch + fret semitones. Middle C is C4. E.g. standard tuning string 3 (G3) fret 7 = D4.
- Techniques per note: bend/bendRelease (with "semitones": 1 = half step, 2 = whole step), vibrato
  ("wide": true optional), hammerOn / pullOff / slide (these connect THIS note to the NEXT note on the
  SAME string: hammerOn goes to a higher fret, pullOff to a lower fret), palmMute, letRing,
  deadNote, harmonic, accent.
- "tone" picks the guitar sound: clean, crunch, overdrive, distortion, acoustic or nylon.

RULES
- The durations in every bar must add up to exactly one full bar of the time signature.
  In 4/4 one bar = 4 quarters = 8 eighths = 16 sixteenths. A dotted quarter = 3 eighths.
- Write exactly the number of bars requested, in the requested key, tempo, time signature and tuning.
- Stay in the key; blue notes and occasional chromatic passing notes are fine when idiomatic.
- Make it playable: keep each phrase in a sensible hand position (span of about 4-5 frets),
  avoid huge jumps at speed, never bend open strings.
- Make it musical and characteristic of the style: use its typical rhythms, scale choices,
  techniques and tone. A strong riff has a clear motif, repetition with variation, and a resolution.
- Match the requested difficulty level:
${DIFFICULTY.slice(1).map((d) => `  ${d}`).join("\n")}
- Give the riff a short evocative title and one or two sentences of tips for the player.
- Respond with only the JSON object.

EXAMPLE (one bar, A minor, standard tuning)
${JSON.stringify(EXAMPLE)}`;

export function buildUserPrompt(req: RiffRequest): string {
  const { timeSignature: ts } = req;
  const barSubdivisions = barTicks(ts) / (PPQ / 4);
  const lines = [
    `Write a ${req.style} guitar riff.`,
    `- Key: ${req.key.tonic} ${req.key.mode}`,
    `- Tempo: ${req.tempo} BPM`,
    `- Time signature: ${ts.beats}/${ts.beatUnit} (one bar = ${barSubdivisions} sixteenths)`,
    `- Length: exactly ${req.bars} bar${req.bars === 1 ? "" : "s"}`,
    `- Difficulty: ${req.difficulty} (${DIFFICULTY[req.difficulty]!.split(": ")[1]})`,
    `- Tuning (string 1 first): ${JSON.stringify(req.tuning)}`,
  ];
  if (req.extra?.trim()) lines.push(`- Extra instructions: ${req.extra.trim()}`);
  return lines.join("\n");
}

export function buildRepairPrompt(errors: Issue[]): string {
  return [
    "That riff has problems that must be fixed:",
    ...errors.map((e) => `- ${e.message}`),
    "",
    "Return the complete corrected riff as JSON. Keep everything that was fine; change only what is needed.",
  ].join("\n");
}
