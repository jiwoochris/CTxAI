"use client";
// 1톤 포터 트럭 — 도입부 세 번째 단서(물보라)의 배우. 관객은 옆면을 1.5초쯤 본다.
// 이전 판은 상자 두 개였다. 여기서는 둥근 캡(압출)·기울어진 앞유리·옆창·문 이음선·사이드미러·
// 프레임 위 적재함(파란 방수포 + 로프 걸이)·휠 아치·후미등·번호판을 붙였다. 로컬 +z 가 앞.
import { useMemo } from "react";
import { Shape, ExtrudeGeometry } from "three";

const CAB = "#e9ecef", TRIM = "#1b1f24", GLASS = "#22303e", TARP = "#2b5aa8", RUBBER = "#0c0f12";

function cabProfile() {
  // 옆에서 본 캡 윤곽 (z 앞·y 위): 보닛이 짧고 앞유리가 뒤로 누운 원박스형
  const s = new Shape();
  s.moveTo(0.55, 0.42); s.lineTo(2.05, 0.42); s.quadraticCurveTo(2.2, 0.42, 2.2, 0.6);
  s.lineTo(2.2, 1.05); s.quadraticCurveTo(2.2, 1.15, 2.1, 1.2); // 보닛 끝
  s.lineTo(1.85, 1.95); s.quadraticCurveTo(1.8, 2.12, 1.62, 2.12); // 앞유리 기울기 → 지붕
  s.lineTo(0.7, 2.12); s.quadraticCurveTo(0.55, 2.12, 0.55, 1.97);
  s.lineTo(0.55, 0.42);
  return s;
}

function useCabGeometry() {
  return useMemo(() => {
    const g = new ExtrudeGeometry(cabProfile(), { depth: 1.62, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 3, curveSegments: 8 });
    g.rotateY(-Math.PI / 2); // 윤곽의 x(앞뒤) → z, 압출 방향 → x
    g.translate(0.81, 0, 0); // 압출 폭 1.62 + 베벨 0.04×2 = 1.70 을 가운데로 → x ±0.85
    g.computeVertexNormals();
    return g;
  }, []);
}

function Wheel({ x, z, r = 0.34 }) {
  return (
    <group position={[x, r, z]} rotation={[0, 0, Math.PI / 2]}>
      <mesh castShadow>
        <cylinderGeometry args={[r, r, 0.22, 20]} />
        <meshStandardMaterial color="#141517" roughness={0.95} />
      </mesh>
      <mesh>
        <cylinderGeometry args={[r * 0.55, r * 0.55, 0.23, 14]} />
        <meshStandardMaterial color="#b3b9c0" metalness={0.85} roughness={0.3} />
      </mesh>
    </group>
  );
}

