import type { Marker } from "./utils/zod-schemas";

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${init?.method ?? "GET"} ${url} -> ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export interface CreateSessionResponse {
  sessionId: string;
  raw: { uploadId: string; key: string };
  mixed: { uploadId: string; key: string };
}

export async function createSession(params: {
  episodeId: string;
  takeNumber: number;
  sampleRate: number;
}) {
  return jsonFetch<CreateSessionResponse>("/api/sessions", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function getPartUploadUrl(params: {
  sessionId: string;
  track: "raw" | "mixed";
  partNumber: number;
}) {
  return jsonFetch<{ url: string }>(`/api/sessions/${params.sessionId}/parts`, {
    method: "POST",
    body: JSON.stringify({ track: params.track, partNumber: params.partNumber }),
  });
}

export async function completeSession(params: {
  sessionId: string;
  totalSamples: number;
  markers: Marker[];
  raw: { uploadId: string; parts: { ETag: string; PartNumber: number }[] };
  mixed: { uploadId: string; parts: { ETag: string; PartNumber: number }[] };
}) {
  return jsonFetch<{ ok: true; rawUrl: string; mixedUrl: string }>(
    `/api/sessions/${params.sessionId}/complete`,
    { method: "POST", body: JSON.stringify(params) }
  );
}
