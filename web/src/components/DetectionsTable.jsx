function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadDataUrl(dataUrl, name) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = name;
  a.click();
}

export default function DetectionsTable({ records, speedLimit, onReset }) {
  const exportCsv = () => {
    const head = ["Plate", "Type", "Colour", "Speed (km/h)", "Max (km/h)", "Conf %", "First seen", "Last seen"];
    const rows = records.map((r) => [
      r.plate || "—",
      r.class || "—",
      r.color || "—",
      r.speedKmh,
      r.maxSpeed,
      r.score,
      new Date(r.firstSeen).toLocaleTimeString(),
      new Date(r.lastSeen).toLocaleTimeString(),
    ]);
    const csv = [head, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    downloadDataUrl(URL.createObjectURL(blob), `anpr-log-${Date.now()}.csv`);
  };

  // Self-contained HTML evidence report with embedded snapshots.
  const exportReport = () => {
    const rowsHtml = records
      .map((r) => {
        const img = r.plateThumb || r.thumb;
        const over = speedLimit > 0 && r.maxSpeed > speedLimit;
        return `<tr${over ? ' style="background:#fff1f1"' : ""}>
          <td>${img ? `<img src="${img}" alt="evidence"/>` : "—"}</td>
          <td class="mono">${r.plate || "—"}</td>
          <td>${r.class || "—"}</td>
          <td>${r.color || "—"}</td>
          <td>${r.speedKmh}</td>
          <td${over ? ' style="color:#c0392b;font-weight:700"' : ""}>${r.maxSpeed}</td>
          <td>${r.score}%</td>
          <td>${new Date(r.firstSeen).toLocaleString()}</td>
        </tr>`;
      })
      .join("");
    const html = `<!doctype html><html><head><meta charset="utf-8">
<title>VisionDrive — Detection Report</title>
<style>
body{font-family:system-ui,sans-serif;margin:24px;color:#111}
h1{margin:0 0 4px}.sub{color:#666;margin:0 0 18px}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{border:1px solid #ddd;padding:8px;text-align:left;vertical-align:middle}
th{background:#f4f6fb}img{height:46px;border-radius:4px;border:1px solid #ccc}
.mono{font-family:ui-monospace,Menlo,monospace;letter-spacing:.5px}
</style></head><body>
<h1>VisionDrive — Detection Report</h1>
<p class="sub">Generated ${new Date().toLocaleString()} · ${records.length} vehicles · speed limit ${speedLimit || "—"} km/h</p>
<table><thead><tr>
<th>Snapshot</th><th>Plate</th><th>Type</th><th>Colour</th><th>Speed</th><th>Max</th><th>Conf</th><th>First seen</th>
</tr></thead><tbody>${rowsHtml}</tbody></table>
</body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    downloadDataUrl(URL.createObjectURL(blob), `anpr-report-${Date.now()}.html`);
  };

  return (
    <div className="panel table-panel">
      <div className="panel-head">
        <div className="panel-title">Detection log ({records.length})</div>
        <div className="row-gap">
          <button className="btn btn-small" onClick={exportReport} disabled={!records.length}>
            Export report
          </button>
          <button className="btn btn-small" onClick={exportCsv} disabled={!records.length}>
            Export CSV
          </button>
          <button className="btn btn-small btn-ghost" onClick={onReset} disabled={!records.length}>
            Clear
          </button>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Snapshot</th>
              <th>Plate</th>
              <th>Type</th>
              <th>Colour</th>
              <th>Speed</th>
              <th>Max</th>
              <th>Conf</th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 && (
              <tr>
                <td colSpan="7" className="empty">
                  No vehicles logged yet — start a source and press Run.
                </td>
              </tr>
            )}
            {records.map((r) => {
              const over = speedLimit > 0 && r.maxSpeed > speedLimit;
              const img = r.plateThumb || r.thumb;
              return (
                <tr key={r.key} className={over ? "over" : ""}>
                  <td>
                    {img ? (
                      <img
                        className="thumb-img"
                        src={img}
                        alt="evidence"
                        title="Click to download"
                        onClick={() => downloadDataUrl(img, `${(r.plate || "vehicle").replace(/\s/g, "")}-${r.id}.jpg`)}
                      />
                    ) : (
                      <span className="thumb-empty">—</span>
                    )}
                  </td>
                  <td className="mono">{r.plate || "—"}</td>
                  <td>{r.class}</td>
                  <td>
                    {r.color ? (
                      <span className="swatch-cell">
                        <span className="swatch" style={{ background: r.colorHex || "#888" }} />
                        {r.color}
                      </span>
                    ) : "—"}
                  </td>
                  <td>{r.speedKmh}</td>
                  <td className={over ? "over-speed" : ""}>{r.maxSpeed}</td>
                  <td>{r.score}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
