"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

const MIN_DURATION = 15;
const MAX_DURATION = 20;

interface SceneItem {
  id: string;
  file: File;
  previewUrl: string;
}

const baseCoreURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";

let ffmpegClass: (new () => FFmpeg) | null = null;

const ensureFFmpegClass = async () => {
  if (ffmpegClass) {
    return ffmpegClass;
  }
  const ffmpegModule = await import("@ffmpeg/ffmpeg");
  ffmpegClass = ffmpegModule.FFmpeg;
  return ffmpegClass;
};

export default function Home() {
  const [scenes, setScenes] = useState<SceneItem[]>([]);
  const [totalDuration, setTotalDuration] = useState<number>(18);
  const [status, setStatus] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const [isFfmpegReady, setIsFfmpegReady] = useState<boolean>(false);

  const loadFFmpeg = useCallback(async () => {
    if (ffmpegRef.current?.loaded) {
      return;
    }

    if (!ffmpegRef.current) {
      const FFmpegConstructor = await ensureFFmpegClass();
      ffmpegRef.current = new FFmpegConstructor();
    }

    const ffmpeg = ffmpegRef.current;
    if (!ffmpeg) {
      throw new Error("FFmpeg engine unavailable.");
    }

    setStatus("جارٍ تحميل محرك التحويل...");

    if (!ffmpeg.loaded) {
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseCoreURL}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${baseCoreURL}/ffmpeg-core.wasm`, "application/wasm"),
        workerURL: await toBlobURL(`${baseCoreURL}/ffmpeg-core.worker.js`, "text/javascript"),
      });
    }

    setIsFfmpegReady(true);
    setStatus("");
  }, []);

  useEffect(() => {
    loadFFmpeg().catch((error) => {
      console.error(error);
      setStatus("تعذر تحميل المحرك. أعد تحميل الصفحة وحاول من جديد.");
    });
  }, [loadFFmpeg]);

  const handleFileSelection = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    const items: SceneItem[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) {
        continue;
      }
      const id = `${file.name}-${crypto.randomUUID()}`;
      const previewUrl = URL.createObjectURL(file);
      items.push({ id, file, previewUrl });
    }

    setScenes((prev) => [...prev, ...items]);
    event.target.value = "";
  }, []);

  const removeScene = useCallback((id: string) => {
    setScenes((prev) => {
      prev.forEach((scene) => {
        if (scene.id === id) {
          URL.revokeObjectURL(scene.previewUrl);
        }
      });
      return prev.filter((scene) => scene.id !== id);
    });
  }, []);

  const moveScene = useCallback((id: string, direction: -1 | 1) => {
    setScenes((prev) => {
      const index = prev.findIndex((scene) => scene.id === id);
      if (index === -1) return prev;
      const newIndex = index + direction;
      if (newIndex < 0 || newIndex >= prev.length) return prev;

      const updated = [...prev];
      const [item] = updated.splice(index, 1);
      updated.splice(newIndex, 0, item);
      return updated;
    });
  }, []);

  const clearAll = useCallback(() => {
    setScenes((prev) => {
      prev.forEach((scene) => URL.revokeObjectURL(scene.previewUrl));
      return [];
    });
    setVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setStatus("");
  }, []);

  const generateVideo = useCallback(async () => {
    if (!ffmpegRef.current) {
      await loadFFmpeg();
    }
    const ffmpeg = ffmpegRef.current;
    if (!ffmpeg) {
      setStatus("المحرك غير جاهز.");
      return;
    }

    if (scenes.length === 0) {
      setStatus("أضف مشاهد بصيغة صور أولاً.");
      return;
    }

    setIsGenerating(true);
    setStatus("جارٍ تجهيز الملفات...");

    try {
      if (!ffmpeg.loaded) {
        setStatus("جارٍ تهيئة المحرك...");
        await ffmpeg.load({
          coreURL: await toBlobURL(`${baseCoreURL}/ffmpeg-core.js`, "text/javascript"),
          wasmURL: await toBlobURL(`${baseCoreURL}/ffmpeg-core.wasm`, "application/wasm"),
          workerURL: await toBlobURL(`${baseCoreURL}/ffmpeg-core.worker.js`, "text/javascript"),
        });
      }

      setStatus("جارٍ كتابة المشاهد...");
      const manifestLines = ["ffconcat version 1.0"];
      const durationPerScene = totalDuration / scenes.length;
      const textEncoder = new TextEncoder();

      for (const [index, scene] of scenes.entries()) {
        const extension = scene.file.type.split("/")[1] || "png";
        const filename = `scene_${String(index).padStart(2, "0")}.${extension}`;
        const data = await fetchFile(scene.file);
        await ffmpeg.writeFile(filename, data);
        manifestLines.push(`file '${filename}'`);
        manifestLines.push(`duration ${durationPerScene.toFixed(3)}`);
      }

      const lastScene = scenes[scenes.length - 1];
      const lastExtension = lastScene.file.type.split("/")[1] || "png";
      const lastFileName = `scene_${String(scenes.length - 1).padStart(2, "0")}.${lastExtension}`;
      manifestLines.push(`file '${lastFileName}'`);
      await ffmpeg.writeFile("inputs.txt", textEncoder.encode(manifestLines.join("\n")));

      try {
        await ffmpeg.deleteFile("output.mp4");
      } catch (error) {
        // ignore if it doesn't exist
      }

      setStatus("جارٍ تركيب الفيديو (قد يستغرق ذلك دقيقة)...");

      await ffmpeg.exec([
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        "inputs.txt",
        "-vf",
        "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "faststart",
        "-r",
        "30",
        "output.mp4",
      ]);

      const output = await ffmpeg.readFile("output.mp4");
      const binary =
        typeof output === "string" ? new TextEncoder().encode(output) : output;
      const videoBlob = new Blob([binary], { type: "video/mp4" });
      const url = URL.createObjectURL(videoBlob);
      setVideoUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
      setStatus("تم إنشاء الفيديو بنجاح!");
    } catch (error) {
      console.error(error);
      setStatus("حدث خطأ أثناء التصدير. حاول مرة أخرى.");
    } finally {
      setIsGenerating(false);
    }
  }, [loadFFmpeg, scenes, totalDuration]);

  const durationLabel = useMemo(() => `${Math.round(totalDuration)} ثانية`, [totalDuration]);

  return (
    <main>
      <h1>صانع الفيديو من المشاهد</h1>
      <p>
        حمّل لقطاتك الثابتة وسيقوم التطبيق بتجميعها تلقائيًا في فيديو مدته ما بين 15 و 20 ثانية مع نسبة عرض 16:9.
      </p>

      <section>
        <label htmlFor="scenes">أضف الصور (PNG, JPG, WEBP)</label>
        <input
          id="scenes"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          onChange={handleFileSelection}
        />
      </section>

      {scenes.length > 0 && (
        <section>
          <div style={{ display: "flex", alignItems: "center", marginTop: "1.8rem" }}>
            <div style={{ flex: 1 }}>
              <label htmlFor="duration">مدة الفيديو</label>
              <input
                id="duration"
                type="range"
                min={MIN_DURATION}
                max={MAX_DURATION}
                step={0.5}
                value={totalDuration}
                onChange={(event) => setTotalDuration(Number(event.target.value))}
              />
            </div>
            <span className="range-value">{durationLabel}</span>
          </div>

          <div className="gallery">
            {scenes.map((scene, index) => (
              <div className="card" key={scene.id}>
                <img src={scene.previewUrl} alt={`Scene ${index + 1}`} />
                <div className="card-footer">
                  <span>مشهد {index + 1}</span>
                  <div className="actions">
                    <button type="button" onClick={() => moveScene(scene.id, -1)} disabled={index === 0}>
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveScene(scene.id, 1)}
                      disabled={index === scenes.length - 1}
                    >
                      ↓
                    </button>
                    <button type="button" onClick={() => removeScene(scene.id)}>
                      حذف
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginTop: "1.5rem" }}>
        <button type="button" onClick={generateVideo} disabled={isGenerating || !isFfmpegReady}>
          {isGenerating ? "جارٍ الإنشاء..." : "إنشاء فيديو"}
        </button>
        <button type="button" onClick={clearAll} disabled={scenes.length === 0}>
          مسح القائمة
        </button>
      </section>

      {status && (
        <div className="status">
          <span>{status}</span>
        </div>
      )}

      {videoUrl && (
        <section>
          <video controls src={videoUrl} preload="auto" />
          <div style={{ marginTop: "0.75rem", display: "flex", gap: "1rem" }}>
            <a
              href={videoUrl}
              download={`scene-video-${Date.now()}.mp4`}
              style={{ textDecoration: "none" }}
            >
              <button type="button">تنزيل الفيديو</button>
            </a>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard
                  .writeText(videoUrl)
                  .then(() => setStatus("تم نسخ رابط الفيديو."))
                  .catch(() => setStatus("تعذر نسخ الرابط تلقائيًا."));
              }}
            >
              نسخ الرابط
            </button>
          </div>
        </section>
      )}

      <footer>يعمل محليًا داخل المتصفح باستخدام FFmpeg WebAssembly.</footer>
    </main>
  );
}
