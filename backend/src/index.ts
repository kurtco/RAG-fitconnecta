import { loadConfig } from "./config.js";
import { createApp } from "./app.js";

const config = loadConfig();
const app = createApp(config);

const server = app.listen(config.PORT, () => {
  console.log(`backend listening on :${config.PORT} (provider=${config.LLM_PROVIDER}, prompt=${config.PROMPT_VERSION})`);
});

function shutdown(signal: string): void {
  console.log(`${signal} received, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
