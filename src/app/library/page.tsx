"use client";
import { useEffect, useState } from "react";

interface SoundRow {
  id: string;
  category: "music" | "sfx";
  slot: number;
  title: string;
  gainDb: number;
  loop: boolean;
}

const SLOTS = [1, 2, 3, 4, 5];

export default function LibraryPage() {
  const [sounds, setSounds] = useState<SoundRow[]>([]);

  const load = async () => {
    const res = await fetch("/api/sounds");
    if (res.ok) setSounds(await res.json());
  };

  useEffect(() => {
    void load();
  }, []);

  const upload = async (
    category: "music" | "sfx",
    slot: number,
    file: File,
    title: string
  ) => {
    const { uploadUrl } = await fetch("/api/sounds/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, slot, title, gainDb: category === "music" ? -22 : -12 }),
    }).then((r) => r.json());

    await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
    await load();
  };

  const findSound = (category: "music" | "sfx", slot: number) =>
    sounds.find((s) => s.category === category && s.slot === slot);

  const renderRow = (category: "music" | "sfx", slot: number) => {
    const existing = findSound(category, slot);
    return (
      <div key={`${category}-${slot}`} className="flex items-center gap-3 rounded-lg bg-surface2 p-3">
        <span className="w-6 text-center text-white/50">{slot}</span>
        <span className="flex-1 truncate">{existing?.title ?? "— خالی —"}</span>
        <label className="touch-target cursor-pointer rounded-lg bg-accent2 px-3 py-2 text-sm font-semibold text-black">
          آپلود
          <input
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(category, slot, file, file.name);
            }}
          />
        </label>
      </div>
    );
  };

  return (
    <main className="mx-auto max-w-2xl space-y-8 p-6">
      <h1 className="text-2xl font-bold">کتابخانهٔ صدا (۱۰ اسلات)</h1>
      <section>
        <h2 className="mb-2 font-semibold">موسیقی (۱–۵)</h2>
        <div className="space-y-2">{SLOTS.map((s) => renderRow("music", s))}</div>
      </section>
      <section>
        <h2 className="mb-2 font-semibold">افکت (۱–۵)</h2>
        <div className="space-y-2">{SLOTS.map((s) => renderRow("sfx", s))}</div>
      </section>
    </main>
  );
}
