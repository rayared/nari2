"use client";

export default function EchoButton({
  active,
  onDown,
  onUp,
}: {
  active: boolean;
  onDown: () => void;
  onUp: () => void;
}) {
  return (
    <button
      onPointerDown={(e) => {
        e.preventDefault();
        onDown();
      }}
      onPointerUp={onUp}
      onPointerLeave={onUp}
      onPointerCancel={onUp}
      className={`touch-target h-16 w-full rounded-xl text-lg font-bold transition-colors ${
        active ? "bg-accent2 text-black" : "bg-surface2 text-white"
      }`}
    >
      اکو (نگه دارید)
    </button>
  );
}
