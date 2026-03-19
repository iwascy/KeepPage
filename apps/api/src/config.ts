import { z } from "zod";

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().positive().default(8787),
  API_PUBLIC_BASE_URL: z.string().optional(),
  STORAGE_DRIVER: z.enum(["memory", "postgres"]).default("memory"),
  OBJECT_STORAGE_DRIVER: z.enum(["localfs"]).default("localfs"),
  OBJECT_STORAGE_ROOT: z.string().default("./data/object-storage"),
  AUTH_TOKEN_SECRET: z.string().default("keeppage-dev-secret"),
  AUTH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  UPLOAD_BODY_LIMIT_MB: z.coerce.number().int().positive().default(32),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.string().optional(),
});

export type ApiConfig = z.infer<typeof configSchema>;

export function readConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return configSchema.parse(env);
}
