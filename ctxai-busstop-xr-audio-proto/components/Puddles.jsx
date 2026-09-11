"use client";
// 물웅덩이 — 소나기 뒤 정류장 앞 차선에 고인 물.
// 이전에는 원 하나(밝은 회색 타원)였다. 여기서는 불규칙한 윤곽(알파 마스크) 안에서만 장면을 거울처럼 비추는
// 반사 재질을 쓰고, 둘레에는 젖어서 어두워진 아스팔트 띠를 둔다. 반사는 장면을 한 번 더 그리므로
// 웅덩이 전부를 한 장의 평면(마스크 하나)으로 처리해 추가 패스는 한 번뿐이다. XR 에서는 반사 없이 어두운 물리 재질.
import { useMemo } from "react";
import { MeshReflectorMaterial } from "@react-three/drei";
import { CanvasTexture, LinearFilter, RepeatWrapping } from "three";

const CX = 0.6, CZ = -4.6, W = 10, H = 3.6; // 평면 중심·크기(m) — 연석(z≈-3) 앞 차선을 덮는다
const PX = 1024 / W; // 픽셀/미터

// 웅덩이 자리 — 첫 번째는 트럭이 밟는 자리(filmTimeline 의 물보라 위치 0.6,-3.9 와 같다)
export const PUDDLES = [
  { x: 0.6, z: -3.9, rx: 0.85, rz: 0.42, seed: 1 },
  { x: -2.7, z: -5.2, rx: 0.55, rz: 0.3, seed: 2 },
  { x: 3.7, z: -4.5, rx: 0.45, rz: 0.24, seed: 3 },
  { x: -1.4, z: -3.55, rx: 0.3, rz: 0.15, seed: 4 },
];

function blobPath(g, p, w, h, dilate = 0) {
  const cx = ((p.x - CX) + W / 2) / W * w;
  const cy = (1 - ((CZ - p.z) + H / 2) / H) * h;
  g.beginPath();
  const n = 72;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2, s = p.seed;
    const m = 1 + 0.22 * Math.sin(3 * t + s * 1.7) + 0.13 * Math.sin(5 * t + s * 2.9) + 0.07 * Math.sin(9 * t + s * 0.6);
    const x = cx + Math.cos(t) * (p.rx * PX * m + dilate);
    const y = cy + Math.sin(t) * (p.rz * PX * m + dilate);
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.closePath();
}

function makeMask(dilate, blur) {
  const c = document.createElement("canvas");
  c.width = 1024; c.height = Math.round(1024 * H / W);
  const g = c.getContext("2d");
  g.fillStyle = "#000"; g.fillRect(0, 0, c.width, c.height);
  g.filter = `blur(${blur}px)`; g.fillStyle = "#fff";
  for (const p of PUDDLES) { blobPath(g, p, c.width, c.height, dilate); g.fill(); }
  const tx = new CanvasTexture(c); tx.minFilter = LinearFilter; return tx;
}

// 반사 좌표를 살짝 흔드는 잔물결 — 낮은 주파수 노이즈 (R·G 가 x·y 변위)
function makeRipple() {
  const c = document.createElement("canvas"); c.width = c.height = 256;
  const g = c.getContext("2d"); const img = g.createImageData(256, 256); const d = img.data;
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const i = (y * 256 + x) * 4;
    d[i] = 128 + 40 * Math.sin(x * 0.11 + Math.sin(y * 0.07) * 2) + 30 * Math.sin(y * 0.13 + x * 0.05);
    d[i + 1] = 128 + 40 * Math.cos(y * 0.09 + Math.sin(x * 0.06) * 2);
    d[i + 2] = 128; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const tx = new CanvasTexture(c); tx.wrapS = tx.wrapT = RepeatWrapping; return tx;
}

export default function Puddles({ reflect = true }) {
  const masks = useMemo(() => ({ crisp: makeMask(0, 1.2), halo: makeMask(22, 20), ripple: makeRipple() }), []);
  return (
    <group position={[CX, 0, CZ]} rotation={[-Math.PI / 2, 0, 0]}>
      {/* 젖은 테두리 — 웅덩이 둘레 아스팔트가 더 어둡다 */}
      <mesh position={[0, 0, 0.008]}>
        <planeGeometry args={[W, H]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.55} alphaMap={masks.halo} depthWrite={false} />
      </mesh>
      {/* 수면 — 마스크 안에서만 보인다 */}
      <mesh position={[0, 0, 0.012]}>
        <planeGeometry args={[W, H]} />
        {reflect ? (
          <MeshReflectorMaterial
            transparent alphaMap={masks.crisp} color="#0f1418" roughness={0.08} metalness={0.3} depthWrite={false}
            mirror={0.75} blur={[120, 40]} mixBlur={0.6} mixStrength={1.2} mixContrast={1.1} resolution={512}
            depthScale={0.25} minDepthThreshold={0.9} maxDepthThreshold={1.3} depthToBlurRatioBias={0.2}
            distortion={0.035} distortionMap={masks.ripple}
          />
        ) : (
          <meshStandardMaterial transparent alphaMap={masks.crisp} color="#161b20" roughness={0.04} metalness={0.7} envMapIntensity={1.2} depthWrite={false} />
        )}
      </mesh>
    </group>
  );
}
