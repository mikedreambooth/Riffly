import "./env.ts";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { riffJsonSchema, riffToAscii, riffToMidi, RiffSchema } from "@riffly/core";
import { generatorFromEnv, logGeneration } from "@riffly/llm";
import { toRiffRequest } from "./request.ts";

const generator = generatorFromEnv();
const logPath = process.env.RIFFLY_LOG ?? new URL("../../../.riffly/logs/generations.jsonl", import.meta.url).pathname;

const app = new Hono();

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  return c.json({ error: err.message }, 500);
});

app.get("/api/health", (c) => c.json({ ok: true, generator: generator.name }));

app.get("/api/schema", (c) => c.json(riffJsonSchema()));

app.post("/api/riffs", async (c) => {
  let req;
  try {
    req = toRiffRequest(await c.req.json());
  } catch (err) {
    return c.json({ error: `Bad request: ${(err as Error).message}` }, 400);
  }
  const result = await generator.generate(req);
  logGeneration(logPath, result);
  return c.json({ ...result, ascii: result.riff ? riffToAscii(result.riff) : null });
});

app.post("/api/midi", async (c) => {
  const body = await c.req.json();
  const parsed = RiffSchema.safeParse(body.riff ?? body);
  if (!parsed.success) return c.json({ error: "Invalid riff", issues: parsed.error.issues }, 400);
  const bytes = riffToMidi(parsed.data, { countInBars: Number(body.countInBars ?? 0) });
  const name = parsed.data.title.replace(/[^\w-]+/g, "-").toLowerCase() || "riff";
  return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
    "Content-Type": "audio/midi",
    "Content-Disposition": `attachment; filename="${name}.mid"`,
  });
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => {
  console.log(`Riffly API on http://localhost:${port} (generator: ${generator.name})`);
});
