"use client";

export default function TrackInfoPanel({ track }) {
  return (
    <div className="panel" style={{ "--accent-color": track.color }}>
      <div className="tag">
        {track.pos} · 핵심감정 &quot;{track.emo}&quot;
      </div>
      <h2>{track.genre}</h2>
      <div className="grid2">
        <div className="info-block">
          <span className="label">배경</span>
          {track.bg}
        </div>
        <div className="info-block">
          <span className="label">조명·색</span>
          {track.light}
        </div>
        <div className="info-block">
          <span className="label">정류장 상태</span>
          {track.state}
        </div>
        <div className="info-block">
          <span className="label">사운드 톤</span>
          {track.sound}
        </div>
      </div>
    </div>
  );
}
