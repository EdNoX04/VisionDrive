export default function StatsBar({ tracks, records, fps, running }) {
  const liveCount = tracks.length;
  const plates = records.filter((r) => r.plate).length;
  const maxSpeed = records.reduce((m, r) => Math.max(m, r.maxSpeed || 0), 0);
  const avgSpeed = tracks.length
    ? Math.round(tracks.reduce((s, t) => s + t.speedKmh, 0) / tracks.length)
    : 0;

  const items = [
    { label: "Vehicles in frame", value: liveCount },
    { label: "Unique tracked", value: records.length },
    { label: "Plates read", value: plates },
    { label: "Avg speed", value: `${avgSpeed} km/h` },
    { label: "Top speed", value: `${maxSpeed} km/h` },
    { label: "Pipeline FPS", value: running ? fps : "—" },
  ];

  return (
    <div className="stats">
      {items.map((it) => (
        <div className="stat" key={it.label}>
          <div className="stat-value">{it.value}</div>
          <div className="stat-label">{it.label}</div>
        </div>
      ))}
    </div>
  );
}
