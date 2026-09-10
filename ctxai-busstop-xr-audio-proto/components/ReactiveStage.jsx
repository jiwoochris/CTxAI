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
import { useFrame, useThree, useLoader } from "@react-three/fiber";
import { useGLTF, useAnimations, MeshReflectorMaterial } from "@react-three/drei";
import { Color, Vector3, FogExp2, BackSide, MathUtils, CanvasTexture, SRGBColorSpace, PMREMGenerator } from "three";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { Cypress, RoundPine, Reeds, ForestRing, Shelter, Bench, Cafe } from "./BlockoutStage";
import { deriveParams } from "@/lib/directionMap";

// HDRI 하늘 — PolyHaven(CC0) 순수 하늘 세 장을 연출 상태 가중치로 섞어 그린다.
//   R: evening_road_01_puresky (낮은 저녁 해, 젖은 도로가 금빛으로)
//   H: kloofendal_overcast_puresky (두꺼운 구름; 노출을 낮춰 "대낮의 어둠")
//   C: overcast_soil_puresky (균일하게 밝은 흐림)
// 중립(정착 0)은 H 텍스처를 보통 노출로 쓴다 — 소나기 뒤의 흐린 오후.
export const HDRI = {
  R: "/reactive/hdri/evening_road_01_puresky_2k.hdr",
  H: "/reactive/hdri/kloofendal_overcast_puresky_2k.hdr",
  C: "/reactive/hdri/overcast_soil_puresky_2k.hdr",
};
const SKY_VERT = `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
const SKY_FRAG = `
  uniform sampler2D texR; uniform sampler2D texH; uniform sampler2D texC;
  uniform vec3 weights;   // R,H,C (합 1)
  uniform vec3 exposures; // 장르별 노출
  uniform float rotation; // 해의 방위를 장면에 맞추는 회전(라디안)
  uniform vec3 hazeColor; uniform float haze;
  varying vec3 vWorld;
  #define RECIPROCAL_PI 0.3183098861837907
  #define RECIPROCAL_PI2 0.15915494309189535
  vec2 equirect(vec3 dir) {
    float u = atan(dir.z, dir.x) * RECIPROCAL_PI2 + 0.5;
    float v = asin(clamp(dir.y, -1.0, 1.0)) * RECIPROCAL_PI + 0.5;
    return vec2(u, v);
  }
  void main() {
    vec3 dir = normalize(vWorld);
    float c = cos(rotation), s = sin(rotation);
    vec3 rd = vec3(c * dir.x - s * dir.z, dir.y, s * dir.x + c * dir.z);
    vec2 uv = equirect(rd);
    vec3 col = texture2D(texR, uv).rgb * weights.x * exposures.x
             + texture2D(texH, uv).rgb * weights.y * exposures.y
             + texture2D(texC, uv).rgb * weights.z * exposures.z;
    // 지평선 부근에 안개색을 섞어 지형의 안개와 이어지게 한다
    float h = smoothstep(0.35, 0.0, dir.y);
    col = mix(col, hazeColor * max(0.35, dot(col, vec3(0.33))), h * haze);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
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

// PolyHaven(CC0) 소품 — 실제 크기(미터)로 모델링돼 있고 원점이 바닥 중앙이라 그대로 놓는다.
// (자동 맞춤을 시도했더니 KHR_mesh_quantization 정규화 좌표와 Box3 계산이 어긋나 거대해졌다.)
function Prop({ url, scale = 1, position = [0, 0, 0], rotation = [0, 0, 0], castShadow = true, only = null }) {
  const { scene } = useGLTF(url, false, true);
  const model = useMemo(() => {
    const c = scene.clone(true);
    c.traverse((o) => {
      if (/LOD[1-9]/.test(o.name)) o.visible = false; // PolyHaven 키트는 LOD 단계가 겹쳐 들어 있다 — LOD0 만 남긴다
      if (only && o.parent === c && !only.test(o.name)) o.visible = false; // 키트(a/b/c…) 중 한 변형만
      if (o.isMesh) { o.castShadow = castShadow; o.receiveShadow = true; }
    });
    if (only) {
      // 남긴 변형을 원점으로 당긴다 (키트는 변형들이 x 축으로 늘어서 있다)
      const kept = c.children.find((o) => o.visible);
      if (kept) { c.children.forEach((o) => { if (o !== kept) c.remove(o); }); kept.position.x = 0; kept.position.z = 0; }
    }
    return c;
  }, [scene, castShadow, only]);
  return <primitive object={model} position={position} rotation={rotation} scale={scale} />;
}

// 침엽수 — PolyHaven 묘목(fir_sapling / pine_sapling_small)을 4~6배로 키워 숲을 만든다.
// 텍스처 밀도는 거칠어지지만 원뿔보다 훨씬 낫고, 멀리 있어 티가 덜 난다.
const FIR_RE = /fir_sapling_a/;
const PINE_RE = /pine_sapling_small_a/;
function RealTree({ kind = "fir", position, scale = 5, yaw = 0 }) {
  const url = kind === "fir" ? "/reactive/models/props/fir_sapling.glb" : "/reactive/models/props/pine_sapling_small.glb";
  return <Prop url={url} only={kind === "fir" ? FIR_RE : PINE_RE} position={position} rotation={[0, yaw, 0]} scale={scale} />;
}
function RealForest({ radius = 13, count = 22 }) {
  const trees = useMemo(() => Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2;
    const r = radius + ((i * 37) % 7) * 0.5;
    return { x: Math.sin(angle) * r, z: -Math.cos(angle) * r, kind: i % 3 === 0 ? "pine" : "fir", scale: 4.6 + ((i * 13) % 5) * 0.45, yaw: (i * 1.7) % (Math.PI * 2) };
  }), [radius, count]);
  // 근거리 나무는 관객의 시야를 가리지 않게 정류장에서 3m 이상 떨어뜨린다 (가지 끝이 얼굴에 닿지 않도록).
  const side = [
    [7.6, -2.6, 5.2, "fir"], [8.2, -4.8, 5.8, "pine"], [7.6, -7.0, 4.9, "fir"], [8.4, -9.6, 6.4, "fir"], [7.9, -12.4, 5.5, "pine"], [8.6, -15.8, 6.8, "fir"],
    [-3.6, -2.0, 4.4, "fir"], [-4.2, -4.6, 5.0, "pine"], [-3.4, -7.4, 5.6, "fir"],
    [-3.8, 5.2, 4.2, "pine"], [-1.0, 6.0, 4.6, "fir"], [1.8, 5.4, 4.3, "fir"], [4.4, 6.0, 4.8, "pine"],
    [7.4, -5.9, 3.6, "pine"], [8.0, -10.8, 4.0, "pine"],
  ];
  return (
    <>
      {trees.map((t, i) => <RealTree key={`r${i}`} kind={t.kind} position={[t.x, 0, t.z]} scale={t.scale} yaw={t.yaw} />)}
      {side.map(([x, z, s, k], i) => <RealTree key={`s${i}`} kind={k} position={[x, 0, z]} scale={s} yaw={(i * 2.3) % 6.28} />)}
    </>
  );
}

