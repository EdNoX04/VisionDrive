import { plateFormatOptions } from "../lib/plateFormat.js";

export default function SettingsPanel({ settings, setSettings }) {
  const set = (k) => (e) => {
    const v =
      e.target.type === "checkbox" ? e.target.checked : Number(e.target.value);
    setSettings((s) => ({ ...s, [k]: v }));
  };

  return (
    <div className="panel">
      <div className="panel-title">Detection settings</div>

      <label className="field">
        <span>
          Min confidence <b>{Math.round(settings.minScore * 100)}%</b>
        </span>
        <input
          type="range" min="0.2" max="0.9" step="0.05"
          value={settings.minScore} onChange={set("minScore")}
        />
      </label>

      <label className="field">
        <span>
          Calibration <b>{settings.metersPerPixel.toFixed(3)} m/px</b>
        </span>
        <input
          type="range" min="0.005" max="0.3" step="0.005"
          value={settings.metersPerPixel} onChange={set("metersPerPixel")}
        />
        <small className="hint">
          Real-world metres each pixel spans. Raise it if speeds read too low.
        </small>
      </label>

      <label className="field">
        <span>
          Speed limit <b>{settings.speedLimit} km/h</b>
        </span>
        <input
          type="range" min="0" max="160" step="5"
          value={settings.speedLimit} onChange={set("speedLimit")}
        />
        <small className="hint">0 disables over-speed highlighting.</small>
      </label>

      <label className="check">
        <input type="checkbox" checked={settings.ocrEnabled} onChange={set("ocrEnabled")} />
        <span>Number-plate OCR</span>
      </label>

      <label className="check" style={{ marginLeft: 22, opacity: settings.ocrEnabled ? 1 : 0.45 }}>
        <input
          type="checkbox"
          disabled={!settings.ocrEnabled}
          checked={settings.plateLocate}
          onChange={set("plateLocate")}
        />
        <span>Dedicated plate localisation</span>
      </label>

      <label className="field" style={{ marginTop: 4 }}>
        <span>Plate region / format</span>
        <select
          className="input"
          value={settings.plateFormat}
          onChange={(e) => setSettings((s) => ({ ...s, plateFormat: e.target.value }))}
        >
          {plateFormatOptions().map((o) => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
        <small className="hint">
          Auto-corrects OCR confusions (O↔0, I↔1, S↔5…) using the plate structure.
        </small>
      </label>

      {settings.plateFormat !== "none" && (
        <label className="check">
          <input
            type="checkbox"
            checked={settings.requireValidFormat}
            onChange={set("requireValidFormat")}
          />
          <span>Only accept format-valid plates</span>
        </label>
      )}

      <label className="check">
        <input type="checkbox" checked={settings.colorEnabled} onChange={set("colorEnabled")} />
        <span>Colour detection</span>
      </label>
    </div>
  );
}
