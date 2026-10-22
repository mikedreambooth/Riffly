import { parseKey, RiffRequestSchema, TUNINGS, type RiffRequest } from "@riffly/core";

/** Loose, human-friendly request fields (CLI flags / form values). */
export interface LooseRequest {
  style?: string;
  key?: string | { tonic: string; mode: string };
  tempo?: string | number;
  bars?: string | number;
  timeSignature?: string | { beats: number; beatUnit: number };
  difficulty?: string | number;
  tuning?: string | string[];
  extra?: string;
}

/** Normalise loose input ("A minor", "6/8", "dropD") into a validated RiffRequest. */
export function toRiffRequest(input: LooseRequest): RiffRequest {
  const num = (v: string | number | undefined) => (v === undefined || v === "" ? undefined : Number(v));
  let timeSignature = input.timeSignature;
  if (typeof timeSignature === "string") {
    const [beats, beatUnit] = timeSignature.split("/").map(Number);
    timeSignature = { beats: beats!, beatUnit: beatUnit! };
  }
  let tuning = input.tuning;
  if (typeof tuning === "string") {
    tuning = TUNINGS[tuning] ?? tuning.split(/[\s,]+/).filter(Boolean);
  }
  return RiffRequestSchema.parse({
    style: input.style,
    key: typeof input.key === "string" ? parseKey(input.key) : input.key,
    tempo: num(input.tempo),
    bars: num(input.bars),
    timeSignature,
    difficulty: num(input.difficulty),
    tuning,
    extra: input.extra || undefined,
  });
}
