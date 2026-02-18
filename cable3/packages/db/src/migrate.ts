import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Cable3Db } from "./db.js";

export async function runMigrations(args: {
  db: Cable3Db;
  migrationsDir: string;
}): Promise<void> {
  await migrate(args.db, { migrationsFolder: args.migrationsDir });
}

