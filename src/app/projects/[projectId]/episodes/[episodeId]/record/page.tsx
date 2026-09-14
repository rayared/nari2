"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useRecordingStore } from "@/lib/state/recording-store";
import LevelMeter from "@/components/recording-console/LevelMeter";
import Timer from "@/components/recording-console/Timer";
import StatusBar from "@/components/recording-console/StatusBar";
import SotiButton from "@/components/recording-console/SotiButton";
import EchoButton from "@/components/recording-console/EchoButton";
import SoundButtonGrid from "@/components/recording-console/SoundButtonGrid";

interface SoundRow {
  id: string;
  category: "music" | "sfx";
  slot: number;
  title: string;
  downloadUrl: string;
}

export default function RecordPage() {
  const { projectId, episodeId } = useParams<{ projectId: string; episodeId: string }>();
  const router = useRouter();
  const store = useRecordingStore();
  const {
    phase,
    level,
    elapsedSeconds,
    markers,
    online,
    bufferedMinutesHeadroom,
    activeMusicSlots,
    echoActive,
  } = store;

  const [scriptText, setScriptText] = useState("");
  const [soundsLoaded, setSoundsLoaded] = useState<Record<string, boolean>>({});
  const [takeNumber, setTakeNumber] = useState(1);

  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/episodes/${episodeId}`);
      if (!res.ok) return;
      const data = await res.json();
      setScriptText(data.episode.scriptText ?? "");
      setTakeNumber((data.sessions?.length ?? 0) + 1);

      const soundsRes = await fetch("/api/sounds");
      if (!soundsRes.ok) return;
      const sounds: SoundRow[] = await soundsRes.json();
      for (const s of sounds) {
        const buf = await fetch(s.downloadUrl).then((r) => r.arrayBuffer());
        await store.loadSound(s.category, s.slot, buf);
        setSoundsLoaded((m) => ({ ...m, [`${s.category}:${s.slot}`]: true }));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeId]);

  // Warn before an accidental tab close while unflushed data may still exist.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (phase === "recording" || phase === "paused" || phase === "finalizing") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [phase]);

  const music = Array.from({ length: 5 }, (_, i) => ({
    slot: i + 1,
    title: "",
    loaded: !!soundsLoaded[`music:${i + 1}`],
  }));
  const sfx = Array.from({ length: 5 }, (_, i) => ({
    slot: i + 1,
    title: "",
    loaded: !!soundsLoaded[`sfx:${i + 1}`],
  }));

  const handleStop = async () => {
    const result = await store.stop();
    if (result) router.push(`/projects/${projectId}/episodes/${episodeId}`);
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-4 pb-8">
      <StatusBar online={online} bufferedMinutesHeadroom={bufferedMinutesHeadroom} />

      <Timer seconds={elapsedSeconds} />
      <LevelMeter rms={level.rms} peak={level.peak} clipping={level.clipping} />

      <div className="max-h-40 overflow-y-auto rounded-xl bg-surface p-4 text-sm leading-7 text-white/80">
        {scriptText || "متن اسکریپتی ثبت نشده است."}
      </div>

      {phase === "ready" && (
        <button
          onClick={() => store.startRecording(episodeId, takeNumber)}
          className="touch-target w-full rounded-xl bg-danger py-4 text-lg font-bold"
        >
          شروع ضبط (تیک {takeNumber})
        </button>
      )}

      {(phase === "recording" || phase === "paused") && (
        <>
          <SotiButton onMark={store.markSoti} count={markers.length} />

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => (phase === "recording" ? store.pause() : store.resume())}
              className="touch-target rounded-xl bg-surface2 py-4 font-semibold"
            >
              {phase === "recording" ? "توقف موقت" : "ادامه"}
            </button>
            <button
              onClick={handleStop}
              className="touch-target rounded-xl bg-white/10 py-4 font-semibold"
            >
              پایان ضبط
            </button>
          </div>

          <EchoButton active={echoActive} onDown={store.echoDown} onUp={store.echoUp} />

          <SoundButtonGrid
            music={music}
            sfx={sfx}
            activeMusicSlots={activeMusicSlots}
            onMusicToggle={(slot) => store.toggleMusic(slot)}
            onSfxPlay={(slot) => store.playSfx(slot)}
          />
        </>
      )}

      {phase === "finalizing" && (
        <p className="text-center text-white/60">در حال نهایی‌سازی و آپلود...</p>
      )}
    </main>
  );
}
