"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

interface Episode {
  id: string;
  title: string;
  status: string;
}

export default function EpisodesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [title, setTitle] = useState("");
  const [scriptText, setScriptText] = useState("");

  const load = async () => {
    const res = await fetch(`/api/episodes?projectId=${projectId}`);
    if (res.ok) setEpisodes(await res.json());
  };

  useEffect(() => {
    void load();
  }, [projectId]);

  const create = async () => {
    if (!title.trim()) return;
    await fetch("/api/episodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, title, scriptText }),
    });
    setTitle("");
    setScriptText("");
    await load();
  };

  const statusFa: Record<string, string> = {
    draft: "پیش‌نویس",
    recording: "در حال ضبط",
    uploading: "در حال آپلود",
    processing: "در حال پردازش",
    ready: "آماده",
    failed: "ناموفق",
  };

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-6 text-2xl font-bold">اپیزودها</h1>

      <div className="mb-6 space-y-2 rounded-xl bg-surface p-4">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="عنوان اپیزود"
          className="w-full rounded-lg bg-surface2 px-4 py-3 outline-none focus:ring-2 focus:ring-accent2"
        />
        <textarea
          value={scriptText}
          onChange={(e) => setScriptText(e.target.value)}
          placeholder="متن اسکریپت (اختیاری، بعداً هم می‌توان اضافه کرد)"
          rows={4}
          className="w-full rounded-lg bg-surface2 px-4 py-3 outline-none focus:ring-2 focus:ring-accent2"
        />
        <button onClick={create} className="touch-target w-full rounded-lg bg-accent2 py-3 font-semibold text-black">
          ساخت اپیزود
        </button>
      </div>

      <ul className="space-y-2">
        {episodes.map((e) => (
          <li key={e.id} className="flex items-center justify-between rounded-xl bg-surface px-4 py-4">
            <div>
              <div className="font-semibold">{e.title}</div>
              <div className="text-sm text-white/50">{statusFa[e.status] ?? e.status}</div>
            </div>
            <Link
              href={`/projects/${projectId}/episodes/${e.id}/prep`}
              className="touch-target rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-black"
            >
              ضبط
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
