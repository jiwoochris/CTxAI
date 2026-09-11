"use client";
// 272번 시내버스 — 코드 지오메트리. 이전 판은 상자 세 개를 쌓아 옆면이 파란 판 한 장으로 보였다.
// 여기서는 둥근 단면을 압출한 차체(클리어코트 도장) 위에 창문을 한 장씩 고무 테두리와 함께 얹고,
// 휠 아치·앞유리 기울기·행선지판 박스·전조등 베젤·와이퍼·사이드미러·지붕 에어컨·문 계단을 붙였다.
// 로컬 좌표: +z 가 앞, −x 가 연석(관객) 쪽. 무대에서는 y 축 π/2 회전으로 도로(x 축)를 따라 달린다.
import { useMemo } from "react";
import { Shape, ExtrudeGeometry, CanvasTexture, SRGBColorSpace } from "three";

// 창 안쪽 — 차체가 속이 찬 압출이라 실내를 진짜로 그릴 수는 없다. 대신 창마다 "따뜻한 실내 + 좌석 등받이 + 승객 실루엣"을
// 그린 캔버스를 발광 텍스처로 얹는다(게임의 야간 버스 창 처리). 정차 중 관객이 16초쯤 바로 앞에서 보는 면이다.
function useWindowTextures() {
  return useMemo(() => {
    if (typeof document === "undefined") return [];
    const make = (seed) => {
      const c = document.createElement("canvas"); c.width = 512; c.height = 512; const g = c.getContext("2d");
      const bg = g.createLinearGradient(0, 0, 0, 512); bg.addColorStop(0, "#e3cfa9"); bg.addColorStop(1, "#b39a72");
      g.fillStyle = bg; g.fillRect(0, 0, 512, 512);
      g.fillStyle = "rgba(255,246,220,0.55)"; g.fillRect(0, 0, 512, 46); // 천장 조명 띠
      g.fillStyle = "#4a4038"; g.fillRect(0, 300, 512, 212); // 좌석 등받이 줄
      g.fillStyle = "#5b5047"; g.fillRect(0, 300, 512, 14);
      // 승객 실루엣 — 창마다 0~2명, 자리·키가 다르다 (seed 로 결정). 빈 창도 있어야 버스가 붐비지 않는다
      const layouts = [[[140, 1]], [[120, 0], [372, 1]], [], [[300, 1]], [[160, 1], [390, 0]]];
      for (const [x, tall] of layouts[seed % layouts.length]) {
        g.fillStyle = "#2b2620";
        g.beginPath(); g.ellipse(x, 262 - tall * 16, 62, 40, 0, Math.PI, 0); g.fill(); // 어깨
        g.beginPath(); g.arc(x, 218 - tall * 16, 27, 0, Math.PI * 2); g.fill(); // 머리
      }
      g.fillStyle = "rgba(0,0,0,0.12)"; g.fillRect(0, 0, 512, 512); // 유리 톤
      const tx = new CanvasTexture(c); tx.colorSpace = SRGBColorSpace; tx.anisotropy = 4; return tx;
    };
    return [make(0), make(1), make(2), make(3), make(4)];
  }, []);
}

const L = 10.6, HW = 1.25, Y0 = 0.42, Y1 = 3.05; // 길이 · 반폭 · 바닥 · 지붕 (m)
const BODY = "#2a62b4", SKIRT = "#dde2e7", TRIM = "#141920", GLASS = "#1f2c3a", RUBBER = "#0c0f12", CHROME = "#c9ced4";

function roundedProfile(hw, y0, y1, rTop, rBot) {
  const s = new Shape();
  s.moveTo(-hw + rBot, y0);
  s.lineTo(hw - rBot, y0); s.quadraticCurveTo(hw, y0, hw, y0 + rBot);
  s.lineTo(hw, y1 - rTop); s.quadraticCurveTo(hw, y1, hw - rTop, y1);
  s.lineTo(-hw + rTop, y1); s.quadraticCurveTo(-hw, y1, -hw, y1 - rTop);
  s.lineTo(-hw, y0 + rBot); s.quadraticCurveTo(-hw, y0, -hw + rBot, y0);
  return s;
}

