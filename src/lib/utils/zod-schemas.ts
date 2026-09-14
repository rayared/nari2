import { z } from "zod";

export const createProjectSchema = z.object({
  title: z.string().min(1).max(200),
});

export const createEpisodeSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(1).max(200),
  scriptText: z.string().max(200_000).default(""),
});

export const markerSchema = z.object({
  index: z.number().int().nonnegative(),
  sampleOffset: z.number().int().nonnegative(),
  seconds: z.number().nonnegative(),
  createdAt: z.string().datetime(),
});
export type Marker = z.infer<typeof markerSchema>;

export const createSessionSchema = z.object({
  episodeId: z.string().uuid(),
  takeNumber: z.number().int().positive(),
  sampleRate: z.literal(48000),
});

export const requestUploadPartSchema = z.object({
  sessionId: z.string().uuid(),
  track: z.enum(["raw", "mixed"]),
  partNumber: z.number().int().positive(),
});

export const completeSessionSchema = z.object({
  sessionId: z.string().uuid(),
  totalSamples: z.number().int().nonnegative(),
  markers: z.array(markerSchema),
  raw: z.object({
    uploadId: z.string(),
    parts: z.array(z.object({ ETag: z.string(), PartNumber: z.number().int().positive() })),
  }),
  mixed: z.object({
    uploadId: z.string(),
    parts: z.array(z.object({ ETag: z.string(), PartNumber: z.number().int().positive() })),
  }),
});

export const soundUploadSchema = z.object({
  category: z.enum(["music", "sfx"]),
  slot: z.number().int().min(1).max(5),
  title: z.string().min(1).max(100),
  gainDb: z.number().min(-60).max(0).default(-22),
  loop: z.boolean().default(false),
});
