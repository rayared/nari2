import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { db } from "@/server/db";
import { sounds } from "@/server/db/schema";
import { soundUploadSchema } from "@/lib/utils/zod-schemas";
import { s3, presignDownload } from "@/server/storage";
import type { AppEnv } from "../app";

const route = new Hono<AppEnv>();
const BUCKET = process.env.S3_BUCKET!;

// Library files are small (a music bed, an SFX one-shot) so a single PUT is
// fine here - no need for the multipart machinery the live take uses.
route.post("/upload-url", async (c) => {
  const userId = c.get("userId");
  const body = soundUploadSchema.parse(await c.req.json());
  const key = `u/${userId}/library/${body.category}/${body.slot}-${Date.now()}`;

  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: "audio/*" }),
    { expiresIn: 5 * 60 }
  );

  const existing = await db
    .select({ id: sounds.id })
    .from(sounds)
    .where(
      and(eq(sounds.ownerId, userId), eq(sounds.category, body.category), eq(sounds.slot, body.slot))
    );

  const existingRow = existing[0];
  if (existingRow) {
    await db
      .update(sounds)
      .set({ title: body.title, storageKey: key, gainDb: body.gainDb, loop: body.loop })
      .where(eq(sounds.id, existingRow.id));
  } else {
    await db.insert(sounds).values({
      ownerId: userId,
      category: body.category,
      slot: body.slot,
      title: body.title,
      storageKey: key,
      gainDb: body.gainDb,
      loop: body.loop,
    });
  }

  return c.json({ uploadUrl: url, key });
});

route.get("/", async (c) => {
  const userId = c.get("userId");
  const rows = await db.select().from(sounds).where(eq(sounds.ownerId, userId));
  const withUrls = await Promise.all(
    rows.map(async (r) => ({ ...r, downloadUrl: await presignDownload(r.storageKey) }))
  );
  return c.json(withUrls);
});

export default route;
