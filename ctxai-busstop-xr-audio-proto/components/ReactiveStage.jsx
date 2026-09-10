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
import { Color, Vector3, Quaternion, Euler, FogExp2, BackSide, MathUtils, CanvasTexture, SRGBColorSpace, PMREMGenerator, TextureLoader, RepeatWrapping } from "three";
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

// 후드/머릿수건 — v2.md §1-2 "후드가 얼굴 대부분을 가리고 있어 성별과 나이를 정확히 알 수 없다".
// 지금은 쓰지 않는다: 임시 리깅(Meshy)은 머리 비례가 커서 후드가 맞지 않았다. Mixamo 인물로
// 바꾸면 머리 뼈(mixamorig:Head)에 붙여 다시 쓴다.
function Hood({ color = "#3f4a58", y = 1.58, scale = 1 }) {
  // 임시 리깅의 머리카락 부피(반지름 약 0.35)를 덮으려면 후드가 커야 한다. 안쪽에 검은 구를 두어
  // 후드 속은 그늘만 보이게 하고, 앞쪽 개구부(약 80°)로 턱과 입 언저리만 드러난다.
  return (
    <group position={[0, y, 0]} scale={scale}>
      <mesh>
        <sphereGeometry args={[0.4, 14, 10]} />
        <meshStandardMaterial color="#07080a" roughness={1} />
      </mesh>
      <mesh castShadow>
        <sphereGeometry args={[0.46, 20, 14, Math.PI * 0.72, Math.PI * 1.56, 0, Math.PI * 0.7]} />
        <meshStandardMaterial color={color} roughness={0.85} side={2} />
      </mesh>
      <mesh position={[0, -0.3, 0.03]} castShadow>
        <coneGeometry args={[0.52, 0.55, 16, 1, true]} />
        <meshStandardMaterial color={color} roughness={0.85} side={2} />
      </mesh>
    </group>
  );
}

// 임시 리그(Meshy)는 걷기 클립 하나뿐이다. 앉은 자세는 정지 프레임 위에 다리·팔·척추 뼈의 상대 회전을 얹어 만든다
// (뼈의 휴지 자세 쿼터니언 × 추가 회전 — 절대값을 넣으면 리그마다 다른 휴지 방향이 깨진다).
// 뼈 이름은 Mixamo 규약(Hips/Spine/LeftUpLeg/LeftLeg/LeftArm…)이라 Mixamo 인물로 바꿔도 그대로 쓴다.
// 값은 라디안(뼈 로컬 x,y,z). window.__sit 으로 실행 중에 덮어써 볼 수 있다(?rigtest=1 점검용).
// (실측: 이 리그들은 뼈 로컬 z 가 앞뒤 굽힘이다 — 허벅지 +z 앞으로, 무릎 -z 로 정강이를 내린다.)
export const SIT_POSE = {
  LeftUpLeg: [0, 0, 1.45], RightUpLeg: [0, 0, 1.45],
  LeftLeg: [0, 0, -1.5], RightLeg: [0, 0, -1.5],
  LeftFoot: [0, 0, 0.15], RightFoot: [0, 0, 0.15],
  LeftArm: [0, 0, 0], RightArm: [0, 0, 0],
  LeftForeArm: [0, 0, -0.35], RightForeArm: [0, 0, -0.35],
  Spine: [0, 0, 0.08], Head: [0, 0, -0.05],
  seatY: 0.5, // 골반 높이(벤치 좌면 0.50m)
};
const tmpV1 = new Vector3(), tmpV2 = new Vector3(), tmpQ = new Quaternion(), tmpE = new Euler();

function RiggedPerson({ rig = "A", walking = false, seated = false, scale = 1, facing = 0 }) {
  const { scene, animations } = useGLTF(RIG_URLS[rig] || RIG_URLS.A, false, true);
  const model = useMemo(() => {
    const c = skeletonClone(scene);
    c.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    return c;
  }, [scene]);
  const bones = useMemo(() => { const b = {}; model.traverse((o) => { if (o.isBone) b[o.name] = o; }); return b; }, [model]);
  const rest = useRef(null); // 앉기 시작한 프레임의 뼈 쿼터니언(믹서가 쓴 정지 프레임)
  const { actions } = useAnimations(animations, model);
  useEffect(() => {
    const name = Object.keys(actions)[0];
    const a = name ? actions[name] : null;
    if (!a) return;
    if (walking && !seated) { a.paused = false; a.reset().fadeIn(0.2).play(); }
    else { a.play(); a.paused = true; a.time = 0.35; } // 0.35s: 두 다리가 모이는 프레임 — 서 있기·앉기의 바탕
    rest.current = null;
    return () => { a.fadeOut(0.2); };
  }, [actions, walking, seated]);
  // useAnimations 의 useFrame(믹서 갱신)이 먼저 돌고 이 콜백이 돈다 — 정지 프레임 위에 앉은 자세를 얹는다
  useFrame((state) => {
    if (!seated) { model.position.y = 0; rest.current = null; return; }
    const breath = Math.sin(state.clock.elapsedTime * 1.25) * 0.025; // 숨쉬기 — 척추가 살짝 펴졌다 굽는다
    if (!rest.current) {
      const r = {}; for (const k in bones) r[k] = bones[k].quaternion.clone();
      model.updateMatrixWorld(true);
      const hips = bones.Hips; let hipY = 0.9;
      if (hips) { hips.getWorldPosition(tmpV1); model.getWorldPosition(tmpV2); hipY = tmpV1.y - tmpV2.y; }
      rest.current = { q: r, hipY };
    }
    const pose = (typeof window !== "undefined" && window.__sit) ? { ...SIT_POSE, ...window.__sit } : SIT_POSE;
    for (const name in pose) {
      const b = bones[name], r = pose[name], q0 = rest.current.q[name];
      if (!b || !Array.isArray(r) || !q0) continue;
      const dz = name === "Spine" ? breath : name === "Head" ? -breath * 0.6 : 0;
      tmpQ.setFromEuler(tmpE.set(r[0], r[1], r[2] + dz));
      b.quaternion.copy(q0).multiply(tmpQ);
    }
    model.position.y = pose.seatY - rest.current.hipY; // 골반이 좌면 높이에 오도록 내린다
  });
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

// PBR 텍스처 세트(PolyHaven CC0, 1k jpg) — 반복·색공간을 맞춰 준다
function usePbr(id, repeat) {
  const [map, normalMap, roughnessMap, aoMap] = useLoader(TextureLoader, [
    `/reactive/textures/${id}_Diffuse.jpg`, `/reactive/textures/${id}_nor_gl.jpg`, `/reactive/textures/${id}_Rough.jpg`, `/reactive/textures/${id}_AO.jpg`,
  ]);
  useMemo(() => {
    for (const tx of [map, normalMap, roughnessMap, aoMap]) { tx.wrapS = tx.wrapT = RepeatWrapping; tx.repeat.set(repeat[0], repeat[1]); tx.anisotropy = 8; }
    map.colorSpace = SRGBColorSpace;
  }, [map, normalMap, roughnessMap, aoMap, repeat]);
  return { map, normalMap, roughnessMap, aoMap };
}

function Sidewalk({ position, size, repeat }) {
  const tex = usePbr("brick_pavement_02", repeat);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={position} receiveShadow>
      <planeGeometry args={size} />
      <meshStandardMaterial {...tex} color="#b9b6ae" roughness={0.9} normalScale={[0.6, 0.6]} />
    </mesh>
  );
}

