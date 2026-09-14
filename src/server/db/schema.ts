import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  bigint,
  jsonb,
  doublePrecision,
  boolean,
  pgEnum,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const episodeStatus = pgEnum("episode_status", [
  "draft",
  "recording",
  "uploading",
  "processing",
  "ready",
  "failed",
]);

export const sessionStatus = pgEnum("session_status", [
  "recording",
  "paused",
  "uploading",
  "complete",
  "failed",
]);

export const soundCategory = pgEnum("sound_category", ["music", "sfx"]);

// ---------------------------------------------------------------------------
// Tables (5, per spec section 4)
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const episodes = pgTable("episodes", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  scriptText: text("script_text").notNull().default(""),
  status: episodeStatus("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  episodeId: uuid("episode_id")
    .notNull()
    .references(() => episodes.id, { onDelete: "cascade" }),
  takeNumber: integer("take_number").notNull().default(1),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  sampleRate: integer("sample_rate").notNull().default(48000),
  totalSamples: bigint("total_samples", { mode: "number" }).notNull().default(0),
  status: sessionStatus("status").notNull().default("recording"),
  rawKey: text("raw_key"),
  mixedKey: text("mixed_key"),
  rawUploadId: text("raw_upload_id"),
  mixedUploadId: text("mixed_upload_id"),
  // markers: { index, sampleOffset, seconds, createdAt }[]
  markersJsonb: jsonb("markers_jsonb").notNull().default(sql`'[]'::jsonb`),
});

export const sounds = pgTable("sounds", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  category: soundCategory("category").notNull(),
  slot: integer("slot").notNull(), // 1..5, unique per (owner, category)
  title: text("title").notNull(),
  storageKey: text("storage_key").notNull(),
  gainDb: doublePrecision("gain_db").notNull().default(-22),
  loop: boolean("loop").notNull().default(false),
});

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
  sounds: many(sounds),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  owner: one(users, { fields: [projects.ownerId], references: [users.id] }),
  episodes: many(episodes),
}));

export const episodesRelations = relations(episodes, ({ one, many }) => ({
  project: one(projects, { fields: [episodes.projectId], references: [projects.id] }),
  sessions: many(sessions),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  episode: one(episodes, { fields: [sessions.episodeId], references: [episodes.id] }),
}));
