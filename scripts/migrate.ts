import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

async function main() {
  const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL (preferred) or DATABASE_URL is required.");

  const sql = postgres(url, { max: 1, prepare: false, ssl: "require" });
  try {
    await sql.unsafe(`
      create table if not exists app_schema_migrations (
        filename text primary key,
        applied_at timestamptz not null default now()
      )
    `);
    const directory = join(process.cwd(), "db", "migrations");
    const filenames = (await readdir(directory)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
    const applied = await sql<Array<{ filename: string }>>`select filename from app_schema_migrations`;
    const complete = new Set(applied.map((row) => row.filename));
    for (const filename of filenames) {
      if (complete.has(filename)) {
        console.log(`Skipped ${filename} (already applied)`);
        continue;
      }
      const migration = await readFile(join(directory, filename), "utf8");
      await sql.begin(async (transaction) => {
        await transaction.unsafe(migration);
        await transaction`insert into app_schema_migrations (filename) values (${filename})`;
      });
      console.log(`Applied ${filename}`);
    }
  } finally {
    await sql.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
