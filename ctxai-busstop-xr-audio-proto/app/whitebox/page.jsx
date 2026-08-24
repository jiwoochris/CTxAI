"use client";

// 화이트박스 테스트 환경 — PlayCanvas 에디터를 거치지 않고,
// 다른 3D 툴에서 나온 GLB를 그대로 웹에서 조립·확인합니다.
//
// react-three-fiber + @react-three/xr — Quest 3 브라우저에서 "Enter VR"로 바로 들어갑니다.
// 배치 좌표는 실제 정류장 레이아웃이 정해지기 전까지의 임시값입니다 (LAYOUT 참고).
//
// 조명은 이제 PlayCanvas 에디터 북마크릿(예전 app/tool, public/preset-tool.js — 제거함) 대신
// 여기서 직접 조절·저장합니다. 저장 형식은 그대로 규격/preset/preset.schema.json.

import { useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { XR, createXRStore } from "@react-three/xr";
import { SLOT_BY_ID, PRESETS } from "../../lib/assetSpec";
import AudienceStage, { LAYOUT } from "../../components/AudienceStage";
import HeadPoseTelemetry from "../../components/HeadPoseTelemetry";
import s from "./whitebox.module.css";

const xrStore = createXRStore();

// 안정된 참조로 고정 — Canvas의 camera/gl 설정 로직은 매 렌더마다 재적용되는데,
// 인라인 객체를 주면 매번 새 참조라 gl.shadowMap.type 을 다시 세팅한다(그때마다
// three.js가 사용법 변경 경고를 콘솔에 남김). 머리 포즈 로깅이 ~120ms마다 부모를
// 리렌더하므로 이 경고가 초당 여러 번 반복된다 — 기능상 치명적이진 않지만 불필요한
// 재구성이라 없애 둔다.
const CANVAS_CAMERA = { position: [2, 1.6, 2.6], fov: 55 };
const ORBIT_TARGET = [0, 1, 0];

// ── 조명 기본값 — lp_neutral 출발점. 다른 네 장은 이걸 불러와서 고치는 걸 권장합니다. ──
const DEFAULT_LIGHTS = [
  { name: "Key", type: "directional", color: [1, 0.97, 0.9], intensity: 1.2, position: [3, 4, 2], enabled: true, castShadows: true },
  { name: "Fill", type: "point", color: [0.55, 0.65, 1], intensity: 0.5, position: [-2.5, 1.6, -1], enabled: true },
];
const DEFAULT_SCENE = { ambient: [0.16, 0.16, 0.19], exposure: 1, fogType: "none", fogColor: [0.08, 0.08, 0.1], fogDensity: 0.05 };
const blankPreset = (name) => ({
  presetVersion: "1.0",
  name,
  scene: { ...DEFAULT_SCENE },
  lights: DEFAULT_LIGHTS.map((l) => ({ ...l })),
});

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const toHex = (rgb) =>
  "#" + (rgb ?? [1, 1, 1]).slice(0, 3).map((v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, "0")).join("");
const fromHex = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

// AudienceStage(파노라마·조명·GLB 소품)에 개발자 전용 디버그 요소(격자·바닥·
// 원점 표식)만 얹는다 — 관객용 렌더링 코드는 components/AudienceStage.jsx 하나뿐.
function Stage({ statuses, lighting }) {
  return (
    <>
      <AudienceStage statuses={statuses} lighting={lighting} />

      <gridHelper args={[8, 16, "#3a3f48", "#26292f"]} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[8, 8]} />
        <meshStandardMaterial color="#20232a" />
      </mesh>

      {/* 씬 원점 표식 — 벤치 착석 지점 바닥 */}
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.03, 0.05, 24]} />
        <meshBasicMaterial color="#7fd67f" />
      </mesh>
    </>
  );
}

