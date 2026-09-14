"use client";

interface Props {
  rms: number;
  peak: number;
  clipping: boolean;
}

const dbfs = (lin: number) => (lin <= 0 ? -60 : 20 * Math.log10(lin));
const pct = (db: number) => Math.max(0, Math.min(100, ((db + 60) / 60) * 100));

export default function LevelMeter({ rms, peak, clipping }: Props) {
  const rmsDb = dbfs(rms);
  const peakDb = dbfs(peak);

  return (
    <div className="w-full">
      <div className="relative h-4 w-full overflow-hidden rounded-full bg-surface2">
        <div
          className="absolute inset-y-0 right-0 rounded-full bg-ok transition-[width] duration-75"
          style={{ width: `${pct(rmsDb)}%` }}
        />
        <div
          className="absolute inset-y-0 w-[2px] bg-white/70"
          style={{ right: `${pct(peakDb)}%` }}
        />
        {/* -18 dBFS target marker, per spec section 5 */}
        <div className="absolute inset-y-0 w-px bg-warn/70" style={{ right: `${pct(-18)}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-xs text-white/50">
        <span className={clipping ? "font-bold text-danger" : ""}>
          {clipping ? "کلیپینگ!" : `${peakDb.toFixed(1)} dB`}
        </span>
        <span>هدف: ‎-18 dBFS</span>
      </div>
    </div>
  );
}