export default function Truck({ x, z }) {
  const cab = useCabGeometry();
  return (
    <group position={[x, 0, z]}>
      {/* 캡 */}
      <mesh geometry={cab} castShadow>
        <meshPhysicalMaterial color={CAB} metalness={0.2} roughness={0.35} clearcoat={0.8} clearcoatRoughness={0.1} />
      </mesh>
      {/* 앞유리 (기울기 = 윤곽과 같은 각) */}
      <mesh position={[0, 1.6, 2.0]} rotation={[-0.32, 0, 0]}>
        <planeGeometry args={[1.42, 0.82]} />
        <meshPhysicalMaterial color={GLASS} metalness={0.55} roughness={0.1} envMapIntensity={0.7} clearcoat={1} />
      </mesh>
      {/* 옆창 · 문 이음선 · 손잡이 · 사이드미러 (양쪽) */}
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh position={[s * 0.855, 1.62, 1.25]} rotation={[0, s > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}>
            <planeGeometry args={[0.98, 0.72]} />
            <meshStandardMaterial color={RUBBER} roughness={0.7} />
          </mesh>
          <mesh position={[s * 0.86, 1.62, 1.25]} rotation={[0, s > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}>
            <planeGeometry args={[0.9, 0.64]} />
            <meshPhysicalMaterial color={GLASS} metalness={0.55} roughness={0.1} envMapIntensity={0.7} clearcoat={1} />
          </mesh>
          <mesh position={[s * 0.855, 1.05, 0.72]}>
            <boxGeometry args={[0.012, 1.2, 0.012]} />
            <meshStandardMaterial color="#8a9096" />
          </mesh>
          <mesh position={[s * 0.86, 1.12, 1.05]}>
            <boxGeometry args={[0.02, 0.04, 0.16]} />
            <meshStandardMaterial color={TRIM} />
          </mesh>
          <group position={[s * 1.05, 1.55, 1.85]}>
            <mesh position={[-s * 0.1, 0, 0]}>
              <boxGeometry args={[0.2, 0.025, 0.025]} />
              <meshStandardMaterial color={TRIM} />
            </mesh>
            <mesh>
              <boxGeometry args={[0.05, 0.22, 0.14]} />
              <meshStandardMaterial color={TRIM} metalness={0.3} roughness={0.5} />
            </mesh>
          </group>
          {/* 휠 아치 */}
          {[1.45, -1.3].map((wz) => (
            <mesh key={wz} position={[s * 0.865, 0.36, wz]} rotation={[0, s > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}>
              <circleGeometry args={[0.4, 20, 0, Math.PI]} />
              <meshStandardMaterial color="#0b0d0f" roughness={1} />
            </mesh>
          ))}
        </group>
      ))}
      {/* 그릴 · 전조등 · 범퍼 · 번호판 */}
      <mesh position={[0, 0.82, 2.21]}>
        <boxGeometry args={[1.2, 0.22, 0.02]} />
        <meshStandardMaterial color={TRIM} metalness={0.4} roughness={0.5} />
      </mesh>
      {[-0.62, 0.62].map((dx) => (
        <group key={dx} position={[dx, 0.85, 2.215]}>
          <mesh>
            <boxGeometry args={[0.3, 0.16, 0.01]} />
            <meshStandardMaterial color="#fff6dc" emissive="#fff0c8" emissiveIntensity={1.8} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 0.5, 2.24]}>
        <boxGeometry args={[1.7, 0.2, 0.1]} />
        <meshStandardMaterial color="#2a2e33" metalness={0.5} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.62, 2.3]}>
        <planeGeometry args={[0.36, 0.1]} />
        <meshStandardMaterial color="#f4f5f0" roughness={0.6} />
      </mesh>
      <pointLight position={[0, 0.8, 3.0]} color="#ffe9c0" intensity={1.0} distance={6} />

      {/* 섀시 프레임 + 적재함 (바닥·낮은 옆판·파란 방수포 + 로프) */}
      <mesh position={[0, 0.5, -0.85]}>
        <boxGeometry args={[1.2, 0.16, 2.9]} />
        <meshStandardMaterial color="#2a2e33" metalness={0.5} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.66, -0.85]} castShadow>
        <boxGeometry args={[1.75, 0.12, 2.9]} />
        <meshStandardMaterial color="#c9ccd0" metalness={0.5} roughness={0.5} />
      </mesh>
      {[-0.86, 0.86].map((dx) => (
        <mesh key={dx} position={[dx, 0.86, -0.85]}>
          <boxGeometry args={[0.03, 0.32, 2.9]} />
          <meshStandardMaterial color="#c9ccd0" metalness={0.5} roughness={0.5} />
        </mesh>
      ))}
      <mesh position={[0, 0.86, -2.29]}>
        <boxGeometry args={[1.75, 0.32, 0.03]} />
        <meshStandardMaterial color="#c9ccd0" metalness={0.5} roughness={0.5} />
      </mesh>
      <mesh position={[0, 1.12, -0.85]} castShadow>
        <boxGeometry args={[1.62, 0.5, 2.6]} />
        <meshStandardMaterial color={TARP} roughness={0.9} />
      </mesh>
      <mesh position={[0, 1.4, -0.85]} rotation={[0, 0, 0]} castShadow>
        <boxGeometry args={[1.2, 0.12, 2.2]} />
        <meshStandardMaterial color={TARP} roughness={0.9} />
      </mesh>
      {[-1.8, -0.9, 0.0].map((dz) => (
        <mesh key={dz} position={[0, 1.13, dz]}>
          <boxGeometry args={[1.66, 0.54, 0.015]} />
          <meshStandardMaterial color="#e6d8b8" roughness={0.95} />
        </mesh>
      ))}
      {/* 후미등 · 뒤 범퍼 */}
      {[-0.7, 0.7].map((dx) => (
        <mesh key={dx} position={[dx, 0.66, -2.31]}>
          <boxGeometry args={[0.16, 0.1, 0.01]} />
          <meshStandardMaterial color="#ff2a1a" emissive="#ff1a0a" emissiveIntensity={1.2} />
        </mesh>
      ))}
      <mesh position={[0, 0.42, -2.32]}>
        <boxGeometry args={[1.7, 0.14, 0.06]} />
        <meshStandardMaterial color="#2a2e33" metalness={0.5} roughness={0.5} />
      </mesh>
      {/* 바퀴 */}
      {[[-0.78, -1.3], [0.78, -1.3], [-0.78, 1.45], [0.78, 1.45]].map(([dx, dz], i) => <Wheel key={i} x={dx} z={dz} />)}
    </group>
  );
}
