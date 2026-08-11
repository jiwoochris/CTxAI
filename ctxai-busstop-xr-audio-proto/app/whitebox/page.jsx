"use client";

// 화이트박스 테스트 환경 — PlayCanvas 에디터를 거치지 않고,
// 다른 3D 툴에서 나온 GLB를 그대로 웹에서 조립·확인합니다.
//
// react-three-fiber + @react-three/xr — Quest 3 브라우저에서 "Enter VR"로 바로 들어갑니다.
// 배치 좌표는 실제 정류장 레이아웃이 정해지기 전까지의 임시값입니다 (LAYOUT 참고).
//
// 조명은 이제 PlayCanvas 에디터 북마크릿(app/tool) 대신 여기서 직접 조절·저장합니다.
// 저장 형식은 그대로 규격/preset/preset.schema.json — /api/preset 은 손대지 않았습니다.

import { Component, Suspense, useEffect, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { XR, createXRStore } from "@react-three/xr";
import { SLOT_BY_ID, PRESETS } from "../../lib/assetSpec";
import s from "./whitebox.module.css";

const xrStore = createXRStore();

// 씬 원점 = 벤치 착석 지점 바닥 (0,0,0) — 명명규칙.md §3.
// 나머지 위치는 아직 정해지지 않아 QA용 임시 배치입니다.
const LAYOUT = [
  { slotId: "structure.bench", position: [0, 0, 0], rotation: [0, 0, 0] },
  { slotId: "structure.shelter", position: [0, 0, -0.7], rotation: [0, 0, 0] },
  { slotId: "structure.silhouette", position: [0.65, 0, 0.05], rotation: [0, -0.3, 0] },
  { slotId: "sign.model", position: [1.4, 0, -0.5], rotation: [0, -0.5, 0] },
];

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

class ModelErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function Model({ slotId }) {
  const { scene } = useGLTF(`/api/assets/file/${slotId}`);
  return <primitive object={scene} />;
}

function Placeholder({ tone = "missing" }) {
  return (
    <mesh position={[0, 0.75, 0]}>
      <boxGeometry args={[0.5, 1.5, 0.5]} />
      <meshStandardMaterial
        color={tone === "loading" ? "#565d68" : "#8a6a3a"}
        wireframe
      />
    </mesh>
  );
}

function SlotModel({ slotId, hasAsset }) {
  if (!hasAsset) return <Placeholder tone="missing" />;
  return (
    <ModelErrorBoundary fallback={<Placeholder tone="missing" />}>
      <Suspense fallback={<Placeholder tone="loading" />}>
        <Model slotId={slotId} />
      </Suspense>
    </ModelErrorBoundary>
  );
}

// Canvas 밖의 React state(exposure)를 three.js 렌더러에 반영 — gl은 useThree로만 얻을 수 있다.
function ExposureSync({ value }) {
  const { gl } = useThree();
  useEffect(() => {
    gl.toneMappingExposure = value ?? 1;
  }, [gl, value]);
  return null;
}

function Stage({ statuses, lighting }) {
  const scene = lighting.scene ?? {};
  return (
    <>
      <ExposureSync value={scene.exposure} />
      <ambientLight color={toHex(scene.ambient)} intensity={1} />
      {scene.fogType === "exp2" && (
        <fogExp2 attach="fog" args={[toHex(scene.fogColor), scene.fogDensity ?? 0.05]} />
      )}

      {(lighting.lights ?? []).map((L) =>
        L.enabled === false ? null : L.type === "point" ? (
          <pointLight key={L.name} position={L.position ?? [0, 2, 0]} color={toHex(L.color)} intensity={L.intensity ?? 1} />
        ) : (
          <directionalLight
            key={L.name}
            position={L.position ?? [3, 4, 2]}
            color={toHex(L.color)}
            intensity={L.intensity ?? 1}
            castShadow={!!L.castShadows}
          />
        )
      )}

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

      {LAYOUT.map(({ slotId, position, rotation }) => (
        <group key={slotId} position={position} rotation={rotation}>
          <SlotModel slotId={slotId} hasAsset={statuses[slotId]?.status && statuses[slotId].status !== "missing"} />
        </group>
      ))}
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

export default function WhiteboxPage() {
  const [statuses, setStatuses] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [xrError, setXrError] = useState("");
  const [presetName, setPresetName] = useState("lp_neutral");
  const [lighting, setLighting] = useState(() => blankPreset("lp_neutral"));
  const [presetMsg, setPresetMsg] = useState("");

  useEffect(() => {
    fetch("/api/manifest")
      .then((r) => r.json())
      .then((m) => {
        const map = {};
        for (const item of m.models?.structure ?? []) map[`structure.${item.id}`] = item;
        if (m.models?.sign?.model) map["sign.model"] = m.models.sign.model;
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
          <Canvas shadows camera={{ position: [2, 1.6, 2.6], fov: 55 }}>
            <XR store={xrStore}>
              <Stage statuses={statuses} lighting={lighting} />
              <OrbitControls target={[0, 1, 0]} />
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

      <section className={s.legend}>
        <h2>표시된 자리 {loaded ? "" : "— 불러오는 중…"}</h2>
        <ul className={s.list}>
          {LAYOUT.map(({ slotId }) => {
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
          회색/갈색 상자는 아직 없거나 못 불러온 자리입니다.
        </p>
      </section>
    </main>
  );
}
