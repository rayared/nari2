import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { episodes, projects, sessions } from "@/server/db/schema";
import {
  createSessionSchema,
  requestUploadPartSchema,
  completeSessionSchema,
} from "@/lib/utils/zod-schemas";
import {
  createMultipartUpload,
  objectKey,
  presignUploadPart,
  completeMultipartUpload,
  presignDownload,
} from "@/server/storage";
import type { AppEnv } from "../app";

const route = new Hono<AppEnv>();

async function ownerIdForEpisode(episodeId: string): Promise<string | null> {
  const [row] = await db
    .select({ ownerId: projects.ownerId })
    .from(episodes)
    .innerJoin(projects, eq(episodes.projectId, projects.id))
    .where(eq(episodes.id, episodeId));
  return row?.ownerId ?? null;
}

// Creates the DB row + two parallel S3 multipart uploads (raw, mixed) in one
// call, per architecture section 2 - "سه خروجی موازی از یک ضبط". Keys and
// uploadIds are persisted immediately so /parts can look them up by
// sessionId alone (the client only ever needs to remember the sessionId,
// which is what survives a page reload via IndexedDB - see idb.ts).
route.post("/", async (c) => {
  const userId = c.get("userId");
  const body = createSessionSchema.parse(await c.req.json());

  const ownerId = await ownerIdForEpisode(body.episodeId);
  if (!ownerId || ownerId !== userId) return c.json({ error: "forbidden" }, 403);

  const [session] = await db
    .insert(sessions)
    .values({
      episodeId: body.episodeId,
      takeNumber: body.takeNumber,
      sampleRate: body.sampleRate,
      status: "recording",
    })
    .returning();
  if (!session) throw new Error("insert into sessions returned no row");

  const rawKey = objectKey({
    ownerId,
    episodeId: body.episodeId,
    sessionId: session.id,
    track: "raw",
    ext: "wav",
  });
  const mixedKey = objectKey({
    ownerId,
    episodeId: body.episodeId,
    sessionId: session.id,
    track: "mixed",
    ext: "webm",
  });

  const [rawUploadId, mixedUploadId] = await Promise.all([
    createMultipartUpload(rawKey, "audio/wav"),
    createMultipartUpload(mixedKey, "audio/webm"),
  ]);

  await db
    .update(sessions)
    .set({ rawKey, mixedKey, rawUploadId, mixedUploadId })
    .where(eq(sessions.id, session.id));

  await db.update(episodes).set({ status: "recording" }).where(eq(episodes.id, body.episodeId));

  return c.json({
    sessionId: session.id,
    raw: { uploadId: rawUploadId, key: rawKey },
    mixed: { uploadId: mixedUploadId, key: mixedKey },
  });
});

// Presigns exactly one S3 UploadPart URL. Chunk bytes never transit our
// server - the browser PUTs them straight to the bucket (keeps this route,
// and section 7's "no queue, no FFmpeg" constraint, honest).
route.post("/:id/parts", async (c) => {
  const sessionId = c.req.param("id");
  const body = requestUploadPartSchema.parse({ ...(await c.req.json()), sessionId });

  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!session) return c.json({ error: "not found" }, 404);

  const key = body.track === "raw" ? session.rawKey : session.mixedKey;
  const uploadId = body.track === "raw" ? session.rawUploadId : session.mixedUploadId;
  if (!key || !uploadId) return c.json({ error: "session has no active multipart upload" }, 409);

  const url = await presignUploadPart(key, uploadId, body.partNumber);
  return c.json({ url });
});

route.post("/:id/complete", async (c) => {
  const sessionId = c.req.param("id");
  const body = completeSessionSchema.parse({ ...(await c.req.json()), sessionId });

  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!session || !session.rawKey || !session.mixedKey) {
    return c.json({ error: "not found" }, 404);
  }

  await Promise.all([
    completeMultipartUpload(session.rawKey, body.raw.uploadId, body.raw.parts),
    completeMultipartUpload(session.mixedKey, body.mixed.uploadId, body.mixed.parts),
  ]);

  await db
    .update(sessions)
    .set({
      status: "complete",
      endedAt: new Date(),
      totalSamples: body.totalSamples,
      markersJsonb: body.markers,
    })
    .where(eq(sessions.id, sessionId));

  await db.update(episodes).set({ status: "ready" }).where(eq(episodes.id, session.episodeId));

  const [rawUrl, mixedUrl] = await Promise.all([
    presignDownload(session.rawKey),
    presignDownload(session.mixedKey),
  ]);

  return c.json({ ok: true, rawUrl, mixedUrl });
});

export default route;
