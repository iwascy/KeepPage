import { z } from "zod";

const booleanFlagSchema = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "" || normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
      return false;
    }
    if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
      return true;
    }
  }
  return value;
}, z.boolean().default(false));

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
  DEBUG_MODE: booleanFlagSchema,
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).optional(),
  DATABASE_URL: z.string().optional(),
});

export type ApiConfig = Omit<z.infer<typeof configSchema>, "LOG_LEVEL"> & {
  LOG_LEVEL: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
};

export function readConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = configSchema.parse(env);
  return {
    ...parsed,
    LOG_LEVEL: parsed.LOG_LEVEL ?? (parsed.DEBUG_MODE ? "debug" : "info"),
  };
}
