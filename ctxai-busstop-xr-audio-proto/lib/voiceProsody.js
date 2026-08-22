"use client";

// 음성/준언어 채널 — "무슨 말을 했는가"가 아니라 "어떻게 말했는가"를 본다.
//
// 2026-08-22 갱신: RMS·영교차율 자체 계산(내 임의 매핑) 대신, 실제 오디오를
// 이해하는 멀티모달 모델(/api/voicetone, OpenRouter)에게 톤만 봐 달라고
// 직접 물어보는 걸 기본으로 바꿨다 — 근거 있는 판단이 우선이고, 모델 호출이
// 실패하면(네트워크 등) 기존 RMS 휴리스틱으로 폴백한다. 근거: 판정_기준.md §3.

import { decodeToWavBase64 } from "./audioEncode";

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

// 이 밑이면 사실상 침묵·배경음뿐이라 "어떻게 말했는가"를 뽑을 발화 자체가
// 없다고 본다 — 모델 호출(비용 발생)도 이 경우엔 아예 안 한다.
const NO_SPEECH_RMS = 0.012;

async function heuristicMetrics(blob) {
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const data = audioBuffer.getChannelData(0);
    const frameSize = Math.max(1, Math.floor(audioBuffer.sampleRate * 0.05));

    const frames = [];
    for (let i = 0; i + frameSize <= data.length; i += frameSize) {
      let sumSq = 0, zc = 0;
      for (let j = i; j < i + frameSize; j++) {
        sumSq += data[j] * data[j];
        if (j > i && Math.sign(data[j]) !== Math.sign(data[j - 1])) zc++;
      }
      frames.push({ rms: Math.sqrt(sumSq / frameSize), zcr: zc / frameSize });
    }
    ctx.close?.();

    if (!frames.length) return null;

    const avgRms = frames.reduce((a, f) => a + f.rms, 0) / frames.length;
    const silentFrames = frames.filter((f) => f.rms < Math.max(avgRms * 0.25, 0.01)).length;
    const silenceRatio = silentFrames / frames.length;
    const avgZcr = frames.reduce((a, f) => a + f.zcr, 0) / frames.length;
    const zcrVariance = frames.reduce((a, f) => a + (f.zcr - avgZcr) ** 2, 0) / frames.length;

    return {
      avgRms: Number(avgRms.toFixed(4)),
      silenceRatio: Number(silenceRatio.toFixed(2)),
      zcrVariance: Number(zcrVariance.toFixed(6)),
    };
  } catch {
    return null;
  }
}

// 폴백 전용 — 모델 호출이 안 될 때만 쓰는 잠정 휴리스틱. 검증된 심리음향
// 규칙이 아니다.
function heuristicScores(metrics) {
  const energetic = clamp01(metrics.avgRms / 0.08);
  const hesitant = clamp01(metrics.silenceRatio / 0.5);
  const variableTone = clamp01(metrics.zcrVariance / 0.002);

  const H = clamp01(((hesitant + variableTone) / 2) * 0.8);
  const C = clamp01(((energetic + variableTone) / 2) * 0.8);
  const R = clamp01(1 - Math.max(H, C));
  const sum = R + H + C || 1;
  return { R: R / sum, H: H / sum, C: C / sum };
}

export async function analyzeProsody(blob) {
  const metrics = await heuristicMetrics(blob);
  if (!metrics) return { scores: null, metrics: null };

  // 발화 자체가 없었으면(침묵·배경음만) 신호 없음으로 뺀다 — 텍스트 채널의
  // "말 안 하면 null"과 같은 규칙. 모델 호출도 아낀다.
  if (metrics.avgRms < NO_SPEECH_RMS) {
    return { scores: null, metrics: { ...metrics, source: "no_speech" } };
  }

  try {
    const { wavBlob } = await decodeToWavBase64(blob);
    const form = new FormData();
    form.append("audio", wavBlob, "clip.wav");
    const res = await fetch("/api/voicetone", { method: "POST", body: form });
    const data = await res.json();
    if (data?.ok) {
      const { horror, romance, comedy } = data.scores;
      const sum = horror + romance + comedy || 1;
      return {
        scores: { R: romance / sum, H: horror / sum, C: comedy / sum },
        metrics: { ...metrics, source: "model" },
      };
    }
  } catch {
    // 모델 호출 실패 — 아래 휴리스틱 폴백으로 넘어간다
  }

  return { scores: heuristicScores(metrics), metrics: { ...metrics, source: "heuristic_fallback" } };
}
