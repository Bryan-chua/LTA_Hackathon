import postgres from "postgres";
import { ProviderError } from "../provider-contracts";

type Sql = ReturnType<typeof postgres>;
const globalDatabase = globalThis as typeof globalThis & { smartCommuteSql?: Sql };

export function database(): Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new ProviderError("PostgreSQL", "configuration", "Database is not configured.");
  return globalDatabase.smartCommuteSql ??= postgres(url, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    ssl: "require",
  });
}
