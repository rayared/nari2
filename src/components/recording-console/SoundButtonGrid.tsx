"use client";

interface SlotDef {
  slot: number;
  title: string;
  loaded: boolean;
}

interface Props {
  music: SlotDef[];
  sfx: SlotDef[];
  activeMusicSlots: Set<number>;
  onMusicToggle: (slot: number) => void;
  onSfxPlay: (slot: number) => void;
}

function SlotButton({
  def,
  active,
  onClick,
}: {
  def: SlotDef;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!def.loaded}
      className={`touch-target flex h-14 flex-col items-center justify-center rounded-lg text-xs font-semibold disabled:opacity-30 ${
        active ? "bg-ok text-black" : "bg-surface2 text-white"
      }`}
    >
      <span className="text-[10px] opacity-60">{def.slot}</span>
      <span className="truncate px-1">{def.title || "خالی"}</span>
    </button>
  );
}

export default function SoundButtonGrid({
  music,
  sfx,
  activeMusicSlots,
  onMusicToggle,
  onSfxPlay,
}: Props) {
  return (
    <div className="space-y-2">
      <div>
        <div className="mb-1 text-xs text-white/50">موسیقی (۱–۵)</div>
        <div className="grid grid-cols-5 gap-2">
          {music.map((m) => (
            <SlotButton
              key={m.slot}
              def={m}
              active={activeMusicSlots.has(m.slot)}
              onClick={() => onMusicToggle(m.slot)}
            />
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1 text-xs text-white/50">افکت (۶–۱۰)</div>
        <div className="grid grid-cols-5 gap-2">
          {sfx.map((s) => (
            <SlotButton key={s.slot} def={s} active={false} onClick={() => onSfxPlay(s.slot)} />
          ))}
        </div>
      </div>
    </div>
  );
}
