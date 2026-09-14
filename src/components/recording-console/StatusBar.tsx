"use client";

interface Props {
  online: boolean;
  bufferedMinutesHeadroom: number | null;
}

export default function StatusBar({ online, bufferedMinutesHeadroom }: Props) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-surface2 px-3 py-2 text-xs">
      <span className={online ? "text-ok" : "text-warn"}>
        {online ? "آنلاین ✓" : "آفلاین — در حال بافر کردن روی دستگاه"}
      </span>
      {bufferedMinutesHeadroom !== null && (
        <span className="text-white/50">
          ظرفیت باقی‌مانده: ~{Math.max(0, Math.round(bufferedMinutesHeadroom))} دقیقه
        </span>
      )}
    </div>
  );
}
