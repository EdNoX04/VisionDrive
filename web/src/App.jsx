import { useCallback, useRef, useState } from "react";
import Hls from "hls.js";
import { useAnpr } from "./hooks/useAnpr.js";
import SourcePanel from "./components/SourcePanel.jsx";
import SettingsPanel from "./components/SettingsPanel.jsx";
import ModelPanel from "./components/ModelPanel.jsx";
import StatsBar from "./components/StatsBar.jsx";
import DetectionsTable from "./components/DetectionsTable.jsx";

const DEFAULT_SETTINGS = {
  minScore: 0.45,
  metersPerPixel: 0.05,
  speedLimit: 60,
  ocrEnabled: true,
  plateLocate: true,
  useYoloPlate: false,
  plateFormat: "none",
  requireValidFormat: true,
  colorEnabled: true,
  ocrIntervalMs: 1500,
  ocrMinConfidence: 55,
  targetFps: 15,
};

export default function App() {
  const videoRef = useRef(null);
  const overlayRef = useRef(null);
  const hlsRef = useRef(null);
  const streamRef = useRef(null);

  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [hasSource, setHasSource] = useState(false);
  const [sourceLabel, setSourceLabel] = useState("");
  const [sourceError, setSourceError] = useState("");

  const { modelReady, status, running, tracks, records, fps, start, stop, resetRecords } =
    useAnpr({ videoRef, overlayRef, settings });

  const teardownSource = useCallback(() => {
    const v = videoRef.current;
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (v) {
      v.pause();
      v.removeAttribute("src");
      v.srcObject = null;
      v.load();
    }
  }, []);

  const stopAll = useCallback(() => {
    stop();
    teardownSource();
    setHasSource(false);
    setSourceLabel("");
    setSourceError("");
  }, [stop, teardownSource]);

  const startWebcam = useCallback(async () => {
    setSourceError("");
    teardownSource();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      const v = videoRef.current;
      v.srcObject = stream;
      v.muted = true;
      await v.play();
      setHasSource(true);
      setSourceLabel("Webcam");
      start();
    } catch (e) {
      setSourceError("Could not access camera. Check browser permissions.");
    }
  }, [start, teardownSource]);

  const startFile = useCallback(
    async (file) => {
      setSourceError("");
      teardownSource();
      const v = videoRef.current;
      v.src = URL.createObjectURL(file);
      v.loop = true;
      v.muted = true;
      try {
        await v.play();
        setHasSource(true);
        setSourceLabel(file.name);
        start();
      } catch (e) {
        setSourceError("Could not play this video file.");
      }
    },
    [start, teardownSource]
  );

  const startSample = useCallback(async () => {
    setSourceError("");
    teardownSource();
    const v = videoRef.current;
    v.src = `${import.meta.env.BASE_URL}sample.mp4`;
    v.loop = true;
    v.muted = true;
    const missing = () =>
      setSourceError(
        "No sample found. Run tools/fetch_sample_video.sh to add web/public/sample.mp4."
      );
    v.onerror = missing;
    try {
      await v.play();
      setHasSource(true);
      setSourceLabel("Sample traffic video");
      start();
    } catch (e) {
      missing();
    }
  }, [start, teardownSource]);

  const startStream = useCallback(
    async (url) => {
      setSourceError("");
      teardownSource();
      const v = videoRef.current;
      v.muted = true;
      const isHls = /\.m3u8(\?|$)/i.test(url);
      try {
        if (isHls && Hls.isSupported()) {
          const hls = new Hls({ lowLatencyMode: true });
          hlsRef.current = hls;
          hls.loadSource(url);
          hls.attachMedia(v);
          hls.on(Hls.Events.MANIFEST_PARSED, () => v.play());
          hls.on(Hls.Events.ERROR, (_e, data) => {
            if (data.fatal) setSourceError("Stream error: " + data.type);
          });
        } else {
          // Native HLS (Safari) or direct MJPEG/MP4 URL.
          v.src = url;
          await v.play();
        }
        setHasSource(true);
        setSourceLabel(url);
        start();
      } catch (e) {
        setSourceError("Could not connect to the stream URL.");
      }
    },
    [start, teardownSource]
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo-dot" />
          <div>
            <h1>Speed Vision</h1>
            <p>ANPR · vehicle detection, plate OCR, speed &amp; colour</p>
          </div>
        </div>
        <div className="status-chip" data-on={running}>
          <span className="dot" />
          {modelReady ? status : "Loading model…"}
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <SourcePanel
            active={hasSource}
            onWebcam={startWebcam}
            onFile={startFile}
            onStream={startStream}
            onSample={startSample}
            onStop={stopAll}
          />
          <SettingsPanel settings={settings} setSettings={setSettings} />
          <ModelPanel settings={settings} setSettings={setSettings} />
        </aside>

        <main className="main">
          <StatsBar tracks={tracks} records={records} fps={fps} running={running} />

          <div className="stage">
            <video ref={videoRef} playsInline className="video" />
            <canvas ref={overlayRef} className="overlay" />
            {!hasSource && (
              <div className="stage-empty">
                <div className="stage-empty-inner">
                  <h3>Choose a video source to begin</h3>
                  <p>Webcam, an uploaded clip, or a live HLS/MJPEG stream.</p>
                  {!modelReady && <p className="loading">Loading detection model…</p>}
                </div>
              </div>
            )}
            {sourceError && <div className="banner error">{sourceError}</div>}
          </div>

          <div className="controls">
            <button
              className="btn btn-primary"
              disabled={!hasSource || !modelReady}
              onClick={running ? stop : start}
            >
              {running ? "Pause" : "Run"}
            </button>
            {sourceLabel && <span className="src-label">Source: {sourceLabel}</span>}
          </div>

          <DetectionsTable
            records={records}
            speedLimit={settings.speedLimit}
            onReset={resetRecords}
          />
        </main>
      </div>

      <footer className="foot">
        Runs fully in your browser — TensorFlow.js (COCO-SSD) · Tesseract.js OCR ·
        canvas colour analysis. No video leaves your device.
      </footer>
    </div>
  );
}
