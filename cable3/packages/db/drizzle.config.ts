import type { Config } from "drizzle-kit";

const databaseUrl =
  process.env.CHIBA3_DB_URL?.trim() ??
  "postgresql://chiba:chiba@127.0.0.1:54339/chiba3";

export default {
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
  strict: true,
} satisfies Config;

