"use client";

// 웹캠으로 "머리 자세" 대용 신호를 뽑는다 — 헤드셋 없이, 조명 문제 없이(적외선
// 카메라로 교체해도 이 로직은 그대로 재사용 가능하도록 얼굴 랜드마크 좌표 기반으로
// 짰다. 자세한 근거·임계값 표는 Bus/규격/판정_기준.md 참고.

import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

const NOSE = 1;
const LEFT_EDGE = 234;
const RIGHT_EDGE = 454;
const FOREHEAD = 10;
// 턱(152번) 대신 미간(168번)을 아래쪽 기준점으로 쓴다 — 입을 가리는 등
// 손이 얼굴 아래쪽을 가리는 흔한 동작에도 턱 랜드마크가 안 흔들리게.
const NOSE_BRIDGE = 168;

// 노이즈로 볼 최소 변위 (정규화 좌표계, 얼굴 폭/높이 대비 비율)
const NOISE_TH = 0.045;
const SCALE_DROP_TH = 0.10;   // 얼굴 폭이 기준 대비 이만큼 줄면 "뒤로 뺌"
const SUSTAINED_SEC_TH = 2.0;
const SLOW_RECOVERY_MS = 3000;
const FAST_RECOVERY_MS = 2000;
// 한 프레임 안에서 이보다 더 튀면 손 가림 등 인식 오류로 보고 버린다
// (실제 고개 회전은 한 프레임 만에 이 정도로 안 튐)
const MAX_FRAME_JUMP = 0.10;

export const CHANNEL_WEIGHTS = { behavior: 0.5, text: 0.3, voice: 0.2 };

let landmarkerPromise = null;

function getLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = FilesetResolver.forVisionTasks("/mediapipe-wasm").then((fileset) =>
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: "/models/face_landmarker.task", delegate: "GPU" },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
      })
    ).catch(() =>
      FilesetResolver.forVisionTasks("/mediapipe-wasm").then((fileset) =>
        FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: "/models/face_landmarker.task", delegate: "CPU" },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: true,
        })
      )
    );
  }
  return landmarkerPromise;
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// 계산에 실제로 쓰는 5개 점의 최소 visibility(모델이 직접 보고하는 "이 점이
// 가려지지 않고 보이는가" 신뢰도) — 손이 얼굴을 가리면 여기서 바로 낮게
// 나와야 한다. FaceLandmarker 랜드마크 타입에 이미 있던 필드인데 지금까지
// 안 쓰고 있었다.
function minVisibility(landmarks) {
  const pts = [landmarks[NOSE], landmarks[LEFT_EDGE], landmarks[RIGHT_EDGE], landmarks[FOREHEAD], landmarks[NOSE_BRIDGE]];
  return Math.min(...pts.map((p) => (typeof p.visibility === "number" ? p.visibility : 1)));
}

// 한 프레임 → { dx, dy, scale } (정규화 좌표, 얼굴 크기로 나눈 상대값)
function frameSignal(landmarks) {
  const nose = landmarks[NOSE];
  const l = landmarks[LEFT_EDGE];
  const r = landmarks[RIGHT_EDGE];
  const top = landmarks[FOREHEAD];
  const bottom = landmarks[NOSE_BRIDGE];
  const width = dist(l, r) || 1e-6;
  const height = dist(top, bottom) || 1e-6;
  const cx = (l.x + r.x) / 2;
  const cy = (top.y + bottom.y) / 2;
  return {
    dx: (nose.x - cx) / width,
    dy: (nose.y - cy) / height,
    scale: width,
  };
}

// MediaPipe 블렌드셰이프(ARKit 호환, 실제 얼굴 캡처 데이터로 학습된 모델)에서
// 공포/놀람·웃음 관련 항목만 뽑는다 — 내가 지어낸 규칙이 아니라 모델 출력값이다.
// jawOpen(입 벌어짐)은 뺐다 — 크게 웃을 때도 입이 벌어져서 공포와 혼동된다
// (리허설에서 발견: 웃었는데 공포로 판정됨). 눈 커짐·눈썹 안쪽 치켜올림은
// 웃음과 겹치지 않는 훨씬 특이적인 공포 신호라 이 둘만 남긴다.
const FEAR_SHAPES = ["eyeWideLeft", "eyeWideRight", "browInnerUp"];
const AMUSEMENT_SHAPES = ["mouthSmileLeft", "mouthSmileRight", "cheekSquintLeft", "cheekSquintRight"];

