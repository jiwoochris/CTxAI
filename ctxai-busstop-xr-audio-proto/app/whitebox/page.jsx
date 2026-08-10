"use client";

// 화이트박스 테스트 환경 — PlayCanvas 에디터를 거치지 않고,
// 다른 3D 툴에서 나온 GLB를 그대로 웹에서 조립·확인합니다.
//
// react-three-fiber + @react-three/xr — Quest 3 브라우저에서 "Enter VR"로 바로 들어갑니다.
// 배치 좌표는 실제 정류장 레이아웃이 정해지기 전까지의 임시값입니다 (LAYOUT 참고).

import { Component, Suspense, useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { XR, createXRStore } from "@react-three/xr";
import { SLOT_BY_ID } from "../../lib/assetSpec";
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

function Stage({ statuses }) {
  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[3, 4, 2]} intensity={1.3} castShadow />
      <hemisphereLight args={["#8a94a8", "#1a1d24", 0.4]} />

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

export default function WhiteboxPage() {
  const [statuses, setStatuses] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [xrError, setXrError] = useState("");

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
            PlayCanvas 에디터가 아니라 이 페이지에서 조립·확인합니다. 아트 결과물은 어떤 3D 툴에서
            나왔든 GLB로만 주시면 됩니다.
          </p>
        </div>
        <div className={s.actions}>
          <button onClick={enterVr}>Enter VR</button>
          <a className={s.back} href="/">← 대시보드</a>
        </div>
      </header>

      {xrError && <p className={s.err}>{xrError}</p>}

      <div className={s.canvasWrap}>
        <Canvas shadows camera={{ position: [2, 1.6, 2.6], fov: 55 }}>
          <XR store={xrStore}>
            <Stage statuses={statuses} />
            <OrbitControls target={[0, 1, 0]} />
          </XR>
        </Canvas>
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
