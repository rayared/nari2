import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { episodes, projects, sessions } from "@/server/db/schema";
import { createEpisodeSchema } from "@/lib/utils/zod-schemas";
import { presignDownload } from "@/server/storage";
import type { AppEnv } from "../app";
import { assertProjectOwnership } from "./projects";

const route = new Hono<AppEnv>();

route.get("/", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.query("projectId");
  if (!projectId) return c.json({ error: "projectId query param required" }, 400);
  await assertProjectOwnership(userId, projectId).catch(() => {
    throw new Error("forbidden");
  });
  const rows = await db.select().from(episodes).where(eq(episodes.projectId, projectId));
  return c.json(rows);
});

route.post("/", async (c) => {
  const userId = c.get("userId");
  const body = createEpisodeSchema.parse(await c.req.json());
  await assertProjectOwnership(userId, body.projectId);
  const [row] = await db
    .insert(episodes)
    .values({ projectId: body.projectId, title: body.title, scriptText: body.scriptText })
    .returning();
  return c.json(row, 201);
});

// Episode detail page: latest ready session + presigned playback/download URLs.
route.get("/:id", async (c) => {
  const episodeId = c.req.param("id");
  const [episode] = await db.select().from(episodes).where(eq(episodes.id, episodeId));
  if (!episode) return c.json({ error: "not found" }, 404);

  const episodeSessions = await db
    .select()
    .from(sessions)
    .where(eq(sessions.episodeId, episodeId));

  const withUrls = await Promise.all(
    episodeSessions.map(async (s) => ({
      ...s,
      rawUrl: s.rawKey ? await presignDownload(s.rawKey) : null,
      mixedUrl: s.mixedKey ? await presignDownload(s.mixedKey) : null,
    }))
  );

  return c.json({ episode, sessions: withUrls });
});

route.patch("/:id/script", async (c) => {
  const episodeId = c.req.param("id");
  const { scriptText } = (await c.req.json()) as { scriptText: string };
  const [row] = await db
    .update(episodes)
    .set({ scriptText })
    .where(eq(episodes.id, episodeId))
    .returning();
  return c.json(row);
});

export default route;
