import { useRef, useState } from "react";

const TABS = [
  { key: "webcam", label: "Webcam" },
  { key: "file", label: "Upload video" },
  { key: "stream", label: "Live stream" },
];

export default function SourcePanel({ active, onWebcam, onFile, onStream, onStop }) {
  const [tab, setTab] = useState("webcam");
  const [url, setUrl] = useState("");
  const fileInput = useRef(null);

  return (
    <div className="panel">
      <div className="panel-title">Video source</div>

      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`tab ${tab === t.key ? "tab-active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "webcam" && (
        <div className="source-body">
          <p className="hint">Use a connected camera or phone as a live feed.</p>
          <button className="btn btn-primary" onClick={onWebcam}>
            Start webcam
          </button>
        </div>
      )}

      {tab === "file" && (
        <div className="source-body">
          <p className="hint">Process a pre-recorded clip (mp4, webm, mov).</p>
          <input
            ref={fileInput}
            type="file"
            accept="video/*"
            hidden
            onChange={(e) => e.target.files[0] && onFile(e.target.files[0])}
          />
          <button className="btn btn-primary" onClick={() => fileInput.current.click()}>
            Choose video file
          </button>
        </div>
      )}

      {tab === "stream" && (
        <div className="source-body">
          <p className="hint">
            HLS (<code>.m3u8</code>) or MJPEG URL from an IP camera / CCTV gateway.
          </p>
          <input
            className="input"
            placeholder="https://camera.example/stream.m3u8"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button
            className="btn btn-primary"
            disabled={!url.trim()}
            onClick={() => onStream(url.trim())}
          >
            Connect stream
          </button>
          <details className="rtsp-note">
            <summary>Connecting an RTSP CCTV camera?</summary>
            <p>
              Browsers cannot play RTSP directly. Run a small gateway to convert
              RTSP → HLS, e.g.{" "}
              <code>
                ffmpeg -i rtsp://CAM_IP/stream -c:v libx264 -f hls out.m3u8
              </code>{" "}
              (or use <code>MediaMTX</code>), then paste the resulting{" "}
              <code>.m3u8</code> URL above.
            </p>
          </details>
        </div>
      )}

      {active && (
        <button className="btn btn-ghost" onClick={onStop}>
          Disconnect source
        </button>
      )}
    </div>
  );
}
