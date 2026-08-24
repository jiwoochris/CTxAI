"use client";

// 관객용 3D 씬 — app/whitebox의 Stage에서 개발자 전용 요소(격자·바닥·원점 표식·
// 조명 편집 패널)를 뺀 부분만 뗀 것. 파노라마 배경 + 조명 + GLB 소품만 그린다.
//
// /whitebox(개발용, 이 컴포넌트 위에 디버그 요소를 더 얹음)와 /story-vr(관객용,
// 이 컴포넌트를 그대로 씀) 둘 다 여기서 가져다 쓴다 — 3D 렌더링 코드를
// 두 곳에 중복시키지 않으려는 목적.

import { Component, Suspense, useEffect } from "react";
import { useGLTF } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import Panorama from "./Panorama";

// 씬 원점 = 벤치 착석 지점 바닥 (0,0,0) — Bus/규격/명명규칙.md §3.
// 나머지 위치는 실제 정류장 레이아웃이 정해지기 전까지의 임시값이다.
export const LAYOUT = [
  { slotId: "structure.bench", position: [0, 0, 0], rotation: [0, 0, 0] },
  { slotId: "structure.shelter", position: [0, 0, -0.7], rotation: [0, 0, 0] },
  { slotId: "structure.silhouette", position: [0.65, 0, 0.05], rotation: [0, -0.3, 0] },
  { slotId: "sign.model", position: [1.4, 0, -0.5], rotation: [0, -0.5, 0] },
];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const toHex = (rgb) =>
  "#" + (rgb ?? [1, 1, 1]).slice(0, 3).map((v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, "0")).join("");

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
      <meshStandardMaterial color={tone === "loading" ? "#565d68" : "#8a6a3a"} wireframe />
    </mesh>
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

export default function AudienceStage({ statuses, lighting }) {
  const scene = lighting?.scene ?? {};
  const hasPanorama = statuses?.["bg.panorama"]?.status && statuses["bg.panorama"].status !== "missing";

  return (
    <>
      <Panorama hasAsset={hasPanorama} />
      <ExposureSync value={scene.exposure} />
      <ambientLight color={toHex(scene.ambient)} intensity={1} />
      {scene.fogType === "exp2" && (
        <fogExp2 attach="fog" args={[toHex(scene.fogColor), scene.fogDensity ?? 0.05]} />
      )}

      {(lighting?.lights ?? []).map((L) =>
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

      {LAYOUT.map(({ slotId, position, rotation }) => (
        <group key={slotId} position={position} rotation={rotation}>
          <SlotModel slotId={slotId} hasAsset={statuses?.[slotId]?.status && statuses[slotId].status !== "missing"} />
        </group>
      ))}
    </>
  );
}
