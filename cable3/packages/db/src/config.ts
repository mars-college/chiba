import path from "node:path";
import process from "node:process";

export type DbConfig = {
  databaseUrl: string;
  migrationsDir: string;
};

export function getDbConfig(): DbConfig {
  const databaseUrl =
    process.env.CHIBA3_DB_URL?.trim() ??
    "postgresql://chiba:chiba@127.0.0.1:54339/chiba3";
  const migrationsDir = path.resolve(process.cwd(), "migrations");
  return { databaseUrl, migrationsDir };
}
