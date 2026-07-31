"use client";

export default function SeatSelector({ tracks, currentId, onSelect }) {
  return (
    <div className="seats">
      {tracks.map((t) => (
        <div
          key={t.id}
          className={`seat ${t.id === currentId ? "active" : ""}`}
          style={{ "--accent-color": t.color }}
          onClick={() => onSelect(t.id)}
        >
          <div className="dot" style={{ background: t.color }}></div>
          <div className="genre">{t.genre}</div>
          <div className="emo">{t.emo}</div>
          <div className="pos">{t.pos}</div>
        </div>
      ))}
    </div>
  );
}