function RoadSurface({ roadMat, reflect }) {
  const tex = usePbr("asphalt_02", [16, 3.2]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -10]} receiveShadow>
      <planeGeometry args={[70, 14]} />
      {reflect ? (
        <MeshReflectorMaterial
          ref={roadMat} {...tex} color="#8a8d92" roughness={0.6} metalness={0.15} normalScale={[0.5, 0.5]}
          blur={[420, 140]} resolution={640} mixBlur={1} mixStrength={0.8} mixContrast={1} mirror={0.4}
          depthScale={0.8} minDepthThreshold={0.85} maxDepthThreshold={1.3} depthToBlurRatioBias={0.25}
        />
      ) : (
        <meshStandardMaterial ref={roadMat} {...tex} color="#8a8d92" roughness={0.6} metalness={0.15} />
      )}
    </mesh>
  );
}

// 지면 — 숲 바닥 텍스처. 소나기 뒤라 어둡고 젖은 톤으로 눌러 둔다.
function Ground() {
  const tex = usePbr("forest_floor", [48, 48]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
      <planeGeometry args={[160, 160]} />
      <meshStandardMaterial {...tex} color="#6a6a5e" roughness={0.95} metalness={0} normalScale={[0.6, 0.6]} />
    </mesh>
  );
}

// 침엽수 — PolyHaven 묘목(fir_sapling / pine_sapling_small)을 4~6배로 키워 숲을 만든다.
// 텍스처 밀도는 거칠어지지만 원뿔보다 훨씬 낫고, 멀리 있어 티가 덜 난다.
const FIR_RE = /fir_sapling_a/;
const PINE_RE = /pine_sapling_small_a/;
function RealTree({ kind = "fir", position, scale = 5, yaw = 0 }) {
  const url = kind === "fir" ? "/reactive/models/props/fir_sapling.glb" : "/reactive/models/props/pine_sapling_small.glb";
  return <Prop url={url} only={kind === "fir" ? FIR_RE : PINE_RE} position={position} rotation={[0, yaw, 0]} scale={scale} />;
}
function RealForest() {
  // 3D_배경_구성_기획.md §4 의 방위: 정면(0°) 도로 건너편은 침엽수림, 오른쪽(+60°)이 공원 입구 숲,
  // 왼쪽 건너편(-38°)은 카페가 보여야 하므로 그 앞은 비운다. 뒤(180°)는 풀숲 너머 드문 나무.
  const trees = useMemo(() => {
    const out = [];
    let i = 0;
    const put = (x, z, s, kind) => out.push({ x, z, scale: s, kind, yaw: (i++ * 1.7) % (Math.PI * 2) });
    // 건너편 먼 줄 (z -19 ~ -27), 카페 앞(x -24 ~ -13)은 비움
    for (let x = -40; x <= 40; x += 4.2) {
      if (x > -24 && x < -13) continue;
      const j = ((x * 7) % 5 + 5) % 5;
      put(x + (j - 2) * 0.6, -19.5 - j * 1.6, 4.8 + (j % 3) * 0.7, j % 3 === 0 ? "pine" : "fir");
    }
    // 오른쪽 공원 입구 숲 (x 7.5 ~ 17, z -2 ~ -16)
    [[8, -3.5, 5.2], [10.5, -7, 5.8], [8.5, -10.5, 4.9], [12, -13.5, 6.2], [14.5, -5, 5.4], [16.5, -10, 6.0], [13, -1.5, 4.6]].forEach(([x, z, s], k) => put(x, z, s, k % 3 === 1 ? "pine" : "fir"));
    // 왼쪽 (x -8 ~ -16, z -2 ~ -14) — 카페 시선(-38°)은 피한다
    [[-8.5, -2.5, 4.8], [-11, -6.5, 5.6], [-9.5, -12, 5.0], [-15, -3.5, 5.8], [-16, -9, 5.2]].forEach(([x, z, s], k) => put(x, z, s, k % 2 ? "pine" : "fir"));
    // 뒤 (z 4.5 ~ 9)
    [[-9, 5.5, 4.4], [-4, 7.5, 5.0], [1.5, 6.5, 4.6], [6, 8, 5.2], [11, 5.5, 4.8]].forEach(([x, z, s], k) => put(x, z, s, k % 2 ? "fir" : "pine"));
    return out;
  }, []);
  return <>{trees.map((t, i) => <RealTree key={i} kind={t.kind} position={[t.x, 0, t.z]} scale={t.scale} yaw={t.yaw} />)}</>;
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

// 찢어진 포스터 — v2.md §1-1. 아래 절반이 찢겨 나가고 "…찾습니다" "…사례합니다"만 남은 종이.
// 버스 행선지판 — 앞: 검정 바탕 주황 LED "272 호수공원", 옆: 흰 바탕 "272 · 호수공원 ↔ 시청"
function useBusSignTextures() {
  return useMemo(() => {
    if (typeof document === "undefined") return { front: null, side: null };
    const make = (w, h, draw) => { const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); const tx = new CanvasTexture(c); tx.colorSpace = SRGBColorSpace; tx.anisotropy = 4; return tx; };
    const font = 'Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
    const front = make(768, 160, (g, w, h) => {
      g.fillStyle = "#0b0c0e"; g.fillRect(0, 0, w, h);
      g.fillStyle = "#ff9a3d"; g.textAlign = "left"; g.textBaseline = "middle";
      g.font = `bold ${Math.round(h * 0.72)}px ${font}`; g.fillText("272", 28, h / 2 + 4);
      g.font = `bold ${Math.round(h * 0.5)}px ${font}`; g.fillText("호수공원", 300, h / 2 + 4);
    });
    const side = make(768, 180, (g, w, h) => {
      g.fillStyle = "#f2f4f6"; g.fillRect(0, 0, w, h);
      g.fillStyle = "#1f4f86"; g.fillRect(0, h - 16, w, 16);
      g.fillStyle = "#1a1d22"; g.textAlign = "left"; g.textBaseline = "middle";
      g.font = `bold ${Math.round(h * 0.62)}px ${font}`; g.fillText("272", 26, h / 2);
      g.font = `${Math.round(h * 0.3)}px ${font}`; g.fillStyle = "#2a2f36"; g.fillText("호수공원 ↔ 시청", 290, h / 2 - 10);
    });
    return { front, side };
  }, []);
}

