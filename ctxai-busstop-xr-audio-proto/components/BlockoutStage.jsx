"use client";

// 정류장 그레이박스(blockout) — GLB 업로드나 유료 이미지→3D API 없이, 코드로 직접
// 만든 실제 3D 지오메트리다. 형태·비율·색은 Bus/ArtWork_Final의 실제 원화(전체뷰·
// 메인뷰·사이드뷰)를 보고 맞췄다: 어두운 금속 프레임 + 따뜻한 목재 지붕 + 지붕 밑
// 얇은 주황 네온 띠, 지붕보다 훨씬 큰 가늘고 뾰족한 삼나무열 + 앞쪽 억새 군락,
// 황색 이중 중앙선이 있는 2차선 도로, 도로가 굽어지는 지점의 작은 카페.
//
// 평면 그림 한 장(ImageBackdrop, 삭제됨)과 달리 진짜 입체·깊이가 있어서 헤드셋에서
// 고개를 돌리면 실제로 다른 면이 보인다. 화풍은 원화만큼 정교하진 않지만(회색조
// 도형 수준), 비용 0원으로 지금 바로 되는 방법이다.
//
// 나중에 실제 3D 에셋(Meshy 등 유료 API, 또는 사람이 만든 GLB)이 생기면
// components/AudienceStage.jsx(GLB 파이프라인)로 자리를 바꾸면 된다 — 배치는
// 명명규칙.md §3 원점(벤치 착석 지점 바닥 = 0,0,0)을 그대로 따른다.

const MOODS = {
  neutral: { sky: "#8f96a3", fog: "#8f96a3", fogDensity: 0.03, ambient: "#c9ccd4", ambientI: 0.75, key: "#e9edf2", keyI: 1.0, road: "#3f4247", neon: "#ff9a3d" },
  H: { sky: "#232b27", fog: "#202a26", fogDensity: 0.075, ambient: "#33403a", ambientI: 0.55, key: "#6f9884", keyI: 0.4, road: "#1c1e1b", neon: "#5fae8a" },
  R: { sky: "#f0b384", fog: "#e6a374", fogDensity: 0.026, ambient: "#f4c99a", ambientI: 0.85, key: "#ffcf8f", keyI: 1.3, road: "#463c34", neon: "#ff9a3d" },
  C: { sky: "#ffe28a", fog: "#ffe9a8", fogDensity: 0.018, ambient: "#fff2c2", ambientI: 1.0, key: "#fff0b0", keyI: 1.5, road: "#57534a", neon: "#ffcf5c" },
};

// 아주 가늘고 뾰족한 삼나무(cypress) — 원화의 시그니처 요소. 지붕(~2.4m)보다
// 훨씬 크게(5~9m), 반지름은 극단적으로 얇게 잡는다.
function Cypress({ position, height = 6, lean = 0 }) {
  const segs = 5;
  return (
    <group position={position} rotation={[0, 0, lean]}>
      <mesh position={[0, 0.35, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.07, 0.7, 6]} />
        <meshStandardMaterial color="#3a2e22" />
      </mesh>
      {Array.from({ length: segs }, (_, i) => {
        const t = i / segs;
        const y = 0.7 + (height - 0.7) * ((i + 0.9) / segs);
        const r = 0.34 * (1 - t * 0.82);
        const h = (height - 0.7) / segs + 0.15;
        return (
          <mesh key={i} position={[0, y, 0]} castShadow>
            <coneGeometry args={[Math.max(r, 0.03), h, 7]} />
            <meshStandardMaterial color={i % 2 === 0 ? "#233d2a" : "#2c4a33"} />
          </mesh>
        );
      })}
    </group>
  );
}

// 둥근 전나무 — 삼나무 사이에 섞어 실루엣을 다양하게 한다.
function RoundPine({ position, scale = 1 }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.5, 0]} castShadow>
        <cylinderGeometry args={[0.09, 0.13, 1, 6]} />
        <meshStandardMaterial color="#4a3a2a" />
      </mesh>
      <mesh position={[0, 1.5, 0]} castShadow>
        <coneGeometry args={[0.75, 2.0, 8]} />
        <meshStandardMaterial color="#2f4a34" />
      </mesh>
      <mesh position={[0, 2.5, 0]} castShadow>
        <coneGeometry args={[0.5, 1.6, 8]} />
        <meshStandardMaterial color="#38583e" />
      </mesh>
    </group>
  );
}

