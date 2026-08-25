"use client";

// 정류장 그레이박스(blockout) — GLB 업로드나 유료 이미지→3D API 없이, 코드로 직접
// 만든 실제 3D 지오메트리다. 평면 그림 한 장(ImageBackdrop)과 달리 진짜 입체·깊이가
// 있어서 헤드셋에서 고개를 돌리면 실제로 다른 면이 보인다 — "이미지를 그냥 박은
// 것"이 아니라 진짜 3D 구현. 화풍은 지금 일러스트만큼 안 예쁘지만(회색조 도형
// 수준), 비용 0원으로 지금 바로 되는 방법이다.
//
// 나중에 실제 3D 에셋(Meshy 등 유료 API, 또는 사람이 만든 GLB)이 생기면
// components/AudienceStage.jsx(GLB 파이프라인)로 자리를 바꾸면 된다 — 같은
// lib/assetSpec.js 슬롯 구조를 그대로 쓸 수 있게 배치는 명명규칙.md §3 원점
// (벤치 착석 지점 바닥 = 0,0,0)을 그대로 따른다.

const MOODS = {
  neutral: { sky: "#7c8592", fog: "#7c8592", fogDensity: 0.032, ambient: "#c9ccd4", ambientI: 0.7, key: "#fff2df", keyI: 1.1, road: "#4a4d52" },
  H: { sky: "#232b27", fog: "#202a26", fogDensity: 0.075, ambient: "#33403a", ambientI: 0.55, key: "#6f9884", keyI: 0.4, road: "#20221f" },
  R: { sky: "#f0b384", fog: "#e6a374", fogDensity: 0.028, ambient: "#f4c99a", ambientI: 0.85, key: "#ffcf8f", keyI: 1.3, road: "#4a4038" },
  C: { sky: "#ffe28a", fog: "#ffe9a8", fogDensity: 0.018, ambient: "#fff2c2", ambientI: 1.0, key: "#fff0b0", keyI: 1.5, road: "#57534a" },
};

function Tree({ position, scale = 1 }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.6, 0]} castShadow>
        <cylinderGeometry args={[0.08, 0.12, 1.2, 6]} />
        <meshStandardMaterial color="#4a3a2a" />
      </mesh>
      <mesh position={[0, 1.7, 0]} castShadow>
        <coneGeometry args={[0.6, 2.2, 8]} />
        <meshStandardMaterial color="#2f4a34" />
      </mesh>
      <mesh position={[0, 2.7, 0]} castShadow>
        <coneGeometry args={[0.42, 1.6, 8]} />
        <meshStandardMaterial color="#38583e" />
      </mesh>
    </group>
  );
}

function StreetLamp({ position, on }) {
  return (
    <group position={position}>
      <mesh position={[0, 1.5, 0]} castShadow>
        <cylinderGeometry args={[0.04, 0.05, 3, 8]} />
        <meshStandardMaterial color="#33363c" />
      </mesh>
      <mesh position={[0, 2.95, 0.22]} rotation={[Math.PI / 2.4, 0, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 0.5, 6]} />
        <meshStandardMaterial color="#33363c" />
      </mesh>
      <mesh position={[0, 2.9, 0.42]}>
        <sphereGeometry args={[0.09, 8, 8]} />
        <meshStandardMaterial color="#fff2c0" emissive="#fff2c0" emissiveIntensity={on ? 1.4 : 0.1} />
      </mesh>
      {on && <pointLight position={[0, 2.9, 0.42]} color="#ffedb0" intensity={0.6} distance={4} />}
    </group>
  );
}

