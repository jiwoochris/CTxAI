"use client";

// 360도 파노라마 배경 — 정류장 배경을 GLB 모델링 대신 그림 한 장(equirectangular
// 파노라마)으로 받아 3D 씬을 감싸는 구 안쪽 면에 입힙니다.
//
// 왜: 정류장_스크립트_v2.md §1의 사건들은 관객 주변 여러 방위(오른쪽 유리·왼쪽 전방·
// 정면·뒤 45도 등)에서 벌어져 360도 배경이 필요한데, 도로·카페·숲 전체를 GLB로
// 모델링하는 건 8월 시연 일정에 비해 큽니다. 아트가 그림 한 장만 그리면 코드가
// 구에 입혀 3D처럼 보이게 합니다 — 움직이는 소품(트럭·고양이 등)만 실제 GLB로 섞습니다.
//
// 슬롯: lib/assetSpec.js 의 "bg.panorama" (Bus/규격/명명규칙.md §2.4).

import { Component, Suspense } from "react";
import { useTexture } from "@react-three/drei";
import { BackSide, SRGBColorSpace } from "three";

const RADIUS = 60; // 씬 반경 8m 그리드보다 훨씬 크게 — 안쪽에서 절대 벽에 닿지 않게

function PanoramaSphere({ url }) {
  const texture = useTexture(url);
  texture.colorSpace = SRGBColorSpace;
  return (
    <mesh scale={[-1, 1, 1]} rotation={[0, Math.PI / 2, 0]}>
      <sphereGeometry args={[RADIUS, 64, 40]} />
      <meshBasicMaterial map={texture} side={BackSide} toneMapped={false} />
    </mesh>
  );
}

// 그림이 아직 없을 때 — 회색 상자와 같은 역할의 "빈 배경". 완전한 무지보다
// 하늘/바닥이 어렴풋이 구분되는 그라디언트 쪽이 조명 확인에 방해가 덜 됩니다.
function PanoramaPlaceholder() {
  return (
    <mesh scale={[-1, 1, 1]}>
      <sphereGeometry args={[RADIUS, 16, 12]} />
      <meshBasicMaterial color="#1b1d22" side={BackSide} fog={false} />
    </mesh>
  );
}

class PanoramaErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <PanoramaPlaceholder /> : this.props.children;
  }
}

export default function Panorama({ hasAsset, url = "/api/assets/file/bg.panorama" }) {
  if (!hasAsset) return <PanoramaPlaceholder />;
  return (
    <PanoramaErrorBoundary>
      <Suspense fallback={<PanoramaPlaceholder />}>
        <PanoramaSphere url={url} />
      </Suspense>
    </PanoramaErrorBoundary>
  );
}
