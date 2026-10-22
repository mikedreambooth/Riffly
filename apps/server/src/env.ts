import { existsSync } from "node:fs";

// Load the repo-root .env (if present) before anything reads process.env.
const envFile = new URL("../../../.env", import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
