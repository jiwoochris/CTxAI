"use client";

// 반응형 무대 — /film 전용. BlockoutStage의 지형(나무·도로·정류장·카페)을 그대로 쓰되,
// 하늘·태양·환경광·안개·가로등·도로 반사·네온·카페 불빛을 매 프레임 연출 상태에서
// 파생된 파라미터(lib/directionMap.js deriveParams)로 움직인다. React 상태를 거치지
// 않고 ref + useFrame으로 직접 값을 쓴다 — 매 프레임 리렌더를 피하기 위해서다.
//
// 배우(우비 인물·트럭·물보라·고양이·옆사람·버스)는 lib/filmTimeline.js evalActors(t)가
// 준 위치를 그대로 받는다. GLB 에셋이 아직 없어(아트 0/8) 전부 코드 지오메트리다 —
// 사람은 캡슐+구, 우비는 원뿔, 고양이는 상자 두 개. 자리를 잡아 두는 것이 목적이라
// 나중에 GLB가 오면 같은 그룹 안에서 메시만 바꾸면 된다.

import { Suspense, useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF, useAnimations } from "@react-three/drei";
import { Color, Vector3, FogExp2, BackSide, MathUtils, CanvasTexture, SRGBColorSpace } from "three";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { Cypress, RoundPine, Reeds, ForestRing, Shelter, Bench, Cafe } from "./BlockoutStage";
import { deriveParams } from "@/lib/directionMap";