function Shelter() {
  const postXs = [-0.95, 0.95];
  const postZs = [0.35, -1.05];
  return (
    <group>
      {/* 지붕 */}
      <mesh position={[0, 2.35, -0.35]} rotation={[0.04, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.1, 0.08, 1.6]} />
        <meshStandardMaterial color="#5a3a2a" />
      </mesh>
      {/* 기둥 4개 */}
      {postXs.map((x) =>
        postZs.map((z) => (
          <mesh key={`${x}-${z}`} position={[x, 1.15, z]} castShadow>
            <cylinderGeometry args={[0.045, 0.045, 2.3, 8]} />
            <meshStandardMaterial color="#3a2a1e" />
          </mesh>
        ))
      )}
      {/* 뒤쪽 유리벽 */}
      <mesh position={[0, 1.1, -1.05]}>
        <boxGeometry args={[1.9, 2.1, 0.02]} />
        <meshPhysicalMaterial color="#bcd4e0" transparent opacity={0.25} roughness={0.1} metalness={0.1} />
      </mesh>
      {/* 왼쪽(도로 반대편) 유리벽 */}
      <mesh position={[-0.95, 1.1, -0.35]}>
        <boxGeometry args={[0.02, 2.1, 1.4]} />
        <meshPhysicalMaterial color="#bcd4e0" transparent opacity={0.25} roughness={0.1} metalness={0.1} />
      </mesh>
    </group>
  );
}

function Bench() {
  return (
    <group position={[0, 0, 0.05]}>
      <mesh position={[0, 0.42, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.7, 0.06, 0.42]} />
        <meshStandardMaterial color="#6b4a30" />
      </mesh>
      <mesh position={[0, 0.68, -0.19]} rotation={[-0.12, 0, 0]} castShadow>
        <boxGeometry args={[1.7, 0.5, 0.05]} />
        <meshStandardMaterial color="#6b4a30" />
      </mesh>
      {[-0.75, 0.75].map((x) => (
        <mesh key={x} position={[x, 0.2, 0]}>
          <boxGeometry args={[0.06, 0.4, 0.38]} />
          <meshStandardMaterial color="#2a2320" />
        </mesh>
      ))}
    </group>
  );
}

function Cafe({ mood }) {
  return (
    <group position={[5.5, 0, -14]}>
      <mesh position={[0, 1.2, 0]} castShadow receiveShadow>
        <boxGeometry args={[3.2, 2.4, 2.4]} />
        <meshStandardMaterial color="#2a2622" />
      </mesh>
      <mesh position={[0, 1.2, 1.21]}>
        <planeGeometry args={[2.6, 1.6]} />
        <meshStandardMaterial color={mood.key} emissive={mood.key} emissiveIntensity={0.8} />
      </mesh>
      <mesh position={[0, 2.55, 0]} castShadow>
        <boxGeometry args={[3.6, 0.3, 2.8]} />
        <meshStandardMaterial color="#1c1a17" />
      </mesh>
    </group>
  );
}

export default function BlockoutStage({ genre }) {
  const mood = MOODS[genre] || MOODS.neutral;

  return (
    <>
      <color attach="background" args={[mood.sky]} />
      <fogExp2 attach="fog" args={[mood.fog, mood.fogDensity]} />

      <ambientLight color={mood.ambient} intensity={mood.ambientI} />
      <directionalLight position={[3, 6, 2]} color={mood.key} intensity={mood.keyI} castShadow />

      {/* 도로 + 인도 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[2, 0, -10]} receiveShadow>
        <planeGeometry args={[8, 40]} />
        <meshStandardMaterial color={mood.road} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-0.6, 0.01, -6]} receiveShadow>
        <planeGeometry args={[2.2, 20]} />
        <meshStandardMaterial color="#5c5c58" />
      </mesh>
      {/* 중앙선 */}
      {Array.from({ length: 10 }, (_, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[2, 0.015, -1.5 - i * 2.2]}>
          <planeGeometry args={[0.12, 1.1]} />
          <meshStandardMaterial color="#d8c060" />
        </mesh>
      ))}

      <Shelter />
      <Bench />
      <Cafe mood={mood} />

      {[-1.3, -1.35, -1.4].map((x, i) => (
        <Tree key={i} position={[x - 0.3, 0, -1.4 - i * 2.6]} scale={0.9 + i * 0.15} />
      ))}
      {[3.2, 3.6, 4.1, 4.6].map((x, i) => (
        <Tree key={`r${i}`} position={[x, 0, -3 - i * 3.4]} scale={0.8 + i * 0.1} />
      ))}

      <StreetLamp position={[3.6, 0, -6]} on={genre === "H"} />
      <StreetLamp position={[1.6, 0, -0.3]} on />
    </>
  );
}