function LightingPanel({ presetName, setPresetName, lighting, setLighting, onLoad, onSave, msg }) {
  const scene = lighting.scene ?? {};

  function patchScene(patch) {
    setLighting((p) => ({ ...p, scene: { ...p.scene, ...patch } }));
  }
  function patchLight(idx, patch) {
    setLighting((p) => ({ ...p, lights: p.lights.map((l, i) => (i === idx ? { ...l, ...patch } : l)) }));
  }

  return (
    <aside className={s.panel}>
      <h2>조명 프리셋</h2>
      <div className={s.presetRow}>
        <select value={presetName} onChange={(e) => setPresetName(e.target.value)}>
          {PRESETS.map((p) => (
            <option key={p.name} value={p.name}>{p.label} — {p.name}</option>
          ))}
        </select>
      </div>
      <div className={s.presetBtns}>
        <button onClick={onLoad}>📂 불러오기</button>
        <button onClick={onSave}>💾 저장</button>
      </div>
      {msg && <p className={s.msg}>{msg}</p>}

      <div className={s.field}>
        <label>환경광</label>
        <input type="color" value={toHex(scene.ambient)} onChange={(e) => patchScene({ ambient: fromHex(e.target.value) })} />
      </div>
      <div className={s.field}>
        <label>노출 {(scene.exposure ?? 1).toFixed(2)}</label>
        <input type="range" min="0.2" max="2.5" step="0.05" value={scene.exposure ?? 1}
          onChange={(e) => patchScene({ exposure: Number(e.target.value) })} />
      </div>
      <div className={s.field}>
        <label>
          <input type="checkbox" checked={scene.fogType === "exp2"}
            onChange={(e) => patchScene({ fogType: e.target.checked ? "exp2" : "none" })} />
          {" "}안개
        </label>
        {scene.fogType === "exp2" && (
          <>
            <input type="color" value={toHex(scene.fogColor)} onChange={(e) => patchScene({ fogColor: fromHex(e.target.value) })} />
            <input type="range" min="0" max="0.3" step="0.01" value={scene.fogDensity ?? 0.05}
              onChange={(e) => patchScene({ fogDensity: Number(e.target.value) })} />
          </>
        )}
      </div>

      {(lighting.lights ?? []).map((L, i) => (
        <div key={L.name} className={s.lightBlock}>
          <div className={s.field}>
            <label>
              <input type="checkbox" checked={L.enabled !== false} onChange={(e) => patchLight(i, { enabled: e.target.checked })} />
              {" "}<b>{L.name}</b> <span className={s.dimSpan}>{L.type}</span>
            </label>
          </div>
          <div className={s.field}>
            <input type="color" value={toHex(L.color)} onChange={(e) => patchLight(i, { color: fromHex(e.target.value) })} />
            <input type="range" min="0" max="3" step="0.05" value={L.intensity ?? 1}
              onChange={(e) => patchLight(i, { intensity: Number(e.target.value) })} />
            <span className={s.dimSpan}>{(L.intensity ?? 1).toFixed(2)}</span>
          </div>
        </div>
      ))}

      <p className={s.note}>
        여기서 만지는 값이 곧 저장 형식(<code>규격/preset/preset.schema.json</code>)입니다.
        나머지 4장은 <code>lp_neutral</code>을 불러와 출발점으로 삼는 걸 권합니다.
      </p>
    </aside>
  );
}

function fmt(n, digits = 1) {
  return typeof n === "number" && Number.isFinite(n) ? n.toFixed(digits) : "—";
}

