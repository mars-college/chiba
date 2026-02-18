import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getDbConfig } from "./config.js";
import * as schema from "./schema.js";

export type Cable3Db = NodePgDatabase<typeof schema>;

export function createDbPool(): Pool {
  const cfg = getDbConfig();
  return new Pool({ connectionString: cfg.databaseUrl });
}

export function createDb(pool: Pool): Cable3Db {
  return drizzle(pool, { schema });
}

export { schema };

