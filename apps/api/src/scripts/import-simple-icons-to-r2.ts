import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import * as simpleIcons from "simple-icons";
import { Client } from "pg";
import { z } from "zod";

type SimpleIconRecord = {
  title: string;
  slug: string;
  svg: string;
  path?: string;
  hex?: string;
  source: string;
  guidelines?: string;
  aliases?: {
    aka?: string[];
  };
};

type IconImportTarget = {
  icon: SimpleIconRecord;
  hostnames: string[];
  objectKey: string;
  publicUrl: string;
};

type ImportCounts = {
  icons: number;
  uploaded: number;
  skippedExistingObjects: number;
  skippedWithoutHostname: number;
  upsertedHostnames: number;
};

const booleanEnvSchema = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["", "0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
  }
  return value;
}, z.boolean());

const envSchema = z.object({
  DATABASE_URL: optionalNonEmptyString(),
  R2_ENDPOINT: optionalUrlString(),
  R2_ENDPOINT_URL: optionalUrlString(),
  R2_ACCOUNT_ID: optionalNonEmptyString(),
  R2_ACCESS_KEY_ID: optionalNonEmptyString(),
  R2_SECRET_ACCESS_KEY: optionalNonEmptyString(),
  R2_BUCKET: optionalNonEmptyString(),
  R2_PUBLIC_BUCKET: optionalNonEmptyString(),
  R2_PUBLIC_BASE_URL: optionalUrlString(),
  R2_REGION: z.string().default("auto"),
  R2_FORCE_PATH_STYLE: booleanEnvSchema.default(true),
  SIMPLE_ICONS_IMPORT_DRY_RUN: booleanEnvSchema.default(true),
  SIMPLE_ICONS_IMPORT_LIMIT: z.coerce.number().int().positive().optional(),
  SIMPLE_ICONS_IMPORT_FORCE_UPLOAD: booleanEnvSchema.default(false),
  SIMPLE_ICONS_IMPORT_CONCURRENCY: z.coerce.number().int().positive().max(64).default(12),
  SIMPLE_ICONS_IMPORT_PREFIX: z.string().default("assets/site-icons/simple-icons"),
  SIMPLE_ICONS_IMPORT_STRICT_SOURCE_HOSTS: booleanEnvSchema.default(false),
});

type ImportEnv = z.infer<typeof envSchema>;

function optionalNonEmptyString() {
  return z.preprocess((value) => (
    typeof value === "string" && value.trim() === "" ? undefined : value
  ), z.string().min(1).optional());
}

function optionalUrlString() {
  return z.preprocess((value) => (
    typeof value === "string" && value.trim() === "" ? undefined : value
  ), z.string().url().optional());
}

const explicitHostnameBySlug: Record<string, string[]> = {
  "1dot1dot1dot1": ["one.one.one.one", "1.1.1.1"],
  android: ["android.com"],
  apple: ["apple.com"],
  appstore: ["apps.apple.com"],
  baidu: ["baidu.com"],
  bluesky: ["bsky.app"],
  discord: ["discord.com"],
  docker: ["docker.com"],
  facebook: ["facebook.com", "fb.com"],
  figma: ["figma.com"],
  github: ["github.com"],
  gitlab: ["gitlab.com"],
  gmail: ["mail.google.com", "gmail.com"],
  google: ["google.com"],
  googlechrome: ["chrome.google.com"],
  googledrive: ["drive.google.com"],
  googlemaps: ["maps.google.com"],
  googlemeet: ["meet.google.com"],
  googlescholar: ["scholar.google.com"],
  instagram: ["instagram.com"],
  medium: ["medium.com"],
  microsoft: ["microsoft.com"],
  notion: ["notion.so"],
  npm: ["npmjs.com"],
  reddit: ["reddit.com"],
  slack: ["slack.com"],
  spotify: ["spotify.com"],
  stackoverflow: ["stackoverflow.com"],
  telegram: ["telegram.org", "t.me"],
  tiktok: ["tiktok.com"],
  twitch: ["twitch.tv"],
  wikipedia: ["wikipedia.org"],
  x: ["x.com", "twitter.com", "t.co"],
  xiaohongshu: ["xiaohongshu.com", "www.xiaohongshu.com"],
  sinaweibo: ["weibo.com", "s.weibo.com", "m.weibo.cn"],
  youtube: ["youtube.com", "youtu.be"],
};