function HeadPoseLogPanel({ thresholdDeg, setThresholdDeg, onReset, live, recording, toggleRecording, downloadCsv, sampleCount }) {
  return (
    <section className={s.legend}>
      <h2>머리 포즈 로깅 — 행동 판정 파일럿 테스트용</h2>
      <p className={s.dim}>
        Enter VR로 헤드셋을 쓰고 각 사건을 볼 때 각도가 어떻게 움직이는지 관찰합니다.
        임계값은 아직 코딩하지 않았습니다 — 여기서 숫자를 먼저 보고 v2.md §2 값을 검증합니다.
      </p>
      <div className={s.field}>
        <label>기준선 편차 임계값 {thresholdDeg}°</label>
        <input type="range" min="4" max="40" step="1" value={thresholdDeg}
          onChange={(e) => setThresholdDeg(Number(e.target.value))} />
      </div>
      <div className={s.presetBtns}>
        <button onClick={onReset}>🎯 기준점 재설정</button>
        <button onClick={toggleRecording}>{recording ? "⏹ 기록 정지" : "⏺ 기록 시작"}</button>
        <button onClick={downloadCsv} disabled={!sampleCount}>⬇ CSV 다운로드</button>
      </div>
      {live ? (
        <ul className={s.list}>
          <li><b>편차 (yaw / pitch)</b><span>{fmt(live.dYaw)}° / {fmt(live.dPitch)}°</span></li>
          <li><b>편차 크기 · 최대</b><span>{fmt(live.mag)}° · {fmt(live.maxMagDeg)}°</span></li>
          <li><b>임계값 초과 중</b><span>{live.above ? `예 (${fmt(live.aboveSec)}s)` : "아니오"}</span></li>
          <li><b>최장 지속 반응</b><span>{fmt(live.maxAboveSec)}s</span></li>
          <li><b>가장 최근 회복 시간</b><span>{live.recoveryMs != null ? `${live.recoveryMs}ms` : "—"}</span></li>
          <li><b>기준선 재통과 횟수</b><span>{live.reversals}</span></li>
        </ul>
      ) : (
        <p className={s.dim}>Canvas가 준비되면 숫자가 나타납니다 — OrbitControls로 드래그해서 먼저 확인해 보세요.</p>
      )}
      {recording && <p className={s.msg}>기록 중 — {sampleCount}개 샘플</p>}
    </section>
  );
}

