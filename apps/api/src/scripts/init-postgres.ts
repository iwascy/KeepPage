import { readdir, readFile } from "node:fs/promises";
import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const databaseUrl = DATABASE_URL;

const migrationsDirUrl = new URL(
  "../../../../packages/db/migrations/",
  import.meta.url,
);

const DUPLICATE_ERROR_CODES = new Set(["42701", "42710", "42P07"]);

async function main() {
  const parsedUrl = new URL(databaseUrl);
  const targetDatabase = parsedUrl.pathname.replace(/^\//, "") || "keeppage";
  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = "/postgres";

  const adminClient = new Client({
    connectionString: adminUrl.toString(),
  });

  await adminClient.connect();
  try {
    const existingDatabase = await adminClient.query(
      "select 1 from pg_database where datname = $1",
      [targetDatabase],
    );
    if (existingDatabase.rowCount === 0) {
      await adminClient.query(`create database "${targetDatabase}"`);
      console.log(`Database created: ${targetDatabase}`);
    }
  } finally {
    await adminClient.end();
  }

  const migrationFiles = (await readdir(migrationsDirUrl))
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort();

  const client = new Client({
    connectionString: databaseUrl,
  });

  await client.connect();
  try {
    for (const migrationFile of migrationFiles) {
      const migrationUrl = new URL(migrationFile, migrationsDirUrl);
      const sqlText = await readFile(migrationUrl, "utf8");
      const statements = sqlText
        .split(/;\s*\n/g)
        .map((statement) => statement.trim())
        .filter((statement) => statement.length > 0);

      for (const statement of statements) {
        try {
          await client.query(`${statement};`);
        } catch (error) {
          if (
            typeof error === "object" &&
            error &&
            "code" in error &&
            DUPLICATE_ERROR_CODES.has(String(error.code))
          ) {
            continue;
          }
          throw error;
        }
      }
    }
    console.log(`Postgres schema initialized for ${targetDatabase}.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Failed to initialize Postgres schema.");
  console.error(error);
  process.exit(1);
});
