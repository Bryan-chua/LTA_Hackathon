import { readFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required.");
const sql = postgres(url, { max: 1, prepare: false, ssl: process.env.NODE_ENV === "production" ? "require" : undefined });
try {
  const migration = await readFile(join(process.cwd(), "db", "migrations", "001_notification_profiles.sql"), "utf8");
  await sql.unsafe(migration);
  console.log("Applied 001_notification_profiles.sql");
} finally {
  await sql.end();
}
