import { readConfig } from "./config";
import { buildServer } from "./server";

async function start() {
  const config = readConfig();
  const server = buildServer(config);
  await server.listen({
    host: config.API_HOST,
    port: config.API_PORT,
  });
}

start().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