function usePosterTexture() {
  return useMemo(() => {
    if (typeof document === "undefined") return null;
    const W = 512, H = 704;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d");
    g.fillStyle = "#d9d2bf"; g.fillRect(0, 0, W, H);
    // 빗물 얼룩
    for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(120,100,70,${0.05 + (i % 5) * 0.03})`; g.beginPath(); g.ellipse((i * 137) % W, (i * 211) % H, 40 + (i % 4) * 18, 22 + (i % 3) * 12, i, 0, Math.PI * 2); g.fill(); }
    // 사진 자리(고양이인지 사람인지 알 수 없게 흐리게)
    g.fillStyle = "#8d8577"; g.fillRect(96, 70, 320, 250);
    g.fillStyle = "#a9a08f"; g.beginPath(); g.ellipse(256, 195, 90, 100, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#2b2622"; g.font = "bold 74px Pretendard, 'Apple SD Gothic Neo', sans-serif"; g.textAlign = "center";
    g.fillText("…찾습니다", 256, 420);
    g.font = "bold 52px Pretendard, 'Apple SD Gothic Neo', sans-serif"; g.fillText("…사례합니다", 256, 490);
    // 아래쪽 찢김 — 알파 0 으로 지운다
    g.globalCompositeOperation = "destination-out";
    g.beginPath(); g.moveTo(0, 520);
    for (let x = 0; x <= W; x += 32) g.lineTo(x, 520 + Math.sin(x * 0.13) * 26 + ((x / 32) % 3) * 14);
    g.lineTo(W, H); g.lineTo(0, H); g.closePath(); g.fill();
    const tx = new CanvasTexture(c); tx.colorSpace = SRGBColorSpace; tx.anisotropy = 4;
    return tx;
  }, []);
}

function Truck({ x, z }) {
  return (
    <group position={[x, 0, z]}>
      {/* 캡 */}
      <mesh position={[0, 1.05, 1.35]} castShadow>
        <boxGeometry args={[1.7, 1.3, 1.5]} />
        <meshStandardMaterial color="#e6e9ec" metalness={0.5} roughness={0.35} />
      </mesh>
      <mesh position={[0, 1.25, 2.11]}>
        <boxGeometry args={[1.5, 0.7, 0.02]} />
        <meshPhysicalMaterial color="#9fc3e6" metalness={0.2} roughness={0.05} transparent opacity={0.7} />
      </mesh>
      {/* 옆창(양쪽) · 문 이음선 · 사이드미러 — 관객은 옆면을 본다 */}
      {[-0.86, 0.86].map((dx) => (
        <group key={dx}>
          <mesh position={[dx, 1.32, 1.3]}>
            <boxGeometry args={[0.02, 0.55, 0.95]} />
            <meshPhysicalMaterial color="#3a4a5c" metalness={0.6} roughness={0.05} transparent opacity={0.85} />
          </mesh>
          <mesh position={[dx, 0.85, 0.85]}>
            <boxGeometry args={[0.025, 1.0, 0.015]} />
            <meshStandardMaterial color="#8a9096" />
          </mesh>
          <mesh position={[dx * 1.12, 1.35, 2.0]}>
            <boxGeometry args={[0.16, 0.2, 0.06]} />
            <meshStandardMaterial color="#1e2126" />
          </mesh>
        </group>
      ))}
      {/* 적재함 — 파란 방수포 */}
      <mesh position={[0, 0.62, -0.75]} castShadow>
        <boxGeometry args={[1.75, 0.35, 2.7]} />
        <meshStandardMaterial color="#c9ccd0" metalness={0.5} roughness={0.5} />
      </mesh>
      <mesh position={[0, 1.05, -0.75]} castShadow>
        <boxGeometry args={[1.65, 0.55, 2.5]} />
        <meshStandardMaterial color="#2b5aa8" roughness={0.85} />
      </mesh>
      {/* 바퀴 */}
      {[[-0.8, -1.4], [0.8, -1.4], [-0.8, 1.35], [0.8, 1.35]].map(([dx, dz], i) => (
        <group key={i} position={[dx, 0.34, dz]} rotation={[0, 0, Math.PI / 2]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.34, 0.34, 0.24, 16]} />
            <meshStandardMaterial color="#141517" roughness={0.9} />
          </mesh>
          <mesh>
            <cylinderGeometry args={[0.15, 0.15, 0.26, 10]} />
            <meshStandardMaterial color="#9aa1a8" metalness={0.8} roughness={0.35} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 0.42, 2.15]}>
        <boxGeometry args={[1.6, 0.22, 0.1]} />
        <meshStandardMaterial color="#2a2e33" metalness={0.5} roughness={0.5} />
      </mesh>
      {[-0.6, 0.6].map((dx) => (
        <mesh key={dx} position={[dx, 0.75, 2.12]}>
          <circleGeometry args={[0.1, 12]} />
          <meshStandardMaterial color="#fff6dc" emissive="#fff0c8" emissiveIntensity={1.8} />
        </mesh>
      ))}
      <pointLight position={[0, 0.8, 3.0]} color="#ffe9c0" intensity={1.0} distance={6} />
    </group>
  );
}

function useRadialTexture() {
  return useMemo(() => {
    if (typeof document === "undefined") return null;
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, "rgba(255,255,255,0.9)"); grad.addColorStop(0.45, "rgba(255,255,255,0.35)"); grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
    return new CanvasTexture(c);
  }, []);
}

function Splash({ p }) {
  // 0~1 — 트럭이 물웅덩이를 밟아 물보라가 관객 쪽(+z)으로 부채꼴처럼 튀어 오르는 순간. 물방울 36개 + 안개 스프라이트.
  const mist = useRadialTexture();
  const drops = useMemo(() => Array.from({ length: 36 }, (_, i) => {
    const h = (k) => { const v = Math.sin((i + 1) * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v); };
    return { a: (h(0) - 0.5) * Math.PI * 1.1, s: 0.45 + h(1) * 0.9, up: 0.6 + h(2) * 0.9, r: 0.01 + h(3) * 0.022 };
  }), []);
  const q = Math.min(1, p);
  const spread = q * 2.8;
  const yArc = Math.sin(q * Math.PI) * 1.15;
  return (
    <group position={[0.6, 0.05, -3.6]}>
      {drops.map((d, i) => (
        <mesh key={i} position={[Math.sin(d.a) * spread * d.s, yArc * d.up * d.s, Math.cos(d.a) * spread * d.s * 0.9]}>
          <sphereGeometry args={[d.r * (1 - q * 0.4), 6, 6]} />
          <meshPhysicalMaterial color="#c9d8e0" roughness={0.1} metalness={0.1} transparent opacity={Math.max(0, 0.75 - q * 0.7)} />
        </mesh>
      ))}
      {/* 물안개 — 카메라를 보는 스프라이트가 커지며 옅어진다 */}
      {mist && (
        <sprite position={[0, 0.35 + q * 0.6, 0.4 + q * 1.2]} scale={[1.2 + q * 2.6, 0.7 + q * 1.4, 1]}>
          <spriteMaterial map={mist} color="#e8f0f4" transparent opacity={0.5 * (1 - q)} depthWrite={false} />
        </sprite>
      )}
    </group>
  );
}

function Cat({ x, z, running, facingBench, bob }) {
  // 검은 고양이 — 캡슐 몸통·둥근 머리·세운 꼬리·네 다리. 달릴 땐 몸이 들썩이고 다리가 앞뒤로 흔들린다.
  const rot = facingBench ? 0.2 : -Math.PI / 2;
  const y = running ? Math.abs(Math.sin(bob * 14)) * 0.05 : 0;
  const legSwing = running ? Math.sin(bob * 14) * 0.6 : 0;
  const fur = "#1d1a18";
  return (
    <group position={[x, y, z]} rotation={[0, rot, 0]}>
      <mesh position={[0, 0.2, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <capsuleGeometry args={[0.085, 0.26, 4, 10]} />
        <meshStandardMaterial color={fur} roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.3, 0.2]} castShadow>
        <sphereGeometry args={[0.075, 12, 10]} />
        <meshStandardMaterial color={fur} roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.27, 0.265]}>
        <sphereGeometry args={[0.035, 8, 8]} />
        <meshStandardMaterial color={fur} roughness={0.95} />
      </mesh>
      {[-0.04, 0.04].map((dx) => (
        <mesh key={dx} position={[dx, 0.37, 0.19]} rotation={[0.2, 0, dx * 6]}>
          <coneGeometry args={[0.025, 0.06, 4]} />
          <meshStandardMaterial color={fur} roughness={0.95} />
        </mesh>
      ))}
      {[-0.03, 0.03].map((dx) => (
        <mesh key={`e${dx}`} position={[dx, 0.31, 0.262]}>
          <sphereGeometry args={[0.011, 6, 6]} />
          <meshStandardMaterial color="#d8ff8a" emissive="#b8ff60" emissiveIntensity={1.4} />
        </mesh>
      ))}
      {/* 다리 — 앞뒤 두 쌍이 엇갈려 흔들린다 */}
      {[[-0.05, 0.11, 1], [0.05, 0.11, -1], [-0.05, -0.1, -1], [0.05, -0.1, 1]].map(([dx, dz, s], i) => (
        <mesh key={i} position={[dx, 0.09, dz]} rotation={[legSwing * s, 0, 0]}>
          <cylinderGeometry args={[0.018, 0.016, 0.17, 6]} />
          <meshStandardMaterial color={fur} roughness={0.95} />
        </mesh>
      ))}
      {/* 꼬리 — 위로 굽은 토러스 조각 */}
      <mesh position={[0, 0.24, -0.16]} rotation={[0, Math.PI / 2, running ? 0.3 : 0]}>
        <torusGeometry args={[0.12, 0.014, 6, 10, Math.PI * 0.75]} />
        <meshStandardMaterial color={fur} roughness={0.95} />
      </mesh>
    </group>
  );
}

function Bus({ x, z, headlight, doorOpen }) {
  const body = "#2f5f93";
  const signs = useBusSignTextures();
  return (
    <group position={[x, 0, z]}>
      {/* 차체 — 아래 몸통 + 위 몸통을 살짝 좁혀 둥근 인상 */}
      <mesh position={[0, 1.0, 0]} castShadow>
        <boxGeometry args={[2.5, 1.3, 10.4]} />
        <meshStandardMaterial color={body} metalness={0.55} roughness={0.35} />
      </mesh>
      <mesh position={[0, 2.15, 0]} castShadow>
        <boxGeometry args={[2.4, 1.2, 10.2]} />
        <meshStandardMaterial color={body} metalness={0.55} roughness={0.35} />
      </mesh>
      <mesh position={[0, 2.82, 0]} castShadow>
        <boxGeometry args={[2.3, 0.14, 10.0]} />
        <meshStandardMaterial color="#d9dee3" metalness={0.3} roughness={0.5} />
      </mesh>
      {/* 창 띠 (양쪽) — 어두운 반사 유리에 실내 온광이 약하게 비치고, 창틀 기둥이 1.3m 마다 선다 */}
      {[-1.22, 1.22].map((dx) => (
        <group key={dx}>
          <mesh position={[dx, 2.1, 0]}>
            <boxGeometry args={[0.02, 0.95, 9.4]} />
            <meshPhysicalMaterial color="#5b7a99" emissive="#ffd9a0" emissiveIntensity={0.12} metalness={0.7} roughness={0.04} transparent opacity={0.82} />
          </mesh>
          {[-3.9, -2.6, -1.3, 0, 1.3, 2.6, 3.9].map((dz) => (
            <mesh key={dz} position={[dx, 2.1, dz]}>
              <boxGeometry args={[0.03, 1.0, 0.06]} />
              <meshStandardMaterial color="#1c2430" metalness={0.5} roughness={0.5} />
            </mesh>
          ))}
          <mesh position={[dx, 1.62, 0]}>
            <boxGeometry args={[0.03, 0.04, 9.6]} />
            <meshStandardMaterial color="#d9dee3" metalness={0.3} roughness={0.5} />
          </mesh>
        </group>
      ))}
      {/* 옆 행선지판 (관객 쪽, 앞문 뒤) */}
      <mesh position={[-1.275, 1.2, 1.2]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[1.1, 0.26]} />
        {signs.side ? <meshStandardMaterial map={signs.side} emissiveMap={signs.side} emissive="#ffffff" emissiveIntensity={0.25} /> : <meshStandardMaterial color="#f2f4f6" />}
      </mesh>
      {/* 앞유리 */}
      <mesh position={[0, 2.05, 5.21]}>
        <boxGeometry args={[2.1, 1.1, 0.02]} />
        <meshPhysicalMaterial color="#9fc3e6" metalness={0.2} roughness={0.05} transparent opacity={0.7} />
      </mesh>
      {/* 문 (관객 쪽, 왼쪽면) — 유리 두 짝, 열리면 안쪽으로 접힌 것처럼 얇아진다. 열린 문 안쪽엔 실내 불빛 */}
      {[2.12, 2.68].map((dz, i) => (
        <group key={dz} position={[-1.255, 1.15, dz]}>
          <mesh>
            <boxGeometry args={[0.04, 2.0, doorOpen ? 0.1 : 0.52]} />
            <meshStandardMaterial color="#1a2735" metalness={0.4} roughness={0.5} />
          </mesh>
          {!doorOpen && (
            <mesh position={[-0.021, 0.35, 0]}>
              <boxGeometry args={[0.005, 1.0, 0.4]} />
              <meshPhysicalMaterial color="#5b7a99" metalness={0.7} roughness={0.04} transparent opacity={0.8} />
            </mesh>
          )}
        </group>
      ))}
      {doorOpen && (
        <mesh position={[-1.2, 1.1, 2.4]} rotation={[0, -Math.PI / 2, 0]}>
          <planeGeometry args={[1.0, 2.0]} />
          <meshStandardMaterial color="#ffe6c2" emissive="#ffd9a0" emissiveIntensity={0.9} />
        </mesh>
      )}
      {/* 바퀴 */}
      {[[-1.05, -3.2], [1.05, -3.2], [-1.05, 3.3], [1.05, 3.3]].map(([dx, dz], i) => (
        <group key={i} position={[dx, 0.48, dz]} rotation={[0, 0, Math.PI / 2]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.48, 0.48, 0.32, 18]} />
            <meshStandardMaterial color="#141517" roughness={0.9} />
          </mesh>
          <mesh>
            <cylinderGeometry args={[0.22, 0.22, 0.34, 12]} />
            <meshStandardMaterial color="#9aa1a8" metalness={0.8} roughness={0.35} />
          </mesh>
        </group>
      ))}
      {/* 범퍼·행선지판 */}
      <mesh position={[0, 0.45, 5.25]}>
        <boxGeometry args={[2.4, 0.3, 0.12]} />
        <meshStandardMaterial color="#1e2328" metalness={0.5} roughness={0.5} />
      </mesh>
      <mesh position={[0, 2.62, 5.22]}>
        <planeGeometry args={[1.5, 0.3]} />
        {signs.front ? <meshStandardMaterial map={signs.front} emissiveMap={signs.front} emissive="#ffffff" emissiveIntensity={1.4} /> : <meshStandardMaterial color="#ff9a3d" emissive="#ff8a2a" emissiveIntensity={1.6} />}
      </mesh>
      {/* 전조등 */}
      {[-0.85, 0.85].map((dx) => (
        <group key={dx}>
          <mesh position={[dx, 0.85, 5.23]}>
            <circleGeometry args={[0.15, 14]} />
            <meshStandardMaterial color="#fff6dc" emissive="#fff0c8" emissiveIntensity={2.4 * headlight} />
          </mesh>
          <pointLight position={[dx, 0.85, 6.6]} color="#fff0c8" intensity={headlight * 1.8} distance={13} />
        </group>
      ))}
      <pointLight position={[0, 2.2, 0]} color="#ffe6b0" intensity={0.6} distance={5} />
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
  const posterTex = usePosterTexture();
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

      {/* ================= 지형 — 스크립트 v2 §1 / 3D_배경_구성_기획 §4 =================
          관객은 벤치(원점)에 앉아 -z 를 본다. 도로는 정면에서 좌우(x)로 지나간다:
          가까운 연석 z=-3, 중앙선 z=-10, 건너편 연석 z=-17. 카페는 도로 건너 왼쪽(-38°),
          숲은 오른쪽(+60°)과 건너편, 풀숲은 뒤(180°). 지형은 장르와 무관하게 고정이다. */}
      <Suspense fallback={null}><Ground /></Suspense>
      <Suspense fallback={(
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -10]} receiveShadow>
          <planeGeometry args={[70, 14]} />
          <meshStandardMaterial ref={roadMat} color="#3f4247" roughness={0.6} metalness={0.15} />
        </mesh>
      )}>
        <RoadSurface roadMat={roadMat} reflect={reflect} />
      </Suspense>
      {/* 인도(정류장 앞)와 연석 — PolyHaven brick_pavement_02 보도블록 */}
      <Suspense fallback={<mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, -1.3]} receiveShadow><planeGeometry args={[44, 3.4]} /><meshStandardMaterial color="#5a5b57" roughness={0.95} /></mesh>}>
        <Sidewalk position={[0, 0.01, -1.3]} size={[44, 3.4]} repeat={[22, 1.7]} />
      </Suspense>
      <mesh position={[0, 0.06, -3.0]} receiveShadow>
        <boxGeometry args={[44, 0.12, 0.18]} />
        <meshStandardMaterial color="#8a8c88" roughness={0.9} />
      </mesh>
      {/* 건너편 인도 */}
      <Suspense fallback={null}>
        <Sidewalk position={[0, 0.01, -18.2]} size={[70, 2.4]} repeat={[35, 1.2]} />
      </Suspense>
      {/* 중앙 이중 황색선 · 차선 점선 */}
      {[-0.07, 0.07].map((dz) => (
        <mesh key={dz} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, -10 + dz]}>
          <planeGeometry args={[70, 0.05]} />
          <meshStandardMaterial color="#e0b840" />
        </mesh>
      ))}
      {[-6.5, -13.5].map((z) =>
        Array.from({ length: 16 }, (_, i) => (
          <mesh key={`${z}-${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[-33 + i * 4.4, 0.015, z]}>
            <planeGeometry args={[1.6, 0.09]} />
            <meshStandardMaterial color="#d8d8d0" />
          </mesh>
        ))
      )}
      {/* 횡단보도 — 정류장 왼쪽 x≈-5, 신호등 없음(v1.1). 줄무늬는 도로 방향으로 길고 z 로 쌓인다 */}
      {Array.from({ length: 8 }, (_, i) => (
        <mesh key={`cw${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[-5, 0.016, -3.9 - i * 1.7]}>
          <planeGeometry args={[2.4, 0.62]} />
          <meshStandardMaterial color="#cfcfc6" />
        </mesh>
      ))}
      {/* 물웅덩이 — 연석 바로 앞(트럭이 밟는 자리) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.6, 0.012, -3.9]} scale={[1.4, 0.55, 1]}>
        <circleGeometry args={[0.7, 18]} />
        <meshPhysicalMaterial color="#3d4650" roughness={0.03} metalness={0.5} transparent opacity={0.45} />
      </mesh>

      {/* ================= 정류장 — 등 뒤가 유리, 앞은 도로로 열림 =================
          폭 3.2m (x −1.0…2.2): 관객은 벤치 왼쪽(x=0), 옆사람은 오른쪽(x 1.05~1.7)에 앉으므로 오른쪽으로 넓다 */}
      <group>
        {/* 지붕 + 네온 띠 */}
        <mesh position={[0.6, 2.38, 0.15]} rotation={[0.03, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[3.2, 0.08, 2.3]} />
          <meshStandardMaterial color="#4a3222" roughness={0.8} />
        </mesh>
        {[-0.6, 0.5].map((z) => (
          <mesh key={z} position={[0.6, 2.335, z]}>
            <boxGeometry args={[3.0, 0.015, 0.03]} />
            <meshStandardMaterial color="#ff9a3d" emissive="#ff9a3d" emissiveIntensity={1.4} />
          </mesh>
        ))}
        {/* 지붕 아래 온광 — 네온 띠가 실제로 벤치·얼굴을 비춘다 (지붕 그림자 아래가 새까맣던 것) */}
        <pointLight position={[0.6, 2.2, 0.0]} color="#ffb877" intensity={0.9} distance={5} decay={2} />
        {/* 기둥 4개 (뒤 2, 앞 2) */}
        {[[-0.95, 1.15], [2.15, 1.15], [-0.95, -0.95], [2.15, -0.95]].map(([x, z], i) => (
          <mesh key={i} position={[x, 1.19, z]} castShadow>
            <cylinderGeometry args={[0.045, 0.05, 2.38, 10]} />
            <meshStandardMaterial color="#22242a" metalness={0.6} roughness={0.45} />
          </mesh>
        ))}
        {/* 뒤 유리(벤치 뒤) · 양옆 유리 */}
        <mesh position={[0.6, 1.15, 1.17]}>
          <boxGeometry args={[3.1, 2.1, 0.02]} />
          <meshPhysicalMaterial color="#bcd4e0" transparent opacity={0.22} roughness={0.08} metalness={0.1} />
        </mesh>
        {[-0.96, 2.16].map((x) => (
          <mesh key={x} position={[x, 1.15, 0.1]}>
            <boxGeometry args={[0.02, 2.1, 2.1]} />
            <meshPhysicalMaterial color="#bcd4e0" transparent opacity={0.22} roughness={0.08} metalness={0.1} />
          </mesh>
        ))}
      </group>
      {/* 정류장 이름 표지판 — 앞 왼쪽 기둥 옆 폴, 관객을 향한다 */}
      <mesh position={[-0.95, 1.05, -2.0]} castShadow>
        <cylinderGeometry args={[0.03, 0.035, 2.1, 8]} />
        <meshStandardMaterial color="#33363c" />
      </mesh>
      <SignBoard text={signText || "호수공원 입구"} position={[-0.95, 1.78, -1.9]} />
      <Suspense fallback={<Bench />}>
        {/* 모델 원본은 1.17×0.89×0.5m 인데 좌면이 0.64m 로 높다(정점 분석). 등받이가 −z 쪽이라 π 돌리고,
            길이 1.9배(2.2m — 관객 x=0 과 옆사람 x 1.05~1.55 가 한 벤치), 높이 0.78배(좌면 0.50m), 깊이 0.85배.
            좌면 z≈0.21…0.42(카메라 z=0.35 가 그 위), 등받이 z≈0.55…0.63 */}
        <Prop url="/reactive/models/props/painted_wooden_bench.glb" scale={[1.9, 0.78, 0.85]} position={[0.6, 0, 0.42]} rotation={[0, Math.PI + benchYaw, 0]} />
        <Prop url="/reactive/models/props/metal_trash_can.glb" position={[-2.4, 0, -0.9]} rotation={[0, 0.4, 0]} />
        <Prop url="/reactive/models/props/shrub_02.glb" position={[-3.0, 0, 1.9]} />
        <Prop url="/reactive/models/props/shrub_02.glb" position={[3.6, 0, 2.0]} rotation={[0, 1.4, 0]} />
        <Prop url="/reactive/models/props/shrub_04.glb" position={[7.2, 0, -1.6]} rotation={[0, 0.7, 0]} />
        <Prop url="/reactive/models/props/grass_medium_01.glb" position={[-3.8, 0, -1.7]} castShadow={false} />
        <Prop url="/reactive/models/props/grass_medium_01.glb" position={[4.0, 0, -2.0]} rotation={[0, 0.8, 0]} castShadow={false} />
        <Prop url="/reactive/models/props/grass_medium_01.glb" position={[0.4, 0, 2.7]} rotation={[0, 2.4, 0]} castShadow={false} />
        <Prop url="/reactive/models/props/grass_medium_01.glb" position={[8.5, 0, -18.6]} rotation={[0, 1.1, 0]} castShadow={false} />
      </Suspense>
      {/* 포스터 — 오른쪽 유리(v2.md §1-1, 약 +75°), 옆사람 머리 뒤로 보인다 */}
      <mesh ref={posterRef} position={[2.14, 1.35, -0.1]} rotation={[0, -Math.PI / 2, 0.06]}>
        <planeGeometry args={[0.32, 0.44]} />
        <meshStandardMaterial map={posterTex} transparent alphaTest={0.4} roughness={0.9} side={2} />
      </mesh>

      {/* ================= 카페 — 도로 건너 왼쪽 약 -38°, 30m (v2.md §1-2) ================= */}
      <group position={[-19, 0, -26]} rotation={[0, 0.25, 0]}>
        <mesh position={[0, 0.06, 0]} receiveShadow>
          <boxGeometry args={[4.6, 0.12, 3.6]} />
          <meshStandardMaterial color="#3a3632" roughness={0.9} />
        </mesh>
        <mesh position={[0, 1.4, 0]}>
          <boxGeometry args={[4.0, 2.6, 3.0]} />
          <meshPhysicalMaterial color="#dfe9ee" transmission={0.85} thickness={0.2} roughness={0.15} ior={1.4} transparent opacity={0.9} />
        </mesh>
        {[[-2.0, 1.5], [2.0, 1.5], [-2.0, -1.5], [2.0, -1.5]].map(([x, z], i) => (
          <mesh key={i} position={[x, 1.4, z]} castShadow>
            <boxGeometry args={[0.1, 2.7, 0.1]} />
            <meshStandardMaterial color="#1a1c1f" metalness={0.6} roughness={0.5} />
          </mesh>
        ))}
        {[-1.3, 0, 1.3].map((x) => (
          <mesh key={x} position={[x, 2.72, 0]}>
            <boxGeometry args={[0.07, 0.07, 3.1]} />
            <meshStandardMaterial color="#1a1c1f" metalness={0.6} roughness={0.5} />
          </mesh>
        ))}
        <mesh position={[0, 3.35, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
          <coneGeometry args={[3.0, 1.2, 4]} />
          <meshPhysicalMaterial color="#cfd9de" transmission={0.5} roughness={0.3} transparent opacity={0.85} />
        </mesh>
        <mesh position={[0, 0.95, -0.7]}>
          <boxGeometry args={[3.0, 1.0, 0.6]} />
          <meshStandardMaterial color="#5a3d28" roughness={0.8} />
        </mesh>
        <mesh position={[0, 1.7, -1.4]}>
          <planeGeometry args={[3.6, 1.5]} />
          <meshStandardMaterial ref={cafeGlow} color="#ffb072" emissive="#ff8a4c" emissiveIntensity={0.9} />
        </mesh>
        <pointLight ref={cafeLight} position={[0, 1.8, 0]} color="#ffa06a" intensity={1.2} distance={10} />
        {/* 문 (정면, 관객 쪽) */}
        <mesh position={[0.9, 1.05, 1.52]}>
          <boxGeometry args={[0.9, 2.0, 0.05]} />
          <meshStandardMaterial color="#2b2a28" roughness={0.6} />
        </mesh>
      </group>

      {/* ================= 풀숲(뒤) · 길가 억새 ================= */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.6, 0.02, 2.4]} receiveShadow>
        <planeGeometry args={[9, 1.6]} />
        <meshStandardMaterial color="#3a4a36" />
      </mesh>
      <Reeds position={[-2.6, 0, 2.3]} count={6} />
      <Reeds position={[-1.0, 0, 2.5]} count={7} />
      <Reeds position={[0.9, 0, 2.4]} count={6} />
      <Reeds position={[2.7, 0, 2.6]} count={7} />
      <Reeds position={[1.9, 0, 3.0]} count={5} />
      <Reeds position={[6.8, 0, -2.4]} count={5} />
      <Reeds position={[8.4, 0, -2.0]} count={6} />
      <Reeds position={[-7.5, 0, -2.2]} count={5} />
      <Suspense fallback={<ForestRing radius={22} count={30} />}>
        <RealForest />
      </Suspense>

      {/* ================= 가로등 — 정류장 뒤(공포 트리거)와 도로 건너 ================= */}
      <group position={[1.6, 0, 1.7]}>
        <Suspense fallback={null}><Prop url="/reactive/models/props/street_lamp_01.glb" scale={0.85} rotation={[0, Math.PI, 0]} /></Suspense>
        <mesh position={[0, 3.05, -0.35]}>
          <sphereGeometry args={[0.1, 8, 8]} />
          <meshStandardMaterial ref={lampBulb} color="#fff2c0" emissive="#fff2c0" emissiveIntensity={0.1} />
        </mesh>
        <pointLight ref={lampLight} position={[0, 3.0, -0.35]} color="#ffedb0" intensity={0} distance={6} />
      </group>
      <group position={[5.5, 0, -18.6]}>
        <Suspense fallback={null}><Prop url="/reactive/models/props/street_lamp_01.glb" scale={0.85} /></Suspense>
        <mesh position={[0, 3.05, 0.35]}>
          <sphereGeometry args={[0.1, 8, 8]} />
          <meshStandardMaterial ref={lampBulb2} color="#fff2c0" emissive="#fff2c0" emissiveIntensity={0.1} />
        </mesh>
        <pointLight ref={lampLight2} position={[0, 3.0, 0.35]} color="#ffedb0" intensity={0} distance={7} />
      </group>
      <group position={[-9.5, 0, -18.6]}>
        <Suspense fallback={null}><Prop url="/reactive/models/props/street_lamp_01.glb" scale={0.85} /></Suspense>
      </group>

      {/* 리깅 캐릭터 점검용 (?rigtest=1): 두 캐릭터를 관객 정면 3m에 세워 로딩·크기·방향을 확인한다 */}
      {rigTest && (
        <Suspense fallback={null}>
          <group position={[-1.6, 0, -3]}><RiggedPerson rig="A" walking facing={0} /></group>
          <group position={[-0.5, 0, -3]}><RiggedPerson rig="B" walking={false} facing={0} /></group>
          <mesh position={[1.2, 0.25, -3.2]}><boxGeometry args={[1.6, 0.5, 0.5]} /><meshStandardMaterial color="#6b4a2a" /></mesh>
          <group position={[0.8, 0, -3]}><RiggedPerson rig="A" seated facing={0} /></group>
          <group position={[1.6, 0, -3]}><RiggedPerson rig="B" seated facing={0} /></group>
          {/* 실제 벤치 위 옆사람 자리(로맨스 x=1.05) + 높이 눈금 0.46/0.6/0.75 (빨강/초록/파랑) */}
          <group position={[1.05, 0, 0.3]} rotation={[0, 0.6, 0]}><RiggedPerson rig="B" seated facing={Math.PI} /></group>
          {[[0.5, "#ff3030"], [0.65, "#30ff30"], [0.8, "#3060ff"]].map(([y, c]) => (
            <mesh key={y} position={[1.75, y, 0.3]}><boxGeometry args={[0.08, 0.02, 0.4]} /><meshStandardMaterial color={c} emissive={c} emissiveIntensity={0.6} /></mesh>
          ))}
        </Suspense>
      )}
      {/* ---- 배우 ---- */}
      {actors.figure?.visible && (
        <group position={[actors.figure.x, 0, actors.figure.z]} rotation={[0, actors.figure.yaw ?? 0, 0]}>
          {useRig ? (
            <Suspense fallback={<Person raincoat tint="#5d6f82" walking={actors.figure.walking} bob={actors.figure.bob} scale={0.95} />}>
              <RiggedPerson rig="A" walking={actors.figure.walking} scale={0.98} facing={0} />
            </Suspense>
          ) : (
            <Person raincoat tint="#5d6f82" walking={actors.figure.walking} bob={actors.figure.bob} scale={0.95} />
          )}
        </group>
      )}
      {actors.truck?.visible && (
        <group position={[actors.truck.x, 0, actors.truck.z]} rotation={[0, -Math.PI / 2, 0]}>
          <Truck x={0} z={0} />
        </group>
      )}
      {actors.splash != null && <Splash p={actors.splash} />}
      {actors.cat?.visible && <Cat {...actors.cat} />}
      {actors.npc?.visible && (
        <group ref={npcGroup} position={[actors.npc.x, 0, actors.npc.z]} rotation={[0, actors.npc.seated ? 0.15 : (actors.npc.yaw ?? 0) - Math.PI * 0.8, 0]}>
          {useRig ? (
            <Suspense fallback={<Person raincoat={dominant !== "C"} tint={npcTint} head={npcHead} walking={actors.npc.walking} seated={actors.npc.seated} bob={actors.npc.bob} gazeRef={npcGaze} />}>
              {/* 시선 접촉률은 몸 전체가 관객 쪽으로 도는 정도로 나타낸다 — 착석 상태에선 관객(-x 쪽)을 향하는 각도가 -π/2 */}
              <group ref={npcGaze} position={[0, 1.55, 0]} />
              <RiggedPerson rig={dominant === "H" ? "A" : "B"} walking={actors.npc.walking} seated={actors.npc.seated} scale={dominant === "C" ? 0.9 : 1.0} facing={actors.npc.seated ? Math.PI : Math.PI * 0.8} />
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
            <mesh position={[0.05, 0.45, -0.32]} rotation={[0.15, 0, -0.12]}>
              <cylinderGeometry args={[0.012, 0.012, 0.9, 6]} />
              <meshStandardMaterial color="#3b2a1a" />
            </mesh>
          )}
        </group>
      )}
      {actors.bus?.visible && (
        <group position={[actors.bus.x, 0, actors.bus.z]} rotation={[0, Math.PI / 2, 0]}>
          <Bus {...actors.bus} x={0} z={0} />
        </group>
      )}

      {/* 암전 — 카메라 앞에 붙는 검은 판 */}
      <mesh position={[0, 1.15, -0.6]} renderOrder={999}>
        <planeGeometry args={[6, 4]} />
        <meshBasicMaterial ref={fadeMat} color="#000" transparent opacity={0} depthTest={false} />
      </mesh>
    </>
  );
}
