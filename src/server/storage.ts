import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// R2 / MinIO / any S3-compatible endpoint. Bucket is fully private;
// every read/write to the browser goes through a short-lived presigned URL.
export const s3 = new S3Client({
  region: process.env.S3_REGION ?? "auto",
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.S3_BUCKET!;
const PRESIGN_TTL_SECONDS = 5 * 60;

export function objectKey(params: {
  ownerId: string;
  episodeId: string;
  sessionId: string;
  track: "raw" | "mixed";
  ext: string;
}) {
  const { ownerId, episodeId, sessionId, track, ext } = params;
  return `u/${ownerId}/ep/${episodeId}/session/${sessionId}/${track}.${ext}`;
}

export async function createMultipartUpload(key: string, contentType: string) {
  const out = await s3.send(
    new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: key, ContentType: contentType })
  );
  if (!out.UploadId) throw new Error("S3 did not return an UploadId");
  return out.UploadId;
}

/**
 * Chunks never pass through our server (keeps the API route light and avoids
 * doubling upload bandwidth). We presign each part URL and the client PUTs
 * directly to the bucket, exactly as sessions.md's "Chunk 5s -> UploadQueue -> S3
 * Multipart" flow expects.
 */
export async function presignUploadPart(key: string, uploadId: string, partNumber: number) {
  const cmd = new UploadPartCommand({
    Bucket: BUCKET,
    Key: key,
    UploadId: uploadId,
    PartNumber: partNumber,
  });
  return getSignedUrl(s3, cmd, { expiresIn: PRESIGN_TTL_SECONDS });
}

export async function completeMultipartUpload(
  key: string,
  uploadId: string,
  parts: { ETag: string; PartNumber: number }[]
) {
  // Parts must be sorted ascending by PartNumber or S3 rejects the request.
  const sorted = [...parts].sort((a, b) => a.PartNumber - b.PartNumber);
  await s3.send(
    new CompleteMultipartUploadCommand({
      Bucket: BUCKET,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: sorted },
    })
  );
}

export async function abortMultipartUpload(key: string, uploadId: string) {
  await s3.send(new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId }));
}

export async function presignDownload(key: string) {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: PRESIGN_TTL_SECONDS });
}
