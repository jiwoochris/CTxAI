// 대사 사전 생성 풀 — "대사도 배합을 따른다"를 실시간 LLM 없이 구현하기 위한 오프라인 단계.
//
// 반응형_실시간_영화.md §7-4. 대사 46줄(장르별 인물)에 대해, 보조 장르가 섞였을 때의
// 변주(예: 로맨스 인물이 공포 35%일 때 — 같은 말을 조금 경계하며)를 LLM으로 미리 쓰고,
// 원문·변주 전부를 같은 목소리(OpenRouter 오디오 모델)로 떠 둔다. 실행 시에는 연출 상태의
// 보조 장르 비중을 보고 가장 가까운 변주를 고른다(근접 매칭). 지연 0, 비용은 여기서 한 번.
//
// 결과: public/reactive/audio/pool/manifest.json + {G}_{base|S}_{seq}.m4a
//   G = 앉는 인물의 장르(R/H/C), S = 보조 장르. base 는 원문.
//
// 사용: OPENROUTER_API_KEY=... node scripts/gen-dialogue-pool.mjs [--only R] [--dry]
//   이미 있는 파일은 건너뛴다(재실행 안전). m4a 변환은 macOS afconvert 를 쓴다(없으면 wav 유지).
//
// 주의: 변주 텍스트는 LLM 초안이다. 요청서 v5.0 D9의 원칙대로 기획이 고르고 고치는 재료이지
// 확정 대사가 아니다. 원문(base)은 한 글자도 바꾸지 않는다.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DIALOGUE_V2_LINES } from "../lib/dialogueV2Lines.js";

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error("OPENROUTER_API_KEY 가 필요합니다"); process.exit(1); }
const ARGS = process.argv.slice(2);
const ONLY = ARGS.includes("--only") ? ARGS[ARGS.indexOf("--only") + 1] : null;
const DRY = ARGS.includes("--dry");
const REDO_MISMATCH = ARGS.includes("--redo-mismatch"); // 낭독 전사가 원문과 다른 줄만 다시 합성

