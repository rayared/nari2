"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useRecordingStore } from "@/lib/state/recording-store";
import LevelMeter from "@/components/recording-console/LevelMeter";

export default function PrepPage() {
  const { projectId, episodeId } = useParams<{ projectId: string; episodeId: string }>();
  const router = useRouter();
  const { phase, level, gateThresholdDb, init, calibrate } = useRecordingStore();

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>();
  const [headphonesConfirmed, setHeadphonesConfirmed] = useState(false);
  const [likelyHeadphones, setLikelyHeadphones] = useState<boolean | null>(null);

  useEffect(() => {
    void navigator.mediaDevices.enumerateDevices().then((all) => {
      setDevices(all.filter((d) => d.kind === "audioinput"));
      // Best-effort only: browsers don't expose a reliable "headphones
      // connected" API. We pattern-match output device labels and otherwise
      // fall back to asking the user directly (see checkbox below).
      const out = all.find(
        (d) => d.kind === "audiooutput" && /headphone|earphone|handsfree|هدفون/i.test(d.label)
      );
      setLikelyHeadphones(out ? true : all.some((d) => d.kind === "audiooutput") ? false : null);
    });
  }, []);

  const startCalibration = async () => {
    await init(deviceId);
    await calibrate();
  };

  const canProceed = phase === "ready" && (headphonesConfirmed || likelyHeadphones);

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="mb-6 text-xl font-bold">آمادگی برای ضبط</h1>

      <label className="mb-2 block text-sm text-white/60">میکروفن</label>
      <select
        value={deviceId}
        onChange={(e) => setDeviceId(e.target.value)}
        className="mb-4 w-full rounded-lg bg-surface2 px-4 py-3"
      >
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || "میکروفن"}
          </option>
        ))}
      </select>

      {phase === "idle" && (
        <button
          onClick={startCalibration}
          className="touch-target w-full rounded-lg bg-accent2 py-3 font-semibold text-black"
        >
          شروع کالیبراسیون (۲ ثانیه سکوت نگه دارید)
        </button>
      )}

      {(phase === "initializing" || phase === "calibrating") && (
        <p className="text-center text-white/60">در حال آماده‌سازی...</p>
      )}

      {(phase === "ready" || phase === "calibrating") && (
        <div className="mt-4 space-y-3">
          <LevelMeter rms={level.rms} peak={level.peak} clipping={level.clipping} />
          {gateThresholdDb !== null && (
            <p className="text-xs text-white/50">
              آستانهٔ گیت: {gateThresholdDb.toFixed(1)} dB
            </p>
          )}
        </div>
      )}

      {likelyHeadphones === false && (
        <label className="mt-4 flex items-center gap-2 rounded-lg bg-warn/10 p-3 text-sm text-warn">
          <input
            type="checkbox"
            checked={headphonesConfirmed}
            onChange={(e) => setHeadphonesConfirmed(e.target.checked)}
          />
          هدفون وصل نیست تشخیص داده شد. تأیید می‌کنم که می‌خواهم بدون هدفون ادامه دهم.
        </label>
      )}

      <button
        disabled={!canProceed}
        onClick={() => router.push(`/projects/${projectId}/episodes/${episodeId}/record`)}
        className="touch-target mt-6 w-full rounded-lg bg-ok py-3 font-semibold text-black disabled:opacity-30"
      >
        ورود به اتاق ضبط
      </button>
    </main>
  );
}
