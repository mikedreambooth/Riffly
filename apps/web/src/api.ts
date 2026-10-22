import type { Issue, Riff } from "@riffly/core";

export interface RiffForm {
  style: string;
  key: string;
  tempo: number;
  bars: number;
  timeSignature: string;
  difficulty: number;
  tuning: string;
  extra: string;
}

export interface GenerateResponse {
  ok: boolean;
  riff: Riff | null;
  issues: Issue[];
  attempts: { n: number; latencyMs: number; issues: Issue[] }[];
  generator: string;
}

export async function generateRiff(form: RiffForm): Promise<GenerateResponse> {
  const res = await fetch("/api/riffs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(form),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

export async function health(): Promise<{ generator: string }> {
  const res = await fetch("/api/health");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
