"use client";

// 지금까지 실제로 나온 아트(public/story/*.jpg — 로맨스·공포·코미디 일러스트)를
// 3D/VR 화면에 그대로 띄운다. GLB 3D 모델이 하나도 없어도(아트 진행 0/8), 이미
// 완성된 일러스트가 있으니 그걸 먼저 보여준다 — 와이어프레임 자리표시자로
// "아직 아무것도 없음"을 보여주는 대신, 실제로 만들어진 것을 보여주자는 결정.
//
// 진짜 360도 사진/영상이 아니라 일반 원근 그림이라 구(球)에 통째로 입히면
// 찌그러진다 — 카메라를 마주보는 평면 하나에 원본 비율 그대로 띄운다.

import { Suspense } from "react";
import { useTexture } from "@react-three/drei";
import { SRGBColorSpace } from "three";

function BackdropPlane({ url, distance, width }) {
  const texture = useTexture(url);
  texture.colorSpace = SRGBColorSpace;
  const aspect = texture.image ? texture.image.width / texture.image.height : 1920 / 1071;
  const height = width / aspect;
  return (
    <mesh position={[0, 1.15, -distance]}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}

export default function ImageBackdrop({ url, distance = 4, width = 8 }) {
  return (
    <Suspense fallback={null}>
      <BackdropPlane key={url} url={url} distance={distance} width={width} />
    </Suspense>
  );
}