const genericSourceHosts = new Set([
  "about.google",
  "about.meta.com",
  "apache.org",
  "atlassian.design",
  "brandfolder.com",
  "commons.wikimedia.org",
  "developer.apple.com",
  "developers.google.com",
  "en.wikipedia.org",
  "github.com",
  "gitlab.com",
  "partnermarketinghub.withgoogle.com",
  "w3.org",
  "wikipedia.org",
  "wikimedia.org",
]);

const reservedRootHostnameSlugs: Record<string, string> = {
  "facebook.com": "facebook",
  "github.com": "github",
  "google.com": "google",
  "instagram.com": "instagram",
  "reddit.com": "reddit",
  "t.co": "x",
  "twitter.com": "x",
  "x.com": "x",
  "youtu.be": "youtube",
  "youtube.com": "youtube",
};

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printUsage();
    return;
  }

  const config = readConfig();
  const dryRun = config.SIMPLE_ICONS_IMPORT_DRY_RUN;
  const icons = readSimpleIcons(config.SIMPLE_ICONS_IMPORT_LIMIT);
  const publicBaseUrl = normalizeBaseUrl(config.R2_PUBLIC_BASE_URL ?? "https://example.invalid");
  const objectPrefix = normalizeObjectPrefix(config.SIMPLE_ICONS_IMPORT_PREFIX);
  const targets = icons.map((icon) => {
    const objectKey = `${objectPrefix}/${icon.slug}.svg`;
    return {
      icon,
      hostnames: resolveHostnames(icon, config.SIMPLE_ICONS_IMPORT_STRICT_SOURCE_HOSTS),
      objectKey,
      publicUrl: createPublicIconUrl(publicBaseUrl, objectKey),
    };
  });
  const counts: ImportCounts = {
    icons: icons.length,
    uploaded: 0,
    skippedExistingObjects: 0,
    skippedWithoutHostname: 0,
    upsertedHostnames: 0,
  };

  if (dryRun) {
    counts.skippedWithoutHostname = targets.filter((target) => target.hostnames.length === 0).length;
    counts.upsertedHostnames = targets.reduce((total, target) => total + target.hostnames.length, 0);
    printSummary({
      dryRun,
      counts,
      sample: targets.slice(0, 12),
    });
    return;
  }

  validateWriteConfig(config);
  const r2 = createR2Client(config);
  const bucket = config.R2_PUBLIC_BUCKET ?? config.R2_BUCKET!;
  const client = new Client({
    connectionString: config.DATABASE_URL!,
  });

  await client.connect();
  try {
    await runWithConcurrency(targets, config.SIMPLE_ICONS_IMPORT_CONCURRENCY, async (target, index) => {
      const uploadResult = await cacheIconObject({
        bucket,
        forceUpload: config.SIMPLE_ICONS_IMPORT_FORCE_UPLOAD,
        r2,
        target,
      });
      if (uploadResult === "skipped") {
        counts.skippedExistingObjects += 1;
      } else {
        counts.uploaded += 1;
      }
      if ((index + 1) % 100 === 0 || index + 1 === targets.length) {
        console.log(`Cached ${index + 1}/${targets.length} Simple Icons SVGs.`);
      }
    });
    counts.skippedWithoutHostname = targets.filter((target) => target.hostnames.length === 0).length;
    counts.upsertedHostnames = await upsertBookmarkIcons(client, targets);
  } finally {
    await client.end();
  }

  printSummary({
    dryRun,
    counts,
    sample: targets.slice(0, 12),
  });
}

function readConfig() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid Simple Icons import environment.");
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}

