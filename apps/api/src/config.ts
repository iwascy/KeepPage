import { z } from "zod";

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().positive().default(8787),
  STORAGE_DRIVER: z.enum(["memory", "postgres"]).default("memory"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.string().optional(),
});

export type ApiConfig = z.infer<typeof configSchema>;

export function readConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return configSchema.parse(env);
}