// 전사 비교용 정규화 — 구두점·공백·말줄임·대괄호 지시([웃음] 등)는 무시하고 글자만 본다.
function norm(s) { return String(s || "").replace(/\[[^\]]*\]/g, "").replace(/[\s.,!?…·'"“”‘’~\-—()]/g, ""); }
function mismatch(entry) { return !!entry.transcript && norm(entry.transcript) !== norm(entry.text); }

const OUT = path.resolve("public/reactive/audio/pool");
fs.mkdirSync(OUT, { recursive: true });
const MANIFEST = path.join(OUT, "manifest.json");
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : { voices: {}, lines: [] };
manifest.tints = manifest.tints || {}; // "G_S" → [{seq,text}] — LLM 변주 텍스트 원본(합성 전 보존)
if (REDO_MISMATCH) {
  const bad = manifest.lines.filter(mismatch);
  console.log(`전사 불일치 ${bad.length}줄 재합성`);
  for (const b of bad) { try { fs.unlinkSync(path.join(OUT, b.file)); } catch { /* 없음 */ } }
  manifest.lines = manifest.lines.filter((l) => !mismatch(l));
}

// Haiku 4.5 기본 — Sonnet 5는 OpenRouter 경유 시 사고 토큰이 max_tokens 를 먹어 JSON이 잘리는 일이 있었다(실측).
const LLM_MODEL = process.env.OPENROUTER_POOL_MODEL || "anthropic/claude-haiku-4.5";
const TTS_MODEL = process.env.OPENROUTER_TTS_MODEL || "openai/gpt-audio-mini";
const GENRES = ["R", "H", "C"];
const CHARACTER = {
  R: { who: "20대 여성. 생애 첫 면접을 앞두고 들떠 있고 긴장한 수다쟁이. 정류장 옆자리에 앉은 낯선 사람에게 혼잣말처럼 말을 건다.", voice: "shimmer", base: "밝고 조금 들뜬, 말이 빠른 20대 여성" },
  H: { who: "중년 남성. 낮고 담담하다. 표정은 무해한데 질문이 무해하지 않다. 정면을 본 채로 말한다.", voice: "onyx", base: "낮고 담담한, 감정을 드러내지 않는 중년 남성. 느리고 또박또박" },
  C: { who: "70대 할머니. 퉁명스럽지만 웃음기가 있다. 잃어버린 고양이를 찾는 척하지만 사실은 오래전에 떠난 남편을 찾고 있다.", voice: "sage", base: "퉁명스럽고 걸걸한 70대 할머니, 웃음기가 배어 있음" },
};
const TINT = {
  R: { attitude: "따뜻함·호감·기대가 배어든다. 상대에게 조금 더 가까이 가려는 말투", style: "조금 더 따뜻하고 부드럽게, 상대에게 마음이 기운 듯" },
  H: { attitude: "경계·불안·미묘한 위협이 배어든다. 말끝이 흔들리거나 뜻이 두 겹으로 읽힌다", style: "약간 낮고 조심스럽게, 말끝이 살짝 흔들리게" },
  C: { attitude: "가벼움·자조·엇박자의 유머가 배어든다. 진지한 말도 어딘가 우스워진다", style: "가볍고 장난기 있게, 웃음이 새어 나올 듯" },
};
manifest.voices = Object.fromEntries(GENRES.map((g) => [g, CHARACTER[g].voice]));

const FALLBACK_LLM = "anthropic/claude-sonnet-5";
async function llmTint(G, S, lines, model = LLM_MODEL) {
  const prompt = `당신은 XR 연극 <정류장>의 대사 각색자입니다.
인물: ${CHARACTER[G].who}
아래는 이 인물의 확정 대사 ${lines.length}줄입니다(순서대로). 지금 이 장면은 관객 반응으로 "${S}" 장르가 약 35% 섞인 상태입니다.
${S} 장르의 태도: ${TINT[S].attitude}

각 줄을 다음 규칙으로 변주하세요.
- 말하는 내용·정보·사건은 그대로. 태도와 어법만 ${S} 쪽으로 35%만 기울인다 (완전히 바꾸지 않는다).
- 길이는 원문의 80~120%. 한 줄은 한 줄로. 고유명사·숫자·버스 번호는 그대로.
- 관객에게 답을 요구하지 않는다. 질문이어도 답을 기다리지 않는 질문이어야 한다.
- 한국어 구어. 지시문·괄호·따옴표·설명 없이 대사만.

JSON 객체 하나만 출력: {"lines":[{"seq":"01","text":"..."}, ...]} (seq 는 원문과 동일, ${lines.length}개 전부)

원문:
${lines.map((l) => `${l.seq}: ${l.text}`).join("\n")}`;

  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 6000,
      reasoning: { enabled: false },
      response_format: {
        type: "json_schema",
        json_schema: { name: "tint", strict: true, schema: { type: "object", properties: { lines: { type: "array", items: { type: "object", properties: { seq: { type: "string" }, text: { type: "string" } }, required: ["seq", "text"], additionalProperties: false } } }, required: ["lines"], additionalProperties: false } },
      },
    }),
  });
  const d = await r.json();
  if (d.error) throw new Error(`llm ${G}/${S}: ${d.error.message}`);
  const content = d.choices?.[0]?.message?.content;
  const text = typeof content === "string" ? content : (content || []).map((p) => p.text || "").join("");
  if (!text.trim()) {
    console.error(`  llm ${G}/${S} 빈 응답 (finish=${d.choices?.[0]?.finish_reason}, model=${model}) — 재시도`);
    if (model !== FALLBACK_LLM) return llmTint(G, S, lines, FALLBACK_LLM);
    throw new Error(`llm ${G}/${S}: empty`);
  }
  const start = text.indexOf("{");
  try {
    return JSON.parse(text.slice(start)).lines;
  } catch (e) {
    console.error(`  llm ${G}/${S} JSON 파싱 실패 (finish=${d.choices?.[0]?.finish_reason}, model=${model}): ${text.slice(0, 80)}…`);
    if (model !== FALLBACK_LLM) return llmTint(G, S, lines, FALLBACK_LLM);
    throw e;
  }
}

function wavHeader(pcmBytes, sr = 24000) {
  const b = Buffer.alloc(44);
  b.write("RIFF", 0); b.writeUInt32LE(36 + pcmBytes, 4); b.write("WAVE", 8);
  b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(pcmBytes, 40);
  return b;
}