function validateWriteConfig(config: ImportEnv) {
  const missing: string[] = [];
  if (!config.DATABASE_URL) {
    missing.push("DATABASE_URL");
  }
  if (!config.R2_PUBLIC_BASE_URL) {
    missing.push("R2_PUBLIC_BASE_URL");
  }
  if (!config.R2_ACCESS_KEY_ID) {
    missing.push("R2_ACCESS_KEY_ID");
  }
  if (!config.R2_SECRET_ACCESS_KEY) {
    missing.push("R2_SECRET_ACCESS_KEY");
  }
  if (!config.R2_BUCKET && !config.R2_PUBLIC_BUCKET) {
    missing.push("R2_BUCKET or R2_PUBLIC_BUCKET");
  }
  if (!config.R2_ENDPOINT && !config.R2_ENDPOINT_URL && !config.R2_ACCOUNT_ID) {
    missing.push("R2_ENDPOINT, R2_ENDPOINT_URL, or R2_ACCOUNT_ID");
  }
  if (missing.length > 0) {
    console.error(`Missing required environment for write mode: ${missing.join(", ")}.`);
    process.exit(1);
  }
}

function createR2Client(config: ImportEnv) {
  const endpoint = config.R2_ENDPOINT
    ?? config.R2_ENDPOINT_URL
    ?? `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  return new S3Client({
    region: config.R2_REGION,
    endpoint,
    forcePathStyle: config.R2_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: config.R2_ACCESS_KEY_ID!,
      secretAccessKey: config.R2_SECRET_ACCESS_KEY!,
    },
  });
}

function readSimpleIcons(limit?: number): SimpleIconRecord[] {
  const icons = (Object.values(simpleIcons) as unknown[])
    .filter((icon): icon is SimpleIconRecord => (
      isSimpleIcon(icon)
    ))
    .sort((left, right) => left.slug.localeCompare(right.slug));
  return typeof limit === "number" ? icons.slice(0, limit) : icons;
}

function isSimpleIcon(value: unknown): value is SimpleIconRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.title === "string"
    && typeof record.slug === "string"
    && typeof record.svg === "string"
    && typeof record.source === "string";
}

function resolveHostnames(icon: SimpleIconRecord, strictSourceHosts: boolean) {
  const explicit = explicitHostnameBySlug[icon.slug] ?? [];
  const sourceHost = strictSourceHosts ? [] : [readSourceHostname(icon)].filter(Boolean);
  return dedupeHostnames([...explicit, ...sourceHost]);
}

function readSourceHostname(icon: SimpleIconRecord) {
  try {
    const hostname = normalizeHostname(new URL(icon.source).hostname);
    if (!hostname || genericSourceHosts.has(hostname) || hostname.endsWith(".github.io")) {
      return "";
    }
    const reservedSlug = reservedRootHostnameSlugs[hostname];
    if (reservedSlug && reservedSlug !== icon.slug) {
      return "";
    }
    return hostname;
  } catch {
    return "";
  }
}

async function hasR2Object(r2: S3Client, bucket: string, key: string) {
  try {
    await r2.send(new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    }));
    return true;
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

async function cacheIconObject(input: {
  bucket: string;
  forceUpload: boolean;
  r2: S3Client;
  target: IconImportTarget;
}) {
  const body = Buffer.from(input.target.icon.svg);
  const exists = !input.forceUpload
    && await hasR2Object(input.r2, input.bucket, input.target.objectKey);
  if (exists) {
    return "skipped" as const;
  }
  await input.r2.send(new PutObjectCommand({
    Bucket: input.bucket,
    Key: input.target.objectKey,
    Body: body,
    ContentType: "image/svg+xml; charset=utf-8",
    CacheControl: "public, max-age=31536000, immutable",
    Metadata: {
      "simple-icons-slug": input.target.icon.slug,
    },
  }));
  return "uploaded" as const;
}

async function upsertBookmarkIcons(client: Client, targets: IconImportTarget[]) {
  const now = new Date();
  let upserted = 0;
  for (const target of targets) {
    if (target.hostnames.length === 0) {
      continue;
    }
    await client.query(
      `
      insert into bookmark_icons (
        hostname,
        icon_url,
        source_url,
        source_type,
        width,
        height,
        format,
        refreshed_at,
        updated_at
      )
      select
        input.hostname,
        $2,
        $3,
        'simple-icons',
        null,
        null,
        'svg',
        $4,
        $4
      from unnest($1::text[]) as input(hostname)
      on conflict (hostname)
      do update set
        icon_url = excluded.icon_url,
        source_url = excluded.source_url,
        source_type = excluded.source_type,
        width = excluded.width,
        height = excluded.height,
        format = excluded.format,
        refreshed_at = excluded.refreshed_at,
        updated_at = excluded.updated_at
      `,
      [target.hostnames, target.publicUrl, target.icon.source, now],
    );
    upserted += target.hostnames.length;
  }
  return upserted;
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(items[index]!, index);
    }
  });
  await Promise.all(workers);
}

function printSummary(input: {
  dryRun: boolean;
  counts: ImportCounts;
  sample: IconImportTarget[];
}) {
  console.log(JSON.stringify({
    message: input.dryRun
      ? "Simple Icons import dry run completed."
      : "Simple Icons import completed.",
    dryRun: input.dryRun,
    counts: input.counts,
    sample: input.sample.map((target) => ({
      slug: target.icon.slug,
      title: target.icon.title,
      hostnames: target.hostnames,
      objectKey: target.objectKey,
      publicUrl: target.publicUrl,
    })),
  }, null, 2));
}

function printUsage() {
  console.log(`
Import Simple Icons SVGs to R2 and upsert reliable hostname matches into bookmark_icons.

Dry run:
  npm run icons:import-simple -w @keeppage/api

Write mode:
  SIMPLE_ICONS_IMPORT_DRY_RUN=false \\
  DATABASE_URL="postgresql://..." \\
  R2_ENDPOINT="https://<account-id>.r2.cloudflarestorage.com" \\
  R2_ACCESS_KEY_ID="..." \\
  R2_SECRET_ACCESS_KEY="..." \\
  R2_BUCKET="private-bucket" \\
  R2_PUBLIC_BUCKET="public-bucket" \\
  R2_PUBLIC_BASE_URL="https://cdn.example.com" \\
  npm run icons:import-simple -w @keeppage/api

Optional:
  SIMPLE_ICONS_IMPORT_LIMIT=100
  SIMPLE_ICONS_IMPORT_FORCE_UPLOAD=true
  SIMPLE_ICONS_IMPORT_CONCURRENCY=12
  SIMPLE_ICONS_IMPORT_PREFIX="assets/site-icons/simple-icons"
  SIMPLE_ICONS_IMPORT_STRICT_SOURCE_HOSTS=true
`.trim());
}

function normalizeHostname(input: string) {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }
  try {
    return new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname.replace(/^www\./, "");
  } catch {
    return trimmed.replace(/^www\./, "");
  }
}

function dedupeHostnames(hostnames: string[]) {
  return Array.from(new Set(hostnames.map(normalizeHostname).filter(Boolean)));
}

function normalizeBaseUrl(input: string) {
  return input.trim().replace(/\/$/, "");
}

function createPublicIconUrl(publicBaseUrl: string, objectKey: string) {
  if (publicBaseUrl.endsWith("=") || publicBaseUrl.endsWith("/")) {
    return `${publicBaseUrl}${encodeObjectKeyPath(objectKey)}`;
  }
  return `${publicBaseUrl}/${encodeObjectKeyPath(objectKey)}`;
}

function normalizeObjectPrefix(input: string) {
  return input
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/");
}

function encodeObjectKeyPath(objectKey: string) {
  return objectKey
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function isNotFoundError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const maybeError = error as {
    name?: string;
    $metadata?: {
      httpStatusCode?: number;
    };
  };
  return maybeError.name === "NotFound"
    || maybeError.name === "NoSuchKey"
    || maybeError.$metadata?.httpStatusCode === 404;
}

main().catch((error) => {
  console.error("Failed to import Simple Icons to R2.");
  console.error(error);
  process.exit(1);
});
