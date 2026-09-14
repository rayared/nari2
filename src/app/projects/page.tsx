"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

interface Project {
  id: string;
  title: string;
  createdAt: string;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const res = await fetch("/api/projects");
    if (res.ok) setProjects(await res.json());
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const create = async () => {
    if (!title.trim()) return;
    await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    setTitle("");
    await load();
  };

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-6 text-2xl font-bold">پروژه‌ها</h1>

      <div className="mb-6 flex gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="عنوان پروژهٔ جدید"
          className="flex-1 rounded-lg bg-surface2 px-4 py-3 outline-none focus:ring-2 focus:ring-accent2"
        />
        <button onClick={create} className="touch-target rounded-lg bg-accent2 px-5 font-semibold text-black">
          افزودن
        </button>
      </div>

      {loading ? (
        <p className="text-white/50">در حال بارگذاری...</p>
      ) : (
        <ul className="space-y-2">
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                href={`/projects/${p.id}/episodes`}
                className="block rounded-xl bg-surface px-4 py-4 hover:bg-surface2"
              >
                {p.title}
              </Link>
            </li>
          ))}
          {projects.length === 0 && (
            <p className="text-white/50">هنوز پروژه‌ای نساخته‌اید.</p>
          )}
        </ul>
      )}
    </main>
  );
}