function useBodyGeometry() {
  return useMemo(() => {
    const bevel = 0.06;
    const g = new ExtrudeGeometry(roundedProfile(HW - bevel, Y0 + bevel, Y1 - bevel, 0.34, 0.1), {
      depth: L - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 12,
    });
    g.translate(0, 0, -(L - bevel * 2) / 2);
    g.computeVertexNormals();
    return g;
  }, []);
}

// 창문 한 장 — 고무 테두리(검정) 위에 어두운 반사 유리. side −1 = 연석 쪽, +1 = 반대쪽
function Pane({ side, z, w, h = 1.05, y = 2.1, lit = 0.14, tex = null }) {
  const rot = [0, side > 0 ? Math.PI / 2 : -Math.PI / 2, 0];
  return (
    <group position={[side * HW, y, z]} rotation={rot}>
      <mesh position={[0, 0, 0.004]}>
        <planeGeometry args={[w + 0.08, h + 0.08]} />
        <meshStandardMaterial color={RUBBER} roughness={0.7} />
      </mesh>
      <mesh position={[0, 0, 0.009]}>
        <planeGeometry args={[w, h]} />
        {tex ? (
          <meshPhysicalMaterial map={tex} emissiveMap={tex} emissive="#ffffff" emissiveIntensity={0.42} color="#9a9a9a" metalness={0.35} roughness={0.12} envMapIntensity={0.55} clearcoat={1} clearcoatRoughness={0.03} />
        ) : (
          <meshPhysicalMaterial color={GLASS} emissive="#ffd9a0" emissiveIntensity={lit} metalness={0.55} roughness={0.12} envMapIntensity={0.7} clearcoat={1} clearcoatRoughness={0.03} />
        )}
      </mesh>
    </group>
  );
}

function Wheel({ x, z }) {
  return (
    <group position={[x, 0.5, z]} rotation={[0, 0, Math.PI / 2]}>
      <mesh castShadow>
        <cylinderGeometry args={[0.5, 0.5, 0.3, 28]} />
        <meshStandardMaterial color="#17191b" roughness={0.95} />
      </mesh>
      <mesh>
        <cylinderGeometry args={[0.31, 0.31, 0.31, 20]} />
        <meshStandardMaterial color="#aeb5bc" metalness={0.85} roughness={0.3} />
      </mesh>
      <mesh position={[0, x > 0 ? 0.16 : -0.16, 0]}>
        <cylinderGeometry args={[0.1, 0.1, 0.02, 12]} />
        <meshStandardMaterial color="#6c737a" metalness={0.9} roughness={0.35} />
      </mesh>
    </group>
  );
}

