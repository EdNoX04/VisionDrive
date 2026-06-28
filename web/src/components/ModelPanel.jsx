import { useState } from "react";
import { loadPlateModel, unloadPlateModel } from "../lib/plateModel.js";

export default function ModelPanel({ settings, setSettings }) {
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState("auto");
  const [state, setState] = useState("idle"); // idle | loading | ready | error
  const [msg, setMsg] = useState("");

  const load = async () => {
    if (!url.trim()) return;
    setState("loading");
    setMsg("Loading model…");
    const ok = await loadPlateModel(url.trim(), { format });
    if (ok) {
      setState("ready");
      setMsg("Model ready");
      setSettings((s) => ({ ...s, useYoloPlate: true }));
    } else {
      setState("error");
      setMsg("Failed to load — check the URL/CORS and that it's a TF.js model.json");
      setSettings((s) => ({ ...s, useYoloPlate: false }));
    }
  };

  const unload = () => {
    unloadPlateModel();
    setState("idle");
    setMsg("");
    setSettings((s) => ({ ...s, useYoloPlate: false }));
  };

  return (
    <div className="panel">
      <div className="panel-title">YOLO plate model (optional)</div>
      <p className="hint">
        Load a YOLOv5/YOLOv8 licence-plate model exported to TF.js. Falls back to
        built-in CV detection when off. See <code>/training</code> to train one.
      </p>

      <input
        className="input"
        placeholder="https://…/web_model/model.json"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />

      <label className="field" style={{ marginTop: 10 }}>
        <span>Export format</span>
        <select className="input" value={format} onChange={(e) => setFormat(e.target.value)}>
          <option value="auto">Auto-detect</option>
          <option value="v8">YOLOv8 (no objectness)</option>
          <option value="v5">YOLOv5 (with objectness)</option>
        </select>
      </label>

      <div className="row-gap" style={{ marginTop: 10 }}>
        <button className="btn btn-primary" disabled={!url.trim() || state === "loading"} onClick={load}>
          {state === "loading" ? "Loading…" : "Load model"}
        </button>
        {state === "ready" && (
          <button className="btn btn-ghost" onClick={unload}>Unload</button>
        )}
      </div>

      {state === "ready" && (
        <label className="check" style={{ marginTop: 12 }}>
          <input
            type="checkbox"
            checked={settings.useYoloPlate}
            onChange={(e) => setSettings((s) => ({ ...s, useYoloPlate: e.target.checked }))}
          />
          <span>Use YOLO model for plates</span>
        </label>
      )}

      {msg && (
        <div className={`model-msg ${state}`}>{msg}</div>
      )}
    </div>
  );
}