async function tts(text, voice, style) {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: TTS_MODEL, stream: true, modalities: ["text", "audio"], audio: { voice, format: "pcm16" },
      messages: [
        { role: "system", content: "당신은 한국어 성우입니다. 사용자가 준 문장을 한 글자도 바꾸지 않고, 덧붙이지 않고, 지시된 어조로 정확히 한 번만 낭독합니다. 문장 앞뒤에 어떤 말도 하지 않습니다." },
        { role: "user", content: `어조: ${style}\n낭독할 문장: ${text}` },
      ],
    }),
  });
  if (!r.ok || !r.body) throw new Error(`tts ${r.status}`);
  const chunks = []; let buf = ""; let transcript = "";
  const reader = r.body.getReader(); const dec = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim(); if (payload === "[DONE]") continue;
      let evt; try { evt = JSON.parse(payload); } catch { continue; }
      if (evt.error) throw new Error(`tts provider: ${evt.error.message}`);
      for (const ch of evt.choices || []) { const a = ch.delta?.audio; if (!a) continue; if (a.data) chunks.push(Buffer.from(a.data, "base64")); if (a.transcript) transcript += a.transcript; }
    }
  }
  const pcm = Buffer.concat(chunks);
  if (!pcm.length) throw new Error("tts no audio");
  return { wav: Buffer.concat([wavHeader(pcm.length), pcm]), transcript };
}

function toM4a(wavPath) {
  const m4a = wavPath.replace(/\.wav$/, ".m4a");
  try {
    execFileSync("afconvert", ["-f", "m4af", "-d", "aac", "-b", "64000", wavPath, m4a], { stdio: "ignore" });
    fs.unlinkSync(wavPath);
    return path.basename(m4a);
  } catch { return path.basename(wavPath); }
}

async function pool(tasks, n, fn) {
  const q = [...tasks]; const out = [];
  await Promise.all(Array.from({ length: n }, async () => { while (q.length) { const t = q.shift(); try { out.push(await fn(t)); } catch (e) { console.error("  fail", t.key, e.message); } } }));
  return out;
}

const targets = GENRES.filter((g) => !ONLY || g === ONLY);
const jobs = [];
for (const G of targets) {
  const base = DIALOGUE_V2_LINES.filter((l) => l.genre === G);
  for (const l of base) jobs.push({ key: `${G}_base_${l.seq}`, G, S: "base", seq: l.seq, text: l.text, style: CHARACTER[G].base });
  for (const S of GENRES.filter((s) => s !== G)) {
    const tintKey = `${G}_${S}`;
    let tinted = manifest.tints[tintKey];
    if (!tinted || tinted.length !== base.length) {
      console.log(`LLM 변주 ${G}←${S} (${base.length}줄)`);
      try {
        tinted = DRY ? base.map((l) => ({ seq: l.seq, text: l.text })) : await llmTint(G, S, base);
        manifest.tints[tintKey] = tinted;
        fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
      } catch (e) { console.error("  건너뜀", tintKey, e.message); continue; }
    }
    for (const l of base) {
      const v = tinted.find((x) => x.seq === l.seq);
      if (!v) continue;
      jobs.push({ key: `${G}_${S}_${l.seq}`, G, S, seq: l.seq, text: v.text, style: `${CHARACTER[G].base}. ${TINT[S].style}` });
    }
  }
}
console.log(`합성 대상 ${jobs.length}줄 (모델 ${TTS_MODEL})`);

await pool(jobs, 6, async (j) => {
  const done = manifest.lines.find((m) => m.genre === j.G && m.secondary === j.S && m.seq === j.seq && m.file && fs.existsSync(path.join(OUT, m.file)));
  if (done) return done;
  if (DRY) { console.log("  dry", j.key, j.text); return null; }
  let { wav, transcript } = await tts(j.text, CHARACTER[j.G].voice, j.style);
  if (norm(transcript) !== norm(j.text)) {
    const retry = await tts(j.text, CHARACTER[j.G].voice, j.style);
    if (norm(retry.transcript) === norm(j.text) || retry.transcript.length < transcript.length) ({ wav, transcript } = retry);
  }
  const wavPath = path.join(OUT, `${j.key}.wav`);
  fs.writeFileSync(wavPath, wav);
  const file = toM4a(wavPath);
  const entry = { genre: j.G, secondary: j.S, seq: j.seq, text: j.text, file, transcript };
  manifest.lines = manifest.lines.filter((m) => !(m.genre === j.G && m.secondary === j.S && m.seq === j.seq));
  manifest.lines.push(entry);
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  console.log("  ok", j.key, `"${j.text}"`, transcript === j.text ? "" : `(낭독: ${transcript.slice(0, 40)})`);
  return entry;
});

manifest.lines.sort((a, b) => a.genre.localeCompare(b.genre) || a.secondary.localeCompare(b.secondary) || a.seq.localeCompare(b.seq));
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
console.log("done", manifest.lines.length, "lines →", OUT);
