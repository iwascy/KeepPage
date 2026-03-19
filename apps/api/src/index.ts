import { readConfig } from "./config";
import { buildServer } from "./server";

async function start() {
  const config = readConfig();
  const server = buildServer(config);
  await server.listen({
    host: config.API_HOST,
    port: config.API_PORT,
  });
  server.log.info({
    host: config.API_HOST,
    port: config.API_PORT,
    storageDriver: config.STORAGE_DRIVER,
    debugMode: config.DEBUG_MODE,
    logLevel: config.LOG_LEVEL,
  }, "KeepPage API started");
}

start().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
