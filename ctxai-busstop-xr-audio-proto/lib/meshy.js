// Meshy(이미지→3D) API 얇은 래퍼 — 서버 전용.
//
// 지금 있는 일러스트(Bus/ArtWork_Final)는 3D 모델링 도구 없이는 GLB가 될 수
// 없어서, 이미지 한 장을 넣으면 대략적인 3D 메시를 만들어 주는 외부 서비스를
// 붙인다. 정확도는 낮지만(일러스트 화풍이 그대로 옮겨지진 않음), 지금의 빈
// 와이어프레임보다는 낫다는 판단 — 사용자 확인 후 진행.
//
// 문서: https://docs.meshy.ai/en/api/image-to-3d
// 생성은 비동기(수십 초~수 분) — createImageTo3DTask()로 작업을 만들고
// getImageTo3DTask(id)로 상태를 폴링한다. 완료되면 model_urls.glb 에
// 서명된(시간제한) 다운로드 URL이 생긴다 — 받는 즉시 우리 저장소로 옮겨야 한다.

const MESHY_BASE = "https://api.meshy.ai/openapi/v1";

export function isMeshyConfigured() {
  return !!process.env.MESHY_API_KEY;
}

function authHeaders() {
  return {
    Authorization: `Bearer ${process.env.MESHY_API_KEY}`,
    "Content-Type": "application/json",
  };
}

/**
 * 이미지→3D 작업 생성.
 * @param {object} opts
 * @param {string} opts.imageUrl - 공개 URL 또는 data: URI (base64)
 * @param {string} [opts.aiModel] - "meshy-5" | "meshy-6" | "meshy-7" | "latest"
 * @param {string} [opts.modelType] - "standard" | "smart-topology" | "lowpoly"
 * @param {number} [opts.targetPolycount]
 * @param {string} [opts.texturePrompt]
 * @returns {Promise<string>} task id
 */
export async function createImageTo3DTask({
  imageUrl,
  aiModel = "latest",
  modelType = "standard",
  targetPolycount = 30000,
  texturePrompt,
}) {
  if (!imageUrl) throw new Error("imageUrl 이 필요합니다");
  const body = {
    image_url: imageUrl,
    ai_model: aiModel,
    model_type: modelType,
    should_texture: true,
    target_polycount: targetPolycount,
    target_formats: ["glb"],
  };
  if (texturePrompt) body.texture_prompt = texturePrompt.slice(0, 600);

  const res = await fetch(`${MESHY_BASE}/image-to-3d`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Meshy 작업 생성 실패 (${res.status}): ${data?.message || JSON.stringify(data)}`);
  }
  return data.result;
}

/** 작업 상태 조회 — status: PENDING | IN_PROGRESS | SUCCEEDED | FAILED */
export async function getImageTo3DTask(id) {
  const res = await fetch(`${MESHY_BASE}/image-to-3d/${id}`, {
    headers: authHeaders(),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Meshy 상태 조회 실패 (${res.status}): ${data?.message || JSON.stringify(data)}`);
  }
  return data;
}
