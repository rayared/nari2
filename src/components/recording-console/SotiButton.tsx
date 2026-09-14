"use client";

export default function SotiButton({ onMark, count }: { onMark: () => void; count: number }) {
  return (
    <button
      onClick={onMark}
      className="h-soti w-full rounded-2xl bg-accent text-xl font-extrabold text-black shadow-lg active:scale-[0.98]"
      aria-label="ثبت سوتی"
    >
      سوتی! ({count})
    </button>
  );
}
