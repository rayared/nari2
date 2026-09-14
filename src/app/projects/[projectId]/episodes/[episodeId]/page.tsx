"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface Marker {
  index: number;
  seconds: number;
}
interface SessionRow {
  id: string;
  takeNumber: number;
  status: string;
  totalSamples: number;
  sampleRate: number;
  markersJsonb: Marker[];
  rawUrl: string | null;
  mixedUrl: string | null;
}

export default function EpisodeDetailPage() {
  const { episodeId } = useParams<{ episodeId: string }>();
  const [title, setTitle] = useState("");
  const [sessions, setSessions] = useState<SessionRow[]>([]);

  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/episodes/${episodeId}`);
      if (!res.ok) return;
      const data = await res.json();
      setTitle(data.episode.title);
      setSessions(data.sessions);
    })();
  }, [episodeId]);

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-6 text-2xl font-bold">{title}</h1>

      {sessions.map((s) => (
        <div key={s.id} className="mb-6 rounded-xl bg-surface p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold">تیک {s.takeNumber}</span>
            <span className="text-sm text-white/50">{s.status}</span>
          </div>

          {s.mixedUrl && (
            <audio controls src={s.mixedUrl} className="mb-3 w-full" />
          )}

          <div className="flex gap-2">
            {s.rawUrl && (
              <a
                href={s.rawUrl}
                className="touch-target rounded-lg bg-surface2 px-4 py-2 text-sm"
              >
                دانلود Raw (WAV)
              </a>
            )}
            {s.mixedUrl && (
              <a
                href={s.mixedUrl}
                className="touch-target rounded-lg bg-surface2 px-4 py-2 text-sm"
              >
                دانلود Mixed (WebM)
              </a>
            )}
          </div>

          {s.markersJsonb?.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-sm text-white/50">سوتی‌ها</div>
              <ul className="flex flex-wrap gap-2">
                {s.markersJsonb.map((m) => (
                  <li key={m.index} className="rounded-full bg-accent/20 px-3 py-1 text-xs text-accent">
                    #{m.index + 1} — {fmt(m.seconds)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}

      {sessions.length === 0 && <p className="text-white/50">هنوز تیکی ضبط نشده است.</p>}
    </main>
  );
}