// 억새/갈대 군락 — 도로 건너 앞줄, 나무보다 낮고 관객과 가깝다.
function Reeds({ position, count = 5 }) {
  return (
    <group position={position}>
      {Array.from({ length: count }, (_, i) => {
        const dx = (i - count / 2) * 0.12 + (i % 2 ? 0.05 : -0.03);
        const h = 0.9 + (i % 3) * 0.25;
        const lean = ((i % 2 ? 1 : -1) * (0.08 + (i % 3) * 0.03));
        return (
          <mesh key={i} position={[dx, h / 2, 0]} rotation={[0, 0, lean]}>
            <cylinderGeometry args={[0.008, 0.02, h, 4]} />
            <meshStandardMaterial color="#c2b073" />
          </mesh>
        );
      })}
    </group>
  );
}

// 360도 배경 숲 — 특정 사건이 지정된 방위(카페 -38°, 포스터 +72° 등)만 채우면
// 그 사이는 하늘만 보이는 구멍이 생긴다. 먼 반경에 나무를 촘촘히 둘러 수평선
// 전체를 숲으로 감싸고, 사건별 근거리 요소는 이 배경보다 앞에 놓인다.
// Math.random() 대신 인덱스 기반 결정적 값을 써서 서버/클라이언트 하이드레이션
// 불일치가 나지 않게 한다.
function ForestRing({ radius = 13, count = 22 }) {
  const trees = Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2;
    const r = radius + ((i * 37) % 7) * 0.5;
    const height = 6 + ((i * 13) % 5);
    return {
      x: Math.sin(angle) * r,
      z: -Math.cos(angle) * r,
      height,
      isPine: i % 4 === 0,
    };
  });
  return (
    <>
      {trees.map((t, i) =>
        t.isPine ? (
          <RoundPine key={i} position={[t.x, 0, t.z]} scale={1 + (t.height - 6) * 0.1} />
        ) : (
          <Cypress key={i} position={[t.x, 0, t.z]} height={t.height} lean={((i % 3) - 1) * 0.02} />
        )
      )}
    </>
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

// 정류장 지붕 — 원화의 핵심 디테일: 어두운 금속 프레임, 따뜻한 목재 지붕,
// 지붕 밑면을 따라 흐르는 얇은 주황 네온 띠 두 줄.
function Shelter({ mood }) {
  const postXs = [-0.95, 0.95];
  const postZs = [0.35, -1.05];
  return (
    <group>
      <mesh position={[0, 2.35, -0.35]} rotation={[0.04, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.1, 0.08, 1.6]} />
        <meshStandardMaterial color="#4a3222" />
      </mesh>
      {/* 네온 띠 2줄 — 지붕 밑면에 붙여 은은하게 빛나게 */}
      {[-0.55, 0.35].map((z) => (
        <mesh key={z} position={[0, 2.31, z]}>
          <boxGeometry args={[1.95, 0.015, 0.03]} />
          <meshStandardMaterial color={mood.neon} emissive={mood.neon} emissiveIntensity={1.6} />
        </mesh>
      ))}
      {postXs.map((x) =>
        postZs.map((z) => (
          <group key={`${x}-${z}`}>
            <mesh position={[x, 0.35, z]} castShadow>
              <cylinderGeometry args={[0.05, 0.05, 0.7, 8]} />
              <meshStandardMaterial color="#8a5a2e" />
            </mesh>
            <mesh position={[x, 1.5, z]} castShadow>
              <cylinderGeometry args={[0.045, 0.045, 1.6, 8]} />
              <meshStandardMaterial color="#22242a" />
            </mesh>
          </group>
        ))
      )}
      <mesh position={[0, 1.1, -1.05]}>
        <boxGeometry args={[1.9, 2.1, 0.02]} />
        <meshPhysicalMaterial color="#bcd4e0" transparent opacity={0.22} roughness={0.08} metalness={0.1} />
      </mesh>
      <mesh position={[-0.95, 1.1, -0.35]}>
        <boxGeometry args={[0.02, 2.1, 1.4]} />
        <meshPhysicalMaterial color="#bcd4e0" transparent opacity={0.22} roughness={0.08} metalness={0.1} />
      </mesh>
      {/* 오른쪽 유리 — v2.md §1-1 "관객 오른쪽 유리에는 비에 젖은 포스터가 붙어 있다".
          방위각 약 72°(정면 기준 우측 근거리) — 원 기획의 다섯 관찰 단서 중 하나라
          자리를 비워두면 안 된다. */}
      <mesh position={[0.95, 1.1, -0.35]}>
        <boxGeometry args={[0.02, 2.1, 1.4]} />
        <meshPhysicalMaterial color="#bcd4e0" transparent opacity={0.22} roughness={0.08} metalness={0.1} />
      </mesh>
      <mesh position={[0.94, 1.25, -0.55]} rotation={[0, -Math.PI / 2, 0.06]}>
        <planeGeometry args={[0.32, 0.44]} />
        <meshStandardMaterial color="#e8e2d0" side={2} />
      </mesh>
    </group>
  );
}

function Bench() {
  return (
    <group position={[0, 0, 0.05]}>
      <mesh position={[0, 0.42, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.7, 0.06, 0.42]} />
        <meshStandardMaterial color="#6b3a28" />
      </mesh>
      <mesh position={[0, 0.68, -0.19]} rotation={[-0.12, 0, 0]} castShadow>
        <boxGeometry args={[1.7, 0.5, 0.05]} />
        <meshStandardMaterial color="#6b3a28" />
      </mesh>
      {[-0.75, 0.75].map((x) => (
        <mesh key={x} position={[x, 0.2, 0]}>
          <boxGeometry args={[0.06, 0.4, 0.38]} />
          <meshStandardMaterial color="#1e1a17" />
        </mesh>
      ))}
    </group>
  );
}

// v2.md §1-2 "도로 건너편 왼쪽 약 50미터 거리" — 정면 기준 방위각 약 -38°(좌측
// 원거리)에 오도록 배치. 블록아웃 스케일에선 50m를 그대로 못 쓰니 비율만 맞춘다.
function Cafe({ mood }) {
  return (
    <group position={[-9, 0, -12]}>
      <mesh position={[0, 1.1, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.8, 2.1, 2.2]} />
        <meshStandardMaterial color="#2a2622" />
      </mesh>
      <mesh position={[0, 1.05, 1.11]}>
        <planeGeometry args={[2.3, 1.3]} />
        <meshStandardMaterial color="#ff8a5c" emissive="#ff6a3c" emissiveIntensity={0.9} />
      </mesh>
      <mesh position={[0, 2.3, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <coneGeometry args={[2.1, 0.7, 4]} />
        <meshStandardMaterial color="#1c1a17" />
      </mesh>
      <pointLight position={[0, 1.2, 1.5]} color="#ff8a5c" intensity={0.7} distance={5} />
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

      {/* 도로(왕복 4차선, v2.md §1 "정면에는 왕복 4차선 도로") + 인도 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[2.4, 0, -10]} receiveShadow>
        <planeGeometry args={[8, 40]} />
        <meshStandardMaterial color={mood.road} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-0.6, 0.01, -6]} receiveShadow>
        <planeGeometry args={[2.2, 20]} />
        <meshStandardMaterial color="#5c5c58" />
      </mesh>
      {/* 황색 이중 중앙선 — 왕복 방향을 가른다 */}
      {[-0.06, 0.06].map((dx) => (
        <mesh key={dx} rotation={[-Math.PI / 2, 0, 0]} position={[2.4 + dx, 0.015, -12]}>
          <planeGeometry args={[0.04, 34]} />
          <meshStandardMaterial color="#e0b840" />
        </mesh>
      ))}
      {/* 흰색 점선 2줄 — 각 방향 2차선을 가르는 차선 경계 */}
      {[0.35, 4.45].map((laneX) =>
        Array.from({ length: 10 }, (_, i) => (
          <mesh key={`${laneX}-${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[laneX, 0.015, -1.5 - i * 2.2]}>
            <planeGeometry args={[0.08, 1.1]} />
            <meshStandardMaterial color="#d8d8d0" />
          </mesh>
        ))
      )}

      <Shelter mood={mood} />
      <Bench />
      <Cafe mood={mood} />

      {/* v2.md §1 "정류장 뒤에는 빗물을 머금은 풀숲이 있고" — 담장이 아니라 젖은
          풀숲이다. 낮은 경계석 위에 억새 군락을 촘촘히 둬서 벽 대신 수풀로 막는다. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.6, 0.02, 1.9]} receiveShadow>
        <planeGeometry args={[7, 1]} />
        <meshStandardMaterial color="#3a4a36" />
      </mesh>
      <Reeds position={[-2.2, 0, 1.85]} count={6} />
      <Reeds position={[-0.6, 0, 1.9]} count={7} />
      <Reeds position={[1.0, 0, 1.88]} count={6} />
      <Reeds position={[2.6, 0, 1.92]} count={7} />
      {/* 오른쪽 뒤 약 45도(=정면 기준 135°) 방향 — v2.md §1-4 개구리 단서. 소리
          전용 사건이라 3D 자산은 필요 없지만, 방향을 표시할 만큼 수풀을 더 둔다. */}
      <Reeds position={[1.9, 0, 1.9]} count={5} />
      {Array.from({ length: 4 }, (_, i) => (
        <RoundPine key={`bg${i}`} position={[-3 + i * 2, 0, 3.4 + (i % 2) * 0.5]} scale={0.9 + i * 0.08} />
      ))}

      {/* 도로 건너편(4차선 폭 밖, x>6.4) — v2.md §1 "정면 오른쪽에는 침엽수림과
          호수공원 산책로" — 억새 앞줄 + 삼나무열(지붕보다 훨씬 큼) + 둥근 전나무 */}
      <Reeds position={[6.6, 0, -1.8]} count={5} />
      <Reeds position={[6.9, 0, -3.2]} count={6} />
      <Reeds position={[6.5, 0, -4.6]} count={5} />

      {[
        [7.2, -2.2, 6.5, -0.04],
        [7.6, -4.4, 7.5, 0.03],
        [7.1, -6.6, 6.0, -0.02],
        [7.8, -9.2, 8.5, 0.05],
        [7.3, -12.0, 7.0, -0.03],
        [8.1, -15.5, 9.0, 0.02],
      ].map(([x, z, h, lean], i) => (
        <Cypress key={i} position={[x, 0, z]} height={h} lean={lean} />
      ))}
      <RoundPine position={[6.8, 0, -5.6]} scale={1.1} />
      <RoundPine position={[7.5, 0, -10.4]} scale={1.3} />

      {/* 왼쪽(관객 쪽) 나무열 — 담장 너머 */}
      {[-1.6, -2.0, -1.4].map((x, i) => (
        <Cypress key={`l${i}`} position={[x, 0, -1.2 - i * 2.4]} height={5 + i * 0.8} lean={(i - 1) * 0.03} />
      ))}
      {/* 담장 너머 나무 — 뒤돌아봤을 때도 깊이가 있게 */}
      {[-2.5, -0.5, 1.5, 3.5].map((x, i) => (
        <RoundPine key={`b${i}`} position={[x, 0, 2.6 + (i % 2) * 0.6]} scale={1.0 + i * 0.08} />
      ))}

      <StreetLamp position={[6.3, 0, -6]} on={genre === "H"} />
      <StreetLamp position={[1.4, 0, -0.3]} on />

      {/* 배경 링 — 위 사건별 배치 사이에 하늘만 보이던 구멍을 없앤다 */}
      <ForestRing radius={13} count={22} />
    </>
  );
}