// HDRI 로더 — 세 장을 한 번에 읽고, PMREM(환경광 맵)도 만들어 부모에게 넘긴다.
function SkyDome({ skyMat, envOut }) {
  const { gl } = useThree();
  const [texR, texH, texC] = useLoader(RGBELoader, [HDRI.R, HDRI.H, HDRI.C]);
  const uniforms = useMemo(() => ({
    texR: { value: texR }, texH: { value: texH }, texC: { value: texC },
    weights: { value: new Vector3(0, 1, 0) }, exposures: { value: new Vector3(1, 0.75, 1) },
    rotation: { value: 0 }, hazeColor: { value: new Color(0.56, 0.59, 0.64) }, haze: { value: 0.6 },
  }), [texR, texH, texC]);
  useEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    pmrem.compileEquirectangularShader();
    const maps = { R: pmrem.fromEquirectangular(texR).texture, H: pmrem.fromEquirectangular(texH).texture, C: pmrem.fromEquirectangular(texC).texture };
    envOut.current = maps;
    return () => { Object.values(maps).forEach((m) => m.dispose()); pmrem.dispose(); };
  }, [gl, texR, texH, texC, envOut]);
  return (
    <mesh scale={[80, 80, 80]}>
      <sphereGeometry args={[1, 32, 20]} />
      <shaderMaterial ref={skyMat} side={BackSide} depthWrite={false} vertexShader={SKY_VERT} fragmentShader={SKY_FRAG} uniforms={uniforms} />
    </mesh>
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
export default function ReactiveStage({ directionRef, actorsRef, dominant, paramsOut, useRig = true, rigTest = false, signText, reflect = true, benchYaw = 0 }) {
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
  const envMaps = useRef(null);
  const envKey = useRef(null);
  const tmpA = useMemo(() => new Vector3(), []);
  const tmpB = useMemo(() => new Vector3(), []);

  useFrame((_, dt) => {
    const d = directionRef.current;
    if (!d) return;
    const st = d.st;
    const p = deriveParams(st.current, st.settled);
    if (paramsOut) paramsOut.current = p;
    const actors = actorsRef.current || {};

    // 하늘 — HDRI 세 장을 상태 가중치로 섞는다. 정착 0 이면 중립(H 텍스처, 보통 노출).
    const sett = st.settled;
    const wR = st.current.R * sett, wH = st.current.H * sett + (1 - sett), wC = st.current.C * sett;
    if (skyMat.current?.uniforms?.weights) {
      const u = skyMat.current.uniforms;
      u.weights.value.set(wR, wH, wC);
      u.exposures.value.set(p.skyExposureR, p.skyExposureH, p.skyExposureC);
      u.rotation.value = MathUtils.degToRad(p.sunAzimuth + 90);
      u.hazeColor.value.setRGB(p.fogColor[0], p.fogColor[1], p.fogColor[2]);
      u.haze.value = MathUtils.clamp(p.fogDensity * 7, 0.1, 0.55);
    }
    if (!scene.fog) scene.fog = fog;
    fog.color.setRGB(p.fogColor[0], p.fogColor[1], p.fogColor[2]);
    fog.density = p.fogDensity;
    scene.background = null;
    // 환경광 — 우세 장르(정착 전엔 H)의 PMREM 을 쓰고 세기만 상태로 보간한다.
    if (envMaps.current) {
      const key = sett < 0.35 ? "H" : ["R", "H", "C"].sort((a, b) => st.current[b] - st.current[a])[0];
      if (envKey.current !== key) { scene.environment = envMaps.current[key]; envKey.current = key; }
      scene.environmentIntensity = p.envIntensity;
    }

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
      roadMat.current.metalness = p.roadGloss * 0.3;
      if ("mixStrength" in roadMat.current) roadMat.current.mixStrength = 0.25 + p.roadGloss * 1.4;
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
      <Suspense fallback={null}>
        <SkyDome skyMat={skyMat} envOut={envMaps} />
      </Suspense>

      <ambientLight ref={amb} intensity={0.7} />
      <hemisphereLight ref={hemi} intensity={0.35} />
      <directionalLight
        ref={sun} position={[3, 6, 2]} intensity={0.65} castShadow
        shadow-mapSize-width={2048} shadow-mapSize-height={2048} shadow-bias={-0.0004} shadow-normalBias={0.02}
        shadow-camera-left={-14} shadow-camera-right={14} shadow-camera-top={14} shadow-camera-bottom={-14} shadow-camera-near={1} shadow-camera-far={40}
      />

      {/* 도로 — 색·광택이 상태를 따른다 (로맨스 "젖은 도로 전체가 금빛으로") */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[2.4, 0, -10]} receiveShadow>
        <planeGeometry args={[8, 40]} />
        {reflect ? (
          <MeshReflectorMaterial
            ref={roadMat} color="#3f4247" roughness={0.6} metalness={0.15}
            blur={[420, 140]} resolution={640} mixBlur={1} mixStrength={0.8} mixContrast={1} mirror={0.4}
            depthScale={0.8} minDepthThreshold={0.85} maxDepthThreshold={1.3} depthToBlurRatioBias={0.25}
          />
        ) : (
          <meshStandardMaterial ref={roadMat} color="#3f4247" roughness={0.6} metalness={0.15} />
        )}
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
      <Suspense fallback={<Bench />}>
        <Prop url="/reactive/models/props/painted_wooden_bench.glb" scale={1.2} position={[0, 0, 0.42]} rotation={[0, benchYaw, 0]} />
        <Prop url="/reactive/models/props/metal_trash_can.glb" position={[1.35, 0, -0.9]} />
        <Prop url="/reactive/models/props/shrub_02.glb" position={[-1.0, 0, 2.2]} />
        <Prop url="/reactive/models/props/shrub_02.glb" position={[5.2, 0, -3.0]} rotation={[0, 1.4, 0]} />
        <Prop url="/reactive/models/props/grass_medium_01.glb" position={[-1.2, 0, -2.6]} castShadow={false} />
        <Prop url="/reactive/models/props/grass_medium_01.glb" position={[6.6, 0, -4.2]} rotation={[0, 0.8, 0]} castShadow={false} />
        <Prop url="/reactive/models/props/grass_medium_01.glb" position={[0.4, 0, 2.6]} rotation={[0, 2.4, 0]} castShadow={false} />
      </Suspense>
      {/* 포스터 — Shelter 안의 것 위에 파닥이는 별도 면을 겹친다 */}
      <mesh ref={posterRef} position={[0.93, 1.25, -0.55]} rotation={[0, -Math.PI / 2, 0.06]}>
        <planeGeometry args={[0.32, 0.44]} />
        <meshStandardMaterial color="#e8e2d0" side={2} />
      </mesh>

      {/* 카페 — 온실형 베이커리(v2.md §1-2 "유리와 검은 금속 프레임"). 창 불빛이 상태를 따른다 */}
      <group position={[-9, 0, -12]}>
        <mesh position={[0, 0.06, 0]} receiveShadow>
          <boxGeometry args={[3.6, 0.12, 3.0]} />
          <meshStandardMaterial color="#3a3632" roughness={0.9} />
        </mesh>
        <mesh position={[0, 1.25, 0]}>
          <boxGeometry args={[3.0, 2.3, 2.4]} />
          <meshPhysicalMaterial color="#dfe9ee" transmission={0.85} thickness={0.2} roughness={0.15} ior={1.4} transparent opacity={0.9} />
        </mesh>
        {[[-1.5, 0, 1.2], [1.5, 0, 1.2], [-1.5, 0, -1.2], [1.5, 0, -1.2]].map(([x, , z], i) => (
          <mesh key={i} position={[x, 1.25, z]} castShadow>
            <boxGeometry args={[0.08, 2.4, 0.08]} />
            <meshStandardMaterial color="#1a1c1f" metalness={0.6} roughness={0.5} />
          </mesh>
        ))}
        {[-1.0, 0, 1.0].map((x) => (
          <mesh key={x} position={[x, 2.42, 0]}>
            <boxGeometry args={[0.06, 0.06, 2.5]} />
            <meshStandardMaterial color="#1a1c1f" metalness={0.6} roughness={0.5} />
          </mesh>
        ))}
        <mesh position={[0, 2.95, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
          <coneGeometry args={[2.3, 1.0, 4]} />
          <meshPhysicalMaterial color="#cfd9de" transmission={0.5} roughness={0.3} transparent opacity={0.85} />
        </mesh>
        {/* 실내: 따뜻한 빛과 진열대 실루엣 */}
        <mesh position={[0, 0.9, -0.6]}>
          <boxGeometry args={[2.2, 0.9, 0.5]} />
          <meshStandardMaterial color="#5a3d28" roughness={0.8} />
        </mesh>
        <mesh position={[0, 1.6, -1.1]}>
          <planeGeometry args={[2.6, 1.2]} />
          <meshStandardMaterial ref={cafeGlow} color="#ffb072" emissive="#ff8a4c" emissiveIntensity={0.9} />
        </mesh>
        <pointLight ref={cafeLight} position={[0, 1.6, 0]} color="#ffa06a" intensity={0.9} distance={7} />
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
      <Suspense fallback={(
        <>
          {[[7.2, -2.2, 6.5, -0.04], [7.6, -4.4, 7.5, 0.03], [7.1, -6.6, 6.0, -0.02], [7.8, -9.2, 8.5, 0.05], [7.3, -12.0, 7.0, -0.03], [8.1, -15.5, 9.0, 0.02]].map(([x, z, h, lean], i) => (
            <Cypress key={i} position={[x, 0, z]} height={h} lean={lean} />
          ))}
          {[-1.6, -2.0, -1.4].map((x, i) => <Cypress key={`l${i}`} position={[x, 0, -1.2 - i * 2.4]} height={5 + i * 0.8} lean={(i - 1) * 0.03} />)}
          <ForestRing radius={13} count={22} />
        </>
      )}>
        <RealForest radius={13} count={22} />
      </Suspense>

      {/* 가로등 2개 — 정류장 뒤(공포 트리거)와 도로 건너 */}
      <group position={[1.4, 0, 1.4]}>
        <Suspense fallback={null}><Prop url="/reactive/models/props/street_lamp_01.glb" scale={0.85} rotation={[0, Math.PI, 0]} /></Suspense>
        <mesh position={[0, 3.05, -0.35]}>
          <sphereGeometry args={[0.1, 8, 8]} />
          <meshStandardMaterial ref={lampBulb} color="#fff2c0" emissive="#fff2c0" emissiveIntensity={0.1} />
        </mesh>
        <pointLight ref={lampLight} position={[0, 3.0, -0.35]} color="#ffedb0" intensity={0} distance={6} />
      </group>
      <group position={[6.3, 0, -6]}>
        <Suspense fallback={null}><Prop url="/reactive/models/props/street_lamp_01.glb" scale={0.85} /></Suspense>
        <mesh position={[0, 3.05, 0.35]}>
          <sphereGeometry args={[0.1, 8, 8]} />
          <meshStandardMaterial ref={lampBulb2} color="#fff2c0" emissive="#fff2c0" emissiveIntensity={0.1} />
        </mesh>
        <pointLight ref={lampLight2} position={[0, 3.0, 0.35]} color="#ffedb0" intensity={0} distance={6} />
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