const SKY_VERT = `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
const SKY_FRAG = `
  uniform vec3 topColor; uniform vec3 horizonColor; uniform float cloud;
  varying vec3 vWorld;
  void main() {
    float h = normalize(vWorld).y;
    float t = pow(max(h, 0.0), 0.55);
    vec3 c = mix(horizonColor, topColor, t);
    // 구름 결 — 값이 아니라 인상만. cloud 0(갈라진 하늘)~1(두꺼운 흐림)
    float band = sin(vWorld.x * 0.08 + vWorld.z * 0.05) * 0.5 + 0.5;
    c = mix(c, c * (0.92 + 0.08 * band), cloud);
    gl_FragColor = vec4(c, 1.0);
  }`;

function toColor(arr) { return new Color(arr[0], arr[1], arr[2]); }

function Person({ raincoat = true, tint = "#4a5b6a", head = "#c9b7a3", scale = 1, walking = false, bob = 0, seated = false, lean = 0, gazeRef }) {
  // 걷는 동안 살짝 위아래로 — 다리 애니메이션 대신 존재감만.
  const y = walking ? Math.abs(Math.sin(bob * 7)) * 0.04 : 0;
  const h = seated ? 0.62 : 0.85;
  return (
    <group scale={scale} position={[0, y, 0]} rotation={[0, 0, lean * 0.35]}>
      <mesh position={[0, h, 0]} castShadow>
        <capsuleGeometry args={[0.17, seated ? 0.5 : 0.85, 4, 10]} />
        <meshStandardMaterial color={tint} roughness={0.9} />
      </mesh>
      {raincoat && (
        <mesh position={[0, h + 0.15, 0]} castShadow>
          <coneGeometry args={[0.36, 0.9, 12, 1, true]} />
          <meshStandardMaterial color={tint} roughness={0.75} side={2} />
        </mesh>
      )}
      <group ref={gazeRef} position={[0, h + 0.62, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[0.13, 12, 12]} />
          <meshStandardMaterial color={head} roughness={0.8} />
        </mesh>
        {raincoat && (
          <mesh position={[0, 0.05, -0.02]}>
            <sphereGeometry args={[0.16, 12, 12, 0, Math.PI * 2, 0, Math.PI * 0.62]} />
            <meshStandardMaterial color={tint} roughness={0.85} />
          </mesh>
        )}
      </group>
    </group>
  );
}

// 리깅된 사람 — 시그마인 vr_contents의 Meshy 캐릭터(걷기 클립 1개)를 1K 텍스처 + meshopt로
// 5~7MB까지 줄인 것. public/reactive/models/rigA.glb·rigB.glb. Draco가 아니라 meshopt를 쓴
// 이유는 디코더가 three-stdlib에 내장돼 있어 전시장에서 CDN 없이 돌기 때문이다.
// 앉기 클립이 없어 착석 상태에서는 걷기 클립을 멈춘 자세로 벤치 옆에 선다 — 아트 GLB가
// 오면 이 컴포넌트만 바꾼다. 여러 명이 같은 GLB를 쓰므로 SkeletonUtils.clone 으로 복제한다.
export const RIG_URLS = { A: "/reactive/models/rigA.glb", B: "/reactive/models/rigB.glb" };

function RiggedPerson({ rig = "A", walking = false, scale = 1, facing = 0 }) {
  const { scene, animations } = useGLTF(RIG_URLS[rig] || RIG_URLS.A, false, true);
  const model = useMemo(() => {
    const c = skeletonClone(scene);
    c.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    return c;
  }, [scene]);
  const { actions } = useAnimations(animations, model);
  useEffect(() => {
    const name = Object.keys(actions)[0];
    const a = name ? actions[name] : null;
    if (!a) return;
    if (walking) { a.paused = false; a.reset().fadeIn(0.2).play(); }
    else { a.play(); a.paused = true; a.time = 0.35; }
    return () => { a.fadeOut(0.2); };
  }, [actions, walking]);
  return <primitive object={model} scale={scale} rotation={[0, facing, 0]} />;
}

// 정류장 이름 표지판 — 요청서 v5.0 §2.6 "관객이 말한 단어를 정류장 이름 자리에 실시간으로 써 넣는다".
// 글자 값은 D5 그대로: 색 #F5F2E8, Pretendard Bold, 글자 높이 = 이름 자리 판 높이의 45%.
function SignBoard({ text = "호수공원 입구", position = [-0.62, 1.74, -1.03] }) {
  const texture = useMemo(() => {
    if (typeof document === "undefined") return null;
    const W = 1024, H = 256;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d");
    g.fillStyle = "#16191d"; g.fillRect(0, 0, W, H);
    g.fillStyle = "#2a2f36"; g.fillRect(0, H - 14, W, 14);
    g.fillStyle = "#F5F2E8";
    g.font = `bold ${Math.round(H * 0.45)}px Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, W / 2, H / 2 - 4);
    g.font = `${Math.round(H * 0.13)}px Pretendard, "Apple SD Gothic Neo", sans-serif`;
    g.fillStyle = "rgba(245,242,232,0.55)";
    g.fillText("272", W - 90, H - 44);
    const tx = new CanvasTexture(c); tx.colorSpace = SRGBColorSpace; tx.anisotropy = 4;
    return tx;
  }, [text]);
  if (!texture) return null;
  return (
    <group position={position}>
      <mesh>
        <planeGeometry args={[0.8, 0.2]} />
        <meshStandardMaterial map={texture} emissiveMap={texture} emissive="#ffffff" emissiveIntensity={0.35} />
      </mesh>
      <mesh position={[0, 0, -0.012]}>
        <boxGeometry args={[0.84, 0.24, 0.02]} />
        <meshStandardMaterial color="#22252b" />
      </mesh>
    </group>
  );
}

function Truck({ x, z }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.7, 0]} castShadow>
        <boxGeometry args={[1.7, 0.9, 3.6]} />
        <meshStandardMaterial color="#8d9aa6" />
      </mesh>
      <mesh position={[0, 1.15, 1.1]} castShadow>
        <boxGeometry args={[1.6, 0.8, 1.3]} />
        <meshStandardMaterial color="#d8dde3" />
      </mesh>
      {[[-0.7, -1.2], [0.7, -1.2], [-0.7, 1.1], [0.7, 1.1]].map(([dx, dz], i) => (
        <mesh key={i} position={[dx, 0.3, dz]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.3, 0.3, 0.2, 10]} />
          <meshStandardMaterial color="#1a1c1f" />
        </mesh>
      ))}
      <pointLight position={[0, 0.7, 2]} color="#ffe9c0" intensity={0.8} distance={5} />
    </group>
  );
}

function Splash({ p }) {
  // 0~1 — 물보라가 관객 쪽으로 부채꼴처럼 튀어 오르는 순간
  const drops = useMemo(() => Array.from({ length: 14 }, (_, i) => ({ a: (i / 14) * Math.PI * 0.9 - Math.PI * 0.45, s: 0.6 + (i % 4) * 0.25 })), []);
  const spread = p * 1.4;
  const yArc = Math.sin(Math.min(1, p) * Math.PI) * 0.9;
  return (
    <group position={[1.0, 0.05, -0.6]}>
      {drops.map((d, i) => (
        <mesh key={i} position={[-Math.sin(d.a) * spread * d.s, yArc * d.s, -Math.cos(d.a) * spread * d.s * 0.4]}>
          <sphereGeometry args={[0.035 * (1 - p * 0.5), 6, 6]} />
          <meshStandardMaterial color="#c9d6dc" transparent opacity={Math.max(0, 0.9 - p)} />
        </mesh>
      ))}
    </group>
  );
}

