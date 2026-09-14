import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Single pooled connection, reused across hot reloads in dev.
declare global {
  // eslint-disable-next-line no-var
  var __studioDbClient: ReturnType<typeof postgres> | undefined;
}

// postgres.js connects lazily (on first query), so it's safe to construct
// this at module load even without a real DATABASE_URL - which matters
// because Next.js's `next build` statically imports every API route module
// during its "Collecting page data" step just to read metadata, and
// Auth.js's DrizzleAdapter fingerprints the db object's shape at
// construction time (so a lazy Proxy standing in for it, tried earlier,
// doesn't satisfy that check). If DATABASE_URL is genuinely missing at
// runtime, the first real query will fail with a clear connection error
// instead of a cryptic build failure.
const connectionString =
  process.env.DATABASE_URL ?? "postgres://build-placeholder:build-placeholder@localhost:5432/build";

if (!process.env.DATABASE_URL && process.env.NODE_ENV === "production" && !process.env.NEXT_PHASE) {
  // eslint-disable-next-line no-console
  console.warn(
    "DATABASE_URL is not set - using a placeholder connection string. Set it in your environment before serving real traffic."
  );
}

const client =
  globalThis.__studioDbClient ?? postgres(connectionString, { max: 10, prepare: false });

if (process.env.NODE_ENV !== "production") {
  globalThis.__studioDbClient = client;
}

export const db = drizzle(client, { schema });
export type Db = typeof db;