function blendshapeScore(categories, names) {
  if (!categories?.length) return 0;
  let max = 0;
  for (const c of categories) {
    if (names.includes(c.categoryName) && c.score > max) max = c.score;
  }
  return max;
}

// durationMs 동안 비디오를 샘플링해서 관찰 지표를 만든다.
// onTick(live)는 디버그/대시보드 표시용 — { faceFound, dx, dy, scaleRatio } 를 매 프레임 받는다.
export async function observe(videoEl, durationMs, onTick) {
  let landmarker;
  try {
    landmarker = await getLandmarker();
  } catch (e) {
    return { ok: false, reason: "model_load_failed" };
  }

  const samples = [];
  const startedAt = performance.now();
  let baseline = null;
  let lostMs = 0;
  let lastT = 0;
  let lastAccepted = null; // 튐 판정 기준이 되는 마지막으로 받아들인 원값
  let maxFear = 0, maxAmusement = 0;
  let raf;

  await new Promise((resolve) => {
    function tick() {
      const now = performance.now();
      const elapsed = now - startedAt;
      const frameDelta = elapsed - lastT;
      lastT = elapsed;

      if (videoEl.readyState >= 2) {
        const result = landmarker.detectForVideo(videoEl, now);
        const lm = result?.faceLandmarks?.[0];
        if (lm) {
          const sig = frameSignal(lm);

          // 손이 얼굴을 스치는 등으로 한 프레임 만에 물리적으로 불가능하게
          // 튀면 인식 오류로 보고 버린다 (이전 유효값을 유지) — §관찰 로그 참고.
          const jump = lastAccepted ? Math.max(Math.abs(sig.dx - lastAccepted.dx), Math.abs(sig.dy - lastAccepted.dy)) : 0;
          if (lastAccepted && jump > MAX_FRAME_JUMP) {
            onTick?.({ faceFound: true, dx: 0, dy: 0, scaleRatio: 1, rejected: true });
          } else {
            lastAccepted = sig;
            const fear = blendshapeScore(result?.faceBlendshapes?.[0]?.categories, FEAR_SHAPES);
            const amusement = blendshapeScore(result?.faceBlendshapes?.[0]?.categories, AMUSEMENT_SHAPES);
            if (elapsed > 1200) {
              if (fear > maxFear) maxFear = fear;
              if (amusement > maxAmusement) maxAmusement = amusement;
            }

            samples.push({ t: elapsed, ...sig });
            if (!baseline && elapsed > 1200) {
              const early = samples.filter((s) => s.t <= 1200);
              baseline = {
                dx: early.reduce((a, s) => a + s.dx, 0) / early.length,
                dy: early.reduce((a, s) => a + s.dy, 0) / early.length,
                scale: early.reduce((a, s) => a + s.scale, 0) / early.length,
              };
            }
            onTick?.({
              faceFound: true,
              dx: baseline ? sig.dx - baseline.dx : 0,
              dy: baseline ? sig.dy - baseline.dy : 0,
              scaleRatio: baseline ? sig.scale / baseline.scale : 1,
            });
          }
        } else {
          if (elapsed > 1200) lostMs += Math.max(0, frameDelta); // 초기 캘리브레이션 구간은 제외
          onTick?.({ faceFound: false });
        }
      }

      if (elapsed >= durationMs) { resolve(); return; }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
  });
  cancelAnimationFrame(raf);

  const lostTrackingSec = Number((lostMs / 1000).toFixed(2));
  maxFear = Number(maxFear.toFixed(3));
  maxAmusement = Number(maxAmusement.toFixed(3));

  // 얼굴을 거의 못 잡았어도(예: 관찰 내내 옆/뒤를 봄) 실패로 버리지 않는다 —
  // "계속 얼굴이 안 잡혔다" 자체가 강한 행동 신호다 (§2 개구리 사각지대 대응).
  if (!baseline || samples.length < 10) {
    return {
      ok: true,
      metrics: {
        maxAbsDx: 0, maxAbsDy: 0, maxScaleDrop: 0, reversals: 0,
        sustainedSec: 0, recoveryMs: durationMs, lostTrackingSec, maxFear, maxAmusement,
      },
    };
  }

  const dev = samples
    .filter((s) => s.t > 1200)
    .map((s) => ({
      t: s.t,
      dx: s.dx - baseline.dx,
      dy: s.dy - baseline.dy,
      scaleDrop: baseline.scale - s.scale,
    }));

  let maxAbsDx = 0, maxAbsDy = 0, maxScaleDrop = 0, peakT = 0;
  let reversals = 0, lastSign = 0;
  let sustainedMs = 0;

  for (const d of dev) {
    if (Math.abs(d.dx) > maxAbsDx) { maxAbsDx = Math.abs(d.dx); peakT = d.t; }
    if (Math.abs(d.dy) > maxAbsDy) maxAbsDy = Math.abs(d.dy);
    if (d.scaleDrop > maxScaleDrop) maxScaleDrop = d.scaleDrop;

    if (Math.abs(d.dx) > NOISE_TH) {
      sustainedMs += 1000 / 30; // 대략적인 프레임 간격 가중치
      const sign = Math.sign(d.dx);
      if (lastSign !== 0 && sign !== lastSign) reversals++;
      lastSign = sign;
    }
  }

  const after = dev.filter((d) => d.t >= peakT);
  const recoveredAt = after.find((d) => Math.abs(d.dx) < NOISE_TH * 0.7);
  const recoveryMs = recoveredAt ? recoveredAt.t - peakT : durationMs - peakT;

  return {
    ok: true,
    metrics: {
      maxAbsDx: Number(maxAbsDx.toFixed(3)),
      maxAbsDy: Number(maxAbsDy.toFixed(3)),
      maxScaleDrop: Number(maxScaleDrop.toFixed(3)),
      reversals,
      sustainedSec: Number((sustainedMs / 1000).toFixed(2)),
      recoveryMs: Math.round(recoveryMs),
      lostTrackingSec,
      maxFear,
      maxAmusement,
    },
  };
}

// 정류장_스크립트_v2.md §2-4 규칙을 웹캠 지표로 옮긴 소프트 스코어 버전.
// 하드 라벨 대신 {R,H,C} 0~1 점수(합=1)를 반환해서 다른 채널과 가중합할 수 있게 한다.
// 자세한 근거는 Bus/규격/판정_기준.md 참고 — 임계값은 전부 잠정치.
export function judgeFromBehavior(metrics) {
  if (!metrics) {
    return { scores: { R: 1, H: 0, C: 0 }, reason: "관찰 실패 — 로맨스 디폴트" };
  }

  // 코 위치 기반 추정치(내 임의 임계값)에, 실제 학습된 표정 모델이 준
  // 공포/놀람 표정 점수(maxFear)를 하나의 증거로 같이 넣는다 — 손으로 얼굴을
  // 가려서 좌표가 튀는 것과 진짜 겁먹은 표정을 구분하는 데 도움이 된다.
  const rawDefensiveSig = clamp01(Math.max(
    metrics.maxScaleDrop / SCALE_DROP_TH,
    metrics.maxAbsDy / 0.12,
    (metrics.lostTrackingSec || 0) / 2,
    metrics.maxFear || 0
  ));
  // 웃을 때 고개를 뒤로 젖히는 동작이 "겁먹어서 뒤로 뺌"으로 오판되는 걸
  // 막는다 — 표정 모델이 뚜렷한 웃음을 감지했으면 방어 신호를 깎는다
  // (리허설에서 발견: 웃었는데 공포로 판정됨).
  const defensiveSig = clamp01(rawDefensiveSig * (1 - (metrics.maxAmusement || 0) * 0.8));
  const sustainedSig = clamp01(metrics.sustainedSec / (SUSTAINED_SEC_TH * 1.5));
  const slowRecoverySig = clamp01(metrics.recoveryMs / SLOW_RECOVERY_MS);
  // v2.md §2-4는 "방어 반응 그리고 지속 경계 그리고 느린 회복 — 셋 다"라고
  // 명시한다(AND). 이전엔 이 셋을 평균해서, 방어 반응이 전혀 없어도(defensiveSig=0)
  // 그냥 한 곳을 오래 차분히 쳐다보기만 하면(sustainedSig·slowRecoverySig만 높음)
  // 평균이 올라가 공포로 오판되는 버그가 있었다 — 정확히 로맨스의 진짜 신호
  // ("관심을 갖고 계속 지켜봄")를 공포로 뒤집어 읽는 구조였다. 평균 대신
  // 최솟값(퍼지 AND)을 써서, 셋 중 하나라도 0에 가까우면 H 전체가 낮게 유지되게 한다.
  const H = Math.min(defensiveSig, sustainedSig, slowRecoverySig);

  const exploreSig = clamp01(metrics.reversals / 3);
  const fastRecoverySig = clamp01(1 - metrics.recoveryMs / FAST_RECOVERY_MS);
  const amusementSig = metrics.maxAmusement || 0;
  // 마찬가지로 "탐색 그리고 빠른 회복"은 AND(최솟값)로, 표정에서 온 웃음
  // 증거(amusementSig)는 움직임 패턴과 무관하게 독립적으로 코미디를 지지할 수
  // 있어야 하므로 OR(최댓값)로 합친다.
  const C = Math.max(Math.min(exploreSig, fastRecoverySig), amusementSig);

  const R = clamp01(1 - Math.max(H, C));
  const sum = R + H + C || 1;

  const reason = H >= C && H > R
    ? "방어 반응·지속 경계·느린 회복 신호"
    : C > R
      ? "탐색(방향 전환)·빠른 회복 신호"
      : "낮은/모호한 반응";

  return { scores: { R: R / sum, H: H / sum, C: C / sum }, reason };
}

// 행동/텍스트/음성 세 채널의 {R,H,C} 소프트 점수를 가중합한다.
// 가중치는 Bus/규격/판정_기준.md §3 표와 동일 (행동 50 · 텍스트 30 · 음성 20).
//
// 2026-08-22 갱신 — 연속 블렌딩 채택(Bus/규격/구현_리스크와_지원_필요사항.md §3).
// 예전엔 여기서 argmax로 승자 하나를 뽑아 로맨스 디폴트로 떨어뜨렸는데, 그건
// 원안(7조_버스정류장.md)의 핵심 주장인 "연속 파라미터 블렌딩"과 반대되는
// 단순화였다. 이제 승자를 뽑지 않고 {R,H,C} 벡터를 그대로 반환한다.
// `dominant`/`secondary`는 그림·대사처럼 원래 이산적인 자산을 고를 때만
// 쓰는 보조 라벨이지, 판정 결과 자체는 아니다.
export function fuseChannels({ behaviorScores, textScores, voiceScores }) {
  const w = CHANNEL_WEIGHTS;
  const channels = [];
  if (behaviorScores) channels.push([behaviorScores, w.behavior]);
  if (textScores) channels.push([textScores, w.text]);
  if (voiceScores) channels.push([voiceScores, w.voice]);

  if (!channels.length) {
    const scores = { R: 1, H: 0, C: 0 };
    return { scores, dominant: "R", secondary: null, confidence: 1, reason: "신호 없음 — 로맨스 디폴트" };
  }

  const totalW = channels.reduce((a, [, cw]) => a + cw, 0);
  const fused = { R: 0, H: 0, C: 0 };
  for (const [sc, cw] of channels) {
    for (const g of ["R", "H", "C"]) fused[g] += (sc[g] || 0) * (cw / totalW);
  }

  const sorted = Object.entries(fused).sort((a, b) => b[1] - a[1]);
  const [dominant] = sorted[0];
  const [secondary, secondaryScore] = sorted[1];

  return {
    scores: fused,
    dominant,
    secondary: secondaryScore > 0.15 ? secondary : null, // 보조 장르로 취급할 최소 비중
    confidence: confidenceOf(fused),
    reason: `${dominant} 우세 (${Math.round(sorted[0][1] * 100)}%)`,
  };
}

// 벡터가 얼마나 "뚜렷한지"를 섀넌 엔트로피로 잰다 — 이산 분류 때는
// "1등-2등 점수 차이"로 충분했지만, 연속 벡터에서는 {0.34,0.33,0.33}(고르게
// 섞임 → 재질문 필요)과 {0.7,0.2,0.1}(뚜렷하지만 순수하지 않음 → 재질문
// 불필요)을 구분해야 한다. 1에 가까울수록 확신, 0에 가까울수록(고르게
// 섞임) 재질문 후보. 근거: Bus/규격/구현_리스크와_지원_필요사항.md §4-4.
export function confidenceOf(scores) {
  const vals = Object.values(scores).filter((v) => v > 0);
  if (!vals.length) return 0;
  const entropy = -vals.reduce((a, p) => a + p * Math.log(p), 0);
  const maxEntropy = Math.log(3); // 장르 3개 균등 분포일 때 최대
  return clamp01(1 - entropy / maxEntropy);
}

// 값이 계속 갱신될 때(예: 재질문 후 답을 더 들었을 때) 급변 없이 완만하게
// 따라가게 한다. 근거: 구현_리스크와_지원_필요사항.md §4-3 (파라미터 떨림).
export function smoothScores(prev, next, alpha = 0.4) {
  if (!prev) return next;
  const out = {};
  for (const g of ["R", "H", "C"]) out[g] = prev[g] * (1 - alpha) + next[g] * alpha;
  const sum = out.R + out.H + out.C || 1;
  return { R: out.R / sum, H: out.H / sum, C: out.C / sum };
}
