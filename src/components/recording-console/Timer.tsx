"use client";

function format(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export default function Timer({ seconds }: { seconds: number }) {
  return (
    <div dir="ltr" className="text-center font-mono text-5xl font-bold tabular-nums">
      {format(seconds)}
    </div>
  );
}