function Cat({ x, z, running, facingBench, bob }) {
  const rot = facingBench ? Math.PI * 0.8 : running && x > 0.9 ? -Math.PI / 2 - 0.4 : Math.PI / 2 + 0.2;
  const y = running ? Math.abs(Math.sin(bob * 14)) * 0.06 : 0;
  return (
    <group position={[x, y, z]} rotation={[0, rot, 0]}>
      <mesh position={[0, 0.16, 0]} castShadow>
        <boxGeometry args={[0.16, 0.16, 0.42]} />
        <meshStandardMaterial color="#2a2623" />
      </mesh>
      <mesh position={[0, 0.27, 0.22]} castShadow>
        <boxGeometry args={[0.14, 0.13, 0.14]} />
        <meshStandardMaterial color="#2a2623" />
      </mesh>
      {[-0.045, 0.045].map((dx) => (
        <mesh key={dx} position={[dx, 0.36, 0.22]}>
          <coneGeometry args={[0.03, 0.06, 4]} />
          <meshStandardMaterial color="#2a2623" />
        </mesh>
      ))}
      {[-0.04, 0.04].map((dx) => (
        <mesh key={`e${dx}`} position={[dx, 0.28, 0.295]}>
          <sphereGeometry args={[0.014, 6, 6]} />
          <meshStandardMaterial color="#d8ff8a" emissive="#b8ff60" emissiveIntensity={1.2} />
        </mesh>
      ))}
    </group>
  );
}

function Bus({ x, z, headlight, doorOpen }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 1.6, 0]} castShadow>
        <boxGeometry args={[2.4, 2.6, 10]} />
        <meshStandardMaterial color="#3b6ea5" />
      </mesh>
      <mesh position={[-1.21, 1.9, 0]}>
        <boxGeometry args={[0.02, 1.0, 9.2]} />
        <meshPhysicalMaterial color="#cfe6ff" emissive="#ffe6b0" emissiveIntensity={0.35} transparent opacity={0.7} />
      </mesh>
      <mesh position={[-1.21, 0.9, 2.2]}>
        <boxGeometry args={[0.03, 1.8, doorOpen ? 0.1 : 1.0]} />
        <meshStandardMaterial color="#1c2a3a" />
      </mesh>
      <mesh position={[0, 2.55, 4.99]}>
        <planeGeometry args={[1.6, 0.35]} />
        <meshStandardMaterial color="#ff9a3d" emissive="#ff9a3d" emissiveIntensity={1.5} />
      </mesh>
      {[-0.8, 0.8].map((dx) => (
        <group key={dx}>
          <mesh position={[dx, 0.8, 5.01]}>
            <circleGeometry args={[0.16, 12]} />
            <meshStandardMaterial color="#fff6dc" emissive="#fff0c8" emissiveIntensity={2.2 * headlight} />
          </mesh>
          <pointLight position={[dx, 0.8, 6.5]} color="#fff0c8" intensity={headlight * 1.6} distance={12} />
        </group>
      ))}
      <pointLight position={[0, 1.8, 0]} color="#ffe6b0" intensity={0.5} distance={4} />
    </group>
  );
}

/**
 * @param {object} props
 * @param {React.MutableRefObject} props.directionRef  createDirectionState() 의 반환값
 * @param {React.MutableRefObject} props.actorsRef     evalActors() 결과 (디렉터가 매 프레임 갱신)
 * @param {string|null} props.dominant                 앉는 인물 R/H/C
 * @param {React.MutableRefObject} [props.paramsOut]   파생 파라미터를 밖(HUD)에 노출
 */