// 휠 아치 — 차체 면 위의 검은 반원으로 뚫린 인상을 낸다 (CSG 없이)
function Arch({ side, z }) {
  return (
    <mesh position={[side * (HW + 0.003), 0.5, z]} rotation={[0, side > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}>
      <circleGeometry args={[0.57, 24, 0, Math.PI]} />
      <meshStandardMaterial color="#0b0d0f" roughness={1} />
    </mesh>
  );
}

export default function Bus({ x, z, headlight = 1, doorOpen = false, signs = {} }) {
  const body = useBodyGeometry();
  const winTex = useWindowTextures();
  const rearPanes = [-4.55, -3.45, -2.35, -1.25, -0.15, 0.95];
  return (
    <group position={[x, 0, z]}>
      {/* 차체 — 둥근 단면 압출, 클리어코트 도장 */}
      <mesh geometry={body} castShadow receiveShadow>
        <meshPhysicalMaterial color={BODY} metalness={0.15} roughness={0.32} clearcoat={1} clearcoatRoughness={0.08} />
      </mesh>
      {/* 아래 스커트 띠 — 서울 간선버스식 투톤 */}
      {[-1, 1].map((s) => (
        <mesh key={`sk${s}`} position={[s * (HW + 0.002), 0.66, 0]} rotation={[0, s > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}>
          <planeGeometry args={[L - 0.7, 0.36]} />
          <meshPhysicalMaterial color={SKIRT} metalness={0.15} roughness={0.35} clearcoat={0.8} />
        </mesh>
      ))}
      {/* 창 아래 몰딩 */}
      {[-1, 1].map((s) => (
        <mesh key={`md${s}`} position={[s * (HW + 0.003), 1.52, 0]} rotation={[0, s > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}>
          <planeGeometry args={[L - 0.6, 0.04]} />
          <meshStandardMaterial color={SKIRT} metalness={0.4} roughness={0.4} />
        </mesh>
      ))}

      {/* 창문 — 객실 6장씩, 연석 쪽은 앞문 앞에 작은 창, 반대쪽은 운전석 창 */}
      {rearPanes.map((pz, i) => <Pane key={`l${pz}`} side={-1} z={pz} w={1.0} tex={winTex[i % winTex.length] || null} />)}
      {rearPanes.map((pz, i) => <Pane key={`r${pz}`} side={1} z={pz} w={1.0} tex={winTex[(i + 2) % winTex.length] || null} />)}
      <Pane side={-1} z={3.95} w={1.3} tex={winTex[3] || null} />
      <Pane side={1} z={2.0} w={1.0} tex={winTex[1] || null} />
      <Pane side={1} z={3.9} w={1.5} lit={0.08} />

      {/* 앞문 (연석 쪽, z 1.86~2.94) — 차체가 속이 찬 압출이라 문 자리는 차체 면 바로 바깥에 그린다:
          열리면 어두운 개구부 + 실내 온광 + 계단이 보이고 문짝은 양 끝에 접혀 있다. 닫히면 유리 두 짝이 개구부를 덮는다 */}
      <group position={[-(HW + 0.004), 0, 2.4]} rotation={[0, -Math.PI / 2, 0]}>
        <mesh position={[0, 1.42, 0]}>
          <planeGeometry args={[1.12, 2.02]} />
          <meshStandardMaterial color={RUBBER} roughness={0.8} />
        </mesh>
        {doorOpen ? (
          <group>
            <mesh position={[0, 1.42, 0.002]}>
              <planeGeometry args={[1.04, 1.96]} />
              <meshStandardMaterial color="#2a2118" emissive="#ffd9a0" emissiveIntensity={0.55} roughness={1} />
            </mesh>
            <mesh position={[0, 0.5, 0.004]}>
              <planeGeometry args={[1.04, 0.12]} />
              <meshStandardMaterial color="#3a3d42" roughness={0.9} />
            </mesh>
            <mesh position={[0, 0.98, 0.004]}>
              <planeGeometry args={[1.04, 0.05]} />
              <meshStandardMaterial color="#3a3d42" roughness={0.9} />
            </mesh>
            {[-0.5, 0.5].map((dx) => (
              <mesh key={dx} position={[dx, 1.42, 0.05]}>
                <boxGeometry args={[0.06, 1.98, 0.1]} />
                <meshStandardMaterial color={TRIM} metalness={0.4} roughness={0.5} />
              </mesh>
            ))}
          </group>
        ) : (
          [-0.27, 0.27].map((dx) => (
            <group key={dx} position={[dx, 1.42, 0.006]}>
              <mesh>
                <planeGeometry args={[0.52, 1.96]} />
                <meshStandardMaterial color={TRIM} metalness={0.4} roughness={0.5} />
              </mesh>
              <mesh position={[0, 0.42, 0.003]}>
                <planeGeometry args={[0.42, 0.98]} />
                <meshPhysicalMaterial color={GLASS} metalness={0.55} roughness={0.12} envMapIntensity={0.7} clearcoat={1} />
              </mesh>
            </group>
          ))
        )}
      </group>
      {/* 옆 행선지판 (연석 쪽, 문 뒤) */}
      <mesh position={[-(HW + 0.012), 1.18, 0.9]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[1.1, 0.26]} />
        {signs.side ? <meshStandardMaterial map={signs.side} emissiveMap={signs.side} emissive="#ffffff" emissiveIntensity={0.25} /> : <meshStandardMaterial color="#f2f4f6" />}
      </mesh>

      {/* 휠 아치 + 바퀴 */}
      {[-3.25, 3.35].map((wz) => [-1, 1].map((s) => <Arch key={`a${wz}${s}`} side={s} z={wz} />))}
      {[-3.25, 3.35].map((wz) => [-1, 1].map((s) => <Wheel key={`w${wz}${s}`} x={s * (HW - 0.1)} z={wz} />))}

      {/* 앞면 — 기울어진 앞유리, 검은 테두리, 행선지판 박스, 전조등, 범퍼, 와이퍼 */}
      <group position={[0, 0, L / 2]}>
        <mesh position={[0, 2.12, -0.02]} rotation={[-0.09, 0, 0]}>
          <planeGeometry args={[2.34, 1.34]} />
          <meshStandardMaterial color={RUBBER} roughness={0.7} />
        </mesh>
        <mesh position={[0, 2.12, 0.0]} rotation={[-0.09, 0, 0]}>
          <planeGeometry args={[2.2, 1.2]} />
          <meshPhysicalMaterial color="#6f8fb0" metalness={0.6} roughness={0.04} clearcoat={1} clearcoatRoughness={0.02} transparent opacity={0.85} />
        </mesh>
        {[-0.45, 0.45].map((wx) => (
          <mesh key={`wp${wx}`} position={[wx, 1.72, 0.03]} rotation={[-0.09, 0, wx > 0 ? -0.55 : -0.35]}>
            <boxGeometry args={[0.02, 0.62, 0.015]} />
            <meshStandardMaterial color={RUBBER} roughness={0.9} />
          </mesh>
        ))}
        <mesh position={[0, 2.86, -0.03]}>
          <boxGeometry args={[1.8, 0.36, 0.08]} />
          <meshStandardMaterial color={TRIM} metalness={0.3} roughness={0.5} />
        </mesh>
        <mesh position={[0, 2.86, 0.015]}>
          <planeGeometry args={[1.66, 0.28]} />
          {signs.front ? <meshStandardMaterial map={signs.front} emissiveMap={signs.front} emissive="#ffffff" emissiveIntensity={1.4} /> : <meshStandardMaterial color="#ff9a3d" emissive="#ff8a2a" emissiveIntensity={1.6} />}
        </mesh>
        {[-0.82, 0.82].map((hx) => (
          <group key={`hl${hx}`} position={[hx, 0.98, 0.0]}>
            <mesh>
              <ringGeometry args={[0.13, 0.18, 24]} />
              <meshStandardMaterial color={CHROME} metalness={0.95} roughness={0.2} />
            </mesh>
            <mesh position={[0, 0, 0.002]}>
              <circleGeometry args={[0.13, 20]} />
              <meshStandardMaterial color="#fff6dc" emissive="#fff0c8" emissiveIntensity={2.4 * headlight} />
            </mesh>
            <mesh position={[hx > 0 ? 0.26 : -0.26, 0, 0.0]}>
              <boxGeometry args={[0.12, 0.1, 0.01]} />
              <meshStandardMaterial color="#ffb347" emissive="#ff9a1a" emissiveIntensity={0.5} />
            </mesh>
            <pointLight position={[0, 0, 1.4]} color="#fff0c8" intensity={headlight * 1.8} distance={13} />
          </group>
        ))}
        <mesh position={[0, 0.54, -0.04]}>
          <boxGeometry args={[2.46, 0.3, 0.18]} />
          <meshStandardMaterial color={TRIM} metalness={0.4} roughness={0.55} />
        </mesh>
        <mesh position={[0, 0.78, 0.05]}>
          <planeGeometry args={[0.52, 0.12]} />
          <meshStandardMaterial color="#f4f5f0" roughness={0.6} />
        </mesh>
        {/* 사이드미러 */}
        {[-1, 1].map((s) => (
          <group key={`mr${s}`} position={[s * (HW + 0.22), 2.3, -0.35]}>
            <mesh position={[-s * 0.12, 0, 0]}>
              <boxGeometry args={[0.24, 0.03, 0.03]} />
              <meshStandardMaterial color={TRIM} />
            </mesh>
            <mesh>
              <boxGeometry args={[0.06, 0.34, 0.2]} />
              <meshStandardMaterial color={TRIM} metalness={0.3} roughness={0.5} />
            </mesh>
          </group>
        ))}
      </group>

      {/* 뒷면 — 뒷유리, 후미등 클러스터, 범퍼, 배기구 */}
      <group position={[0, 0, -L / 2]} rotation={[0, Math.PI, 0]}>
        <mesh position={[0, 2.15, -0.02]}>
          <planeGeometry args={[2.14, 1.14]} />
          <meshStandardMaterial color={RUBBER} roughness={0.7} />
        </mesh>
        <mesh position={[0, 2.15, 0.0]}>
          <planeGeometry args={[2.0, 1.0]} />
          <meshPhysicalMaterial color={GLASS} metalness={0.85} roughness={0.04} clearcoat={1} transparent opacity={0.9} />
        </mesh>
        {[-0.98, 0.98].map((tx) => (
          <group key={`tl${tx}`} position={[tx, 1.2, 0.01]}>
            <mesh>
              <boxGeometry args={[0.26, 0.56, 0.03]} />
              <meshStandardMaterial color="#1a0b0a" roughness={0.4} />
            </mesh>
            <mesh position={[0, 0.14, 0.018]}>
              <planeGeometry args={[0.2, 0.2]} />
              <meshStandardMaterial color="#ff2a1a" emissive="#ff1a0a" emissiveIntensity={1.6} />
            </mesh>
            <mesh position={[0, -0.1, 0.018]}>
              <planeGeometry args={[0.2, 0.14]} />
              <meshStandardMaterial color="#ffb347" emissive="#ff9a1a" emissiveIntensity={0.4} />
            </mesh>
          </group>
        ))}
        <mesh position={[0, 0.54, -0.04]}>
          <boxGeometry args={[2.46, 0.3, 0.18]} />
          <meshStandardMaterial color={TRIM} metalness={0.4} roughness={0.55} />
        </mesh>
        <mesh position={[0.9, 0.3, 0.02]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.05, 0.05, 0.2, 10]} />
          <meshStandardMaterial color="#555b61" metalness={0.8} roughness={0.5} />
        </mesh>
      </group>

      {/* 지붕 — 에어컨 유닛 + 환기구 */}
      <mesh position={[0, Y1 + 0.1, -0.9]} castShadow>
        <boxGeometry args={[1.7, 0.22, 2.4]} />
        <meshStandardMaterial color={SKIRT} metalness={0.2} roughness={0.5} />
      </mesh>
      <mesh position={[0, Y1 + 0.05, 2.6]}>
        <boxGeometry args={[0.6, 0.1, 0.6]} />
        <meshStandardMaterial color={SKIRT} metalness={0.2} roughness={0.5} />
      </mesh>

      {/* 실내 온광 */}
      <pointLight position={[0, 2.3, 0]} color="#ffe6b0" intensity={0.6} distance={5} />
    </group>
  );
}