export default function WhiteboxPage() {
  const [statuses, setStatuses] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [xrError, setXrError] = useState("");
  const [presetName, setPresetName] = useState("lp_neutral");
  const [lighting, setLighting] = useState(() => blankPreset("lp_neutral"));
  const [presetMsg, setPresetMsg] = useState("");

  // 머리 포즈 로깅 (행동 판정 파일럿 테스트용)
  const [poseThresholdDeg, setPoseThresholdDeg] = useState(12);
  const [poseResetSignal, setPoseResetSignal] = useState(0);
  const [poseLive, setPoseLive] = useState(null);
  const [poseRecording, setPoseRecording] = useState(false);
  const poseRecordingRef = useRef(false);
  const poseBufferRef = useRef([]);
  const [poseSampleCount, setPoseSampleCount] = useState(0);

  function togglePoseRecording() {
    setPoseRecording((v) => {
      const next = !v;
      poseRecordingRef.current = next;
      if (next) { poseBufferRef.current = []; setPoseSampleCount(0); }
      return next;
    });
  }

  function handlePoseSample(sample) {
    setPoseLive(sample);
    if (poseRecordingRef.current) {
      poseBufferRef.current.push(sample);
      setPoseSampleCount(poseBufferRef.current.length);
    }
  }

  function downloadPoseCsv() {
    const rows = poseBufferRef.current;
    if (!rows.length) return;
    const header = "t,yaw,pitch,dYaw,dPitch,mag,above,aboveSec,maxAboveSec,maxMagDeg,reversals,recoveryMs\n";
    const body = rows
      .map((r) => [r.t, r.yaw.toFixed(2), r.pitch.toFixed(2), r.dYaw.toFixed(2), r.dPitch.toFixed(2), r.mag.toFixed(2),
        r.above ? 1 : 0, r.aboveSec.toFixed(2), r.maxAboveSec.toFixed(2), r.maxMagDeg.toFixed(2), r.reversals, r.recoveryMs ?? ""].join(","))
      .join("\n");
    const blob = new Blob([header + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `headpose_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    fetch("/api/manifest")
      .then((r) => r.json())
      .then((m) => {
        const map = {};
        for (const item of m.models?.structure ?? []) map[`structure.${item.id}`] = item;
        if (m.models?.sign?.model) map["sign.model"] = m.models.sign.model;
        if (m.models?.background?.panorama) map["bg.panorama"] = m.models.background.panorama;
        setStatuses(map);
      })
      .catch(() => setStatuses({}))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    loadPreset("lp_neutral");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadPreset(name) {
    setPresetMsg("");
    try {
      const res = await fetch(`/api/preset?name=${name}`);
      const data = await res.json();
      if (data.ok) {
        setLighting(data.preset);
        setPresetMsg(`"${name}" 불러왔습니다 (조명 ${data.preset.lights?.length ?? 0}개)`);
      } else {
        setLighting(blankPreset(name));
        setPresetMsg(`"${name}"은 아직 저장된 게 없어 기본값으로 시작합니다`);
      }
    } catch (e) {
      setPresetMsg("불러오기 실패 — 서버 연결을 확인해 주세요");
    }
  }

  async function savePreset() {
    setPresetMsg("");
    try {
      const res = await fetch("/api/preset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...lighting, name: presetName }),
      });
      const data = await res.json();
      setPresetMsg(data.ok ? `"${presetName}" 저장했습니다 (조명 ${data.lights}개)` : (data.error || "저장 실패"));
    } catch (e) {
      setPresetMsg("저장 실패 — 서버 연결을 확인해 주세요");
    }
  }

  async function enterVr() {
    setXrError("");
    try {
      await xrStore.enterVR();
    } catch (e) {
      setXrError("VR 진입에 실패했습니다 — 이 기기/브라우저가 WebXR을 지원하는지 확인해 주세요.");
    }
  }

  return (
    <main className={s.wrap}>
      <header className={s.head}>
        <div>
          <h1>화이트박스 — 테스트 환경</h1>
          <p className={s.dim}>
            PlayCanvas 에디터가 아니라 이 페이지에서 조립·확인·조명 조절을 다 합니다. 아트 결과물은
            어떤 3D 툴에서 나왔든 GLB로만 주시면 됩니다.
          </p>
        </div>
        <div className={s.actions}>
          <button onClick={enterVr}>Enter VR</button>
          <a className={s.back} href="/">← 대시보드</a>
        </div>
      </header>

      {xrError && <p className={s.err}>{xrError}</p>}

      <div className={s.layout}>
        <div className={s.canvasWrap}>
          <Canvas shadows camera={CANVAS_CAMERA}>
            <XR store={xrStore}>
              <Stage statuses={statuses} lighting={lighting} />
              <OrbitControls target={ORBIT_TARGET} />
              <HeadPoseTelemetry thresholdDeg={poseThresholdDeg} resetSignal={poseResetSignal} onSample={handlePoseSample} />
            </XR>
          </Canvas>
        </div>

        <LightingPanel
          presetName={presetName}
          setPresetName={(name) => { setPresetName(name); loadPreset(name); }}
          lighting={lighting}
          setLighting={setLighting}
          onLoad={() => loadPreset(presetName)}
          onSave={savePreset}
          msg={presetMsg}
        />
      </div>

      <HeadPoseLogPanel
        thresholdDeg={poseThresholdDeg}
        setThresholdDeg={setPoseThresholdDeg}
        onReset={() => setPoseResetSignal((n) => n + 1)}
        live={poseLive}
        recording={poseRecording}
        toggleRecording={togglePoseRecording}
        downloadCsv={downloadPoseCsv}
        sampleCount={poseSampleCount}
      />

      <section className={s.legend}>
        <h2>표시된 자리 {loaded ? "" : "— 불러오는 중…"}</h2>
        <ul className={s.list}>
          {["bg.panorama", ...LAYOUT.map((l) => l.slotId)].map((slotId) => {
            const slot = SLOT_BY_ID[slotId];
            const status = statuses[slotId]?.status ?? "missing";
            return (
              <li key={slotId} className={s[`s_${status}`] ?? s.s_missing}>
                <b>{slot?.label ?? slotId}</b>
                <span>{status}</span>
              </li>
            );
          })}
        </ul>
        <p className={s.note}>
          위치는 임시 배치입니다 — 실제 정류장 레이아웃이 정해지면{" "}
          <code>app/whitebox/page.jsx</code>의 <code>LAYOUT</code>만 바꾸면 됩니다.
          회색/갈색 상자는 아직 없거나 못 불러온 자리입니다. 배경 파노라마가 없으면
          같은 색의 갈색 격자 구(球)가 사방을 둘러쌉니다 — 카메라를 드래그해서 돌려보면
          어디서든 보입니다. 파노라마가 올라오면 이 격자 대신 실제 그림으로 바뀝니다.
        </p>
      </section>
    </main>
  );
}