export default function ReactiveStage({ directionRef, actorsRef, dominant, paramsOut, useRig = true, rigTest = false, signText }) {
  const { scene, camera } = useThree();
  const skyMat = useRef();
  const sun = useRef();
  const hemi = useRef();
  const amb = useRef();
  const roadMat = useRef();
  const lampBulb = useRef();
  const lampLight = useRef();
  const lampBulb2 = useRef();
  const lampLight2 = useRef();
  const cafeGlow = useRef();
  const cafeLight = useRef();
  const npcGaze = useRef();
  const npcGroup = useRef();
  const fadeMat = useRef();
  const posterRef = useRef();

  const fog = useMemo(() => new FogExp2("#8f96a3", 0.03), []);
  // uniforms 객체는 한 번만 만든다 — 매 렌더 새 객체를 주면 R3F가 머티리얼 uniforms를
  // 초기값으로 되돌려서 useFrame에서 쓴 색이 250ms마다 리셋된다.
  const skyUniforms = useMemo(() => ({ topColor: { value: new Color(0.47, 0.5, 0.56) }, horizonColor: { value: new Color(0.66, 0.68, 0.71) }, cloud: { value: 0.6 } }), []);
  const tmpA = useMemo(() => new Vector3(), []);
  const tmpB = useMemo(() => new Vector3(), []);

  useFrame((_, dt) => {
    const d = directionRef.current;
    if (!d) return;
    const st = d.st;
    const p = deriveParams(st.current, st.settled);
    if (paramsOut) paramsOut.current = p;
    const actors = actorsRef.current || {};

    // 하늘·안개
    if (skyMat.current) {
      skyMat.current.uniforms.topColor.value.setRGB(p.skyTop[0], p.skyTop[1], p.skyTop[2]);
      skyMat.current.uniforms.horizonColor.value.setRGB(p.skyHorizon[0], p.skyHorizon[1], p.skyHorizon[2]);
      skyMat.current.uniforms.cloud.value = MathUtils.clamp(1 - p.sunIntensity / 1.4, 0, 1);
    }
    if (!scene.fog) scene.fog = fog;
    fog.color.setRGB(p.fogColor[0], p.fogColor[1], p.fogColor[2]);
    fog.density = p.fogDensity;
    if (scene.background?.isColor) scene.background.setRGB(p.skyHorizon[0], p.skyHorizon[1], p.skyHorizon[2]);
    else scene.background = new Color(p.skyHorizon[0], p.skyHorizon[1], p.skyHorizon[2]);

    // 태양 — 고도·방위·세기·색. 그림자 세기는 태양 대 환경광 비로 나타난다.
    if (sun.current) {
      const el = MathUtils.degToRad(p.sunElevation);
      const az = MathUtils.degToRad(p.sunAzimuth);
      sun.current.position.set(Math.sin(az) * Math.cos(el) * 12, Math.sin(el) * 12, -Math.cos(az) * Math.cos(el) * 12);
      sun.current.color.setRGB(p.sunColor[0], p.sunColor[1], p.sunColor[2]);
      sun.current.intensity = p.sunIntensity * (0.35 + 0.65 * p.shadow);
      sun.current.castShadow = p.shadow > 0.05;
    }
    if (hemi.current) {
      hemi.current.color.setRGB(p.hemiSky[0], p.hemiSky[1], p.hemiSky[2]);
      hemi.current.groundColor.setRGB(p.hemiGround[0], p.hemiGround[1], p.hemiGround[2]);
      hemi.current.intensity = p.hemiIntensity + (1 - p.shadow) * 0.25;
    }
    if (amb.current) {
      amb.current.color.setRGB(p.ambientColor[0], p.ambientColor[1], p.ambientColor[2]);
      amb.current.intensity = p.ambientIntensity;
    }
    if (roadMat.current) {
      roadMat.current.color.setRGB(p.roadColor[0], p.roadColor[1], p.roadColor[2]);
      roadMat.current.roughness = 1 - p.roadGloss * 0.85;
      roadMat.current.metalness = p.roadGloss * 0.35;
    }
    // 가로등 — 정류장 뒤(공포 트랙 "아직 오후인데도 소리 없이 켜진다")
    const lampI = p.lampOn;
    if (lampBulb.current) lampBulb.current.emissiveIntensity = 0.1 + lampI * 1.6;
    if (lampLight.current) lampLight.current.intensity = lampI * 0.9;
    if (lampBulb2.current) lampBulb2.current.emissiveIntensity = 0.1 + lampI * 1.4;
    if (lampLight2.current) lampLight2.current.intensity = lampI * 0.7;
    if (cafeGlow.current) cafeGlow.current.emissiveIntensity = 0.25 + p.cafeGlow * 0.9;
    if (cafeLight.current) cafeLight.current.intensity = p.cafeGlow * 0.8;

    // 옆사람 시선 — 시선 접촉률만큼 관객(카메라)을 향해 고개를 돌린다.
    if (npcGaze.current && npcGroup.current && actors.npc?.visible) {
      npcGaze.current.getWorldPosition(tmpA);
      tmpB.copy(camera.position).sub(tmpA);
      const targetYaw = Math.atan2(tmpB.x, tmpB.z) - npcGroup.current.rotation.y;
      const gazeYaw = MathUtils.lerp(0, targetYaw, p.npcGaze);
      const sway = Math.sin(st.elapsed * 1.7) * 0.08 * p.npcSway;
      npcGaze.current.rotation.y += (gazeYaw + sway - npcGaze.current.rotation.y) * Math.min(1, dt * 3);
      if (useRig && actors.npc.seated) {
        // 리깅 캐릭터: 몸 전체를 시선 접촉률만큼 관객 쪽으로. 0.15(기본) ↔ 관객을 정면으로 보는 각도.
        const bodyTarget = MathUtils.lerp(0.1, Math.PI / 2 * 0.9, p.npcGaze) + sway;
        npcGroup.current.rotation.y += (bodyTarget - npcGroup.current.rotation.y) * Math.min(1, dt * 1.5);
      }
    }
    if (posterRef.current) posterRef.current.rotation.z = 0.06 + (actors.posterFlutter || 0) * 0.35;
    if (fadeMat.current) fadeMat.current.opacity = actors.fade || 0;
  });

  const actors = actorsRef.current || {};
  const npcTint = dominant === "H" ? "#4b5a67" : dominant === "C" ? "#6b5a4a" : "#5d6f82";
  const npcHead = dominant === "C" ? "#d9c7b0" : "#cbb8a2";

  return (
    <>
      <mesh scale={[60, 60, 60]}>
        <sphereGeometry args={[1, 24, 16]} />
        <shaderMaterial
          ref={skyMat}
          side={BackSide}
          depthWrite={false}
          vertexShader={SKY_VERT}
          fragmentShader={SKY_FRAG}
          uniforms={skyUniforms}
        />
      </mesh>

      <ambientLight ref={amb} intensity={0.7} />
      <hemisphereLight ref={hemi} intensity={0.35} />
      <directionalLight ref={sun} position={[3, 6, 2]} intensity={0.65} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />

      {/* 도로 — 색·광택이 상태를 따른다 (로맨스 "젖은 도로 전체가 금빛으로") */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[2.4, 0, -10]} receiveShadow>
        <planeGeometry args={[8, 40]} />
        <meshStandardMaterial ref={roadMat} color="#3f4247" roughness={0.6} metalness={0.15} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-0.6, 0.01, -6]} receiveShadow>
        <planeGeometry args={[2.2, 20]} />
        <meshStandardMaterial color="#5c5c58" />
      </mesh>
      {[-0.06, 0.06].map((dx) => (
        <mesh key={dx} rotation={[-Math.PI / 2, 0, 0]} position={[2.4 + dx, 0.015, -12]}>
          <planeGeometry args={[0.04, 34]} />
          <meshStandardMaterial color="#e0b840" />
        </mesh>
      ))}
      {[0.35, 4.45].map((laneX) =>
        Array.from({ length: 10 }, (_, i) => (
          <mesh key={`${laneX}-${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[laneX, 0.015, -1.5 - i * 2.2]}>
            <planeGeometry args={[0.08, 1.1]} />
            <meshStandardMaterial color="#d8d8d0" />
          </mesh>
        ))
      )}
      {/* 횡단보도 — 신호등 없는 (v1.1) */}
      {Array.from({ length: 7 }, (_, i) => (
        <mesh key={`cw${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[-1.2 + i * 1.2, 0.016, -4.2]}>
          <planeGeometry args={[0.5, 1.6]} />
          <meshStandardMaterial color="#cfcfc6" />
        </mesh>
      ))}
      {/* 물웅덩이 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[1.0, 0.012, -0.8]}>
        <circleGeometry args={[0.7, 16]} />
        <meshPhysicalMaterial color="#5a6670" roughness={0.05} metalness={0.4} transparent opacity={0.75} />
      </mesh>

      <Shelter mood={{ neon: "#ff9a3d" }} />
      <SignBoard text={signText || "호수공원 입구"} />
      <Bench />
      {/* 포스터 — Shelter 안의 것 위에 파닥이는 별도 면을 겹친다 */}
      <mesh ref={posterRef} position={[0.93, 1.25, -0.55]} rotation={[0, -Math.PI / 2, 0.06]}>
        <planeGeometry args={[0.32, 0.44]} />
        <meshStandardMaterial color="#e8e2d0" side={2} />
      </mesh>

      {/* 카페 — 창 불빛이 상태를 따른다 */}
      <group position={[-9, 0, -12]}>
        <mesh position={[0, 1.1, 0]} castShadow receiveShadow>
          <boxGeometry args={[2.8, 2.1, 2.2]} />
          <meshStandardMaterial color="#2a2622" />
        </mesh>
        <mesh position={[0, 1.05, 1.11]}>
          <planeGeometry args={[2.3, 1.3]} />
          <meshStandardMaterial ref={cafeGlow} color="#ff8a5c" emissive="#ff6a3c" emissiveIntensity={0.9} />
        </mesh>
        <mesh position={[0, 2.3, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
          <coneGeometry args={[2.1, 0.7, 4]} />
          <meshStandardMaterial color="#1c1a17" />
        </mesh>
        <pointLight ref={cafeLight} position={[0, 1.2, 1.5]} color="#ff8a5c" intensity={0.7} distance={5} />
      </group>

      {/* 풀숲·나무 — BlockoutStage 배치 그대로 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.6, 0.02, 1.9]} receiveShadow>
        <planeGeometry args={[7, 1]} />
        <meshStandardMaterial color="#3a4a36" />
      </mesh>
      <Reeds position={[-2.2, 0, 1.85]} count={6} />
      <Reeds position={[-0.6, 0, 1.9]} count={7} />
      <Reeds position={[1.0, 0, 1.88]} count={6} />
      <Reeds position={[2.6, 0, 1.92]} count={7} />
      <Reeds position={[1.9, 0, 1.9]} count={5} />
      {Array.from({ length: 4 }, (_, i) => (
        <RoundPine key={`bg${i}`} position={[-3 + i * 2, 0, 3.4 + (i % 2) * 0.5]} scale={0.9 + i * 0.08} />
      ))}
      <Reeds position={[6.6, 0, -1.8]} count={5} />
      <Reeds position={[6.9, 0, -3.2]} count={6} />
      <Reeds position={[6.5, 0, -4.6]} count={5} />
      {[[7.2, -2.2, 6.5, -0.04], [7.6, -4.4, 7.5, 0.03], [7.1, -6.6, 6.0, -0.02], [7.8, -9.2, 8.5, 0.05], [7.3, -12.0, 7.0, -0.03], [8.1, -15.5, 9.0, 0.02]].map(([x, z, h, lean], i) => (
        <Cypress key={i} position={[x, 0, z]} height={h} lean={lean} />
      ))}
      <RoundPine position={[6.8, 0, -5.6]} scale={1.1} />
      <RoundPine position={[7.5, 0, -10.4]} scale={1.3} />
      {[-1.6, -2.0, -1.4].map((x, i) => (
        <Cypress key={`l${i}`} position={[x, 0, -1.2 - i * 2.4]} height={5 + i * 0.8} lean={(i - 1) * 0.03} />
      ))}
      {[-2.5, -0.5, 1.5, 3.5].map((x, i) => (
        <RoundPine key={`b${i}`} position={[x, 0, 2.6 + (i % 2) * 0.6]} scale={1.0 + i * 0.08} />
      ))}
      <ForestRing radius={13} count={22} />

      {/* 가로등 2개 — 정류장 뒤(공포 트리거)와 도로 건너 */}
      <group position={[1.4, 0, 1.4]}>
        <mesh position={[0, 1.5, 0]} castShadow>
          <cylinderGeometry args={[0.04, 0.05, 3, 8]} />
          <meshStandardMaterial color="#33363c" />
        </mesh>
        <mesh position={[0, 2.9, -0.3]}>
          <sphereGeometry args={[0.09, 8, 8]} />
          <meshStandardMaterial ref={lampBulb} color="#fff2c0" emissive="#fff2c0" emissiveIntensity={0.1} />
        </mesh>
        <pointLight ref={lampLight} position={[0, 2.9, -0.3]} color="#ffedb0" intensity={0} distance={5} />
      </group>
      <group position={[6.3, 0, -6]}>
        <mesh position={[0, 1.5, 0]} castShadow>
          <cylinderGeometry args={[0.04, 0.05, 3, 8]} />
          <meshStandardMaterial color="#33363c" />
        </mesh>
        <mesh position={[0, 2.9, 0.42]}>
          <sphereGeometry args={[0.09, 8, 8]} />
          <meshStandardMaterial ref={lampBulb2} color="#fff2c0" emissive="#fff2c0" emissiveIntensity={0.1} />
        </mesh>
        <pointLight ref={lampLight2} position={[0, 2.9, 0.42]} color="#ffedb0" intensity={0} distance={5} />
      </group>

      {/* 리깅 캐릭터 점검용 (?rigtest=1): 두 캐릭터를 관객 정면 3m에 세워 로딩·크기·방향을 확인한다 */}
      {rigTest && (
        <Suspense fallback={null}>
          <group position={[-0.7, 0, -3]}><RiggedPerson rig="A" walking facing={0} /></group>
          <group position={[0.7, 0, -3]}><RiggedPerson rig="B" walking={false} facing={0} /></group>
        </Suspense>
      )}
      {/* ---- 배우 ---- */}
      {actors.figure?.visible && (
        <group position={[actors.figure.x, 0, actors.figure.z]} rotation={[0, 0.7, 0]}>
          {useRig ? (
            <Suspense fallback={<Person raincoat tint="#5d6f82" walking={actors.figure.walking} bob={actors.figure.bob} scale={0.95} />}>
              <RiggedPerson rig="A" walking={actors.figure.walking} scale={0.98} facing={0} />
            </Suspense>
          ) : (
            <Person raincoat tint="#5d6f82" walking={actors.figure.walking} bob={actors.figure.bob} scale={0.95} />
          )}
        </group>
      )}
      {actors.truck?.visible && <Truck x={actors.truck.x} z={actors.truck.z} />}
      {actors.splash != null && <Splash p={actors.splash} />}
      {actors.cat?.visible && <Cat {...actors.cat} />}
      {actors.npc?.visible && (
        <group ref={npcGroup} position={[actors.npc.x, 0, actors.npc.z]} rotation={[0, actors.npc.seated ? 0.15 : -Math.PI * 0.45, 0]}>
          {useRig ? (
            <Suspense fallback={<Person raincoat={dominant !== "C"} tint={npcTint} head={npcHead} walking={actors.npc.walking} seated={actors.npc.seated} bob={actors.npc.bob} gazeRef={npcGaze} />}>
              {/* 시선 접촉률은 몸 전체가 관객 쪽으로 도는 정도로 나타낸다 — 착석 상태에선 관객(-x 쪽)을 향하는 각도가 -π/2 */}
              <group ref={npcGaze} position={[0, 1.55, 0]} />
              <RiggedPerson rig={dominant === "H" ? "A" : "B"} walking={actors.npc.walking} scale={dominant === "C" ? 0.9 : 1.0} facing={actors.npc.seated ? Math.PI : Math.PI * 0.8} />
            </Suspense>
          ) : (
          <Person
            raincoat={dominant !== "C"}
            tint={npcTint}
            head={npcHead}
            walking={actors.npc.walking}
            seated={actors.npc.seated}
            bob={actors.npc.bob}
            lean={paramsOut?.current?.npcLean || 0}
            gazeRef={npcGaze}
          />
          )}
          {dominant === "C" && (
            <mesh position={[0.25, 0.45, 0.1]} rotation={[0, 0, -0.2]}>
              <cylinderGeometry args={[0.012, 0.012, 0.9, 6]} />
              <meshStandardMaterial color="#3b2a1a" />
            </mesh>
          )}
        </group>
      )}
      {actors.bus?.visible && <Bus {...actors.bus} />}

      {/* 암전 — 카메라 앞에 붙는 검은 판 */}
      <mesh position={[0, 1.15, -0.6]} renderOrder={999}>
        <planeGeometry args={[6, 4]} />
        <meshBasicMaterial ref={fadeMat} color="#000" transparent opacity={0} depthTest={false} />
      </mesh>
    </>
  );
}
