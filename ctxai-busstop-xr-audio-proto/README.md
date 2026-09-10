# 정류장 — 프로젝트 앱 (Next.js)

KAIST CTxAI 캡스톤 7조 <버스 정류장>의 팀 도구이자 체험 프로토타입입니다. 한 저장소 안에
팀 대시보드(할 일·에셋·오디오 듣기)와 관객용 체험 화면이 같이 들어 있습니다.

## 체험 화면 — 어느 것을 열어야 하나

| 주소 | 무엇 | 상태 |
|---|---|---|
| **`/film`** | **반응형 실시간 영화.** 관객이 어디를 보고 어떻게 움직이는지가 체험 내내 하늘·빛·안개·가로등·옆사람의 거리와 시선·대사 간격·BGM·대사 변주를 움직인다. 헤드셋(WebXR)과 데스크톱 드래그 모두 지원 | 2026-09-10 · 현재 기준 |
| `/story-vr` | 관찰 11초 → 판정 1회 → 고정 장면. 3D 그레이박스 + WebXR | 이전 버전 |
| `/story-v2` | 위와 같은 판정에 2D 원화 배경 | 이전 버전 |
| `/story` | 장르 하나를 확정하는 v1 | 구버전 |

`/film` URL 옵션: `?speed=3`(영화 시간 배속) · `?cam=0`(웹캠 채널 끄기) · `?hud=0`(HUD 숨김) ·
`?rig=0`(리깅 캐릭터 대신 캡슐) · `?pool=1`(대사 변주 풀) · `?bias=H:2.5`(강제 배합, 발표·QA용) · `?rigtest=1`(캐릭터 점검)

설계와 매핑표, 남은 일은 [`Bus/규격/반응형_실시간_영화.md`](../Bus/규격/반응형_실시간_영화.md).

## 로컬 실행

```bash
npm install
npm run pull-assets   # 팀 대시보드에 올라간 오디오를 public/reactive/audio/ 로 (최초 1회, 이미 커밋돼 있으면 생략)
npm run film          # dev 서버 — 셸에 NODE_ENV·TURBOPACK 이 잡혀 있어도 안전
```

`http://localhost:3000/film`. 헤드폰 권장. 빌드는 `npm run build:clean`, 회귀 테스트는 `npm test`.

`/film`은 외부 서비스 없이 돕니다. 실시간 대사 생성(`/api/dialogue`)·음성 합성(`/api/tts`)·STT와 톤 분석(`/api/mood`, `/api/voicetone`)을 쓸 때만
`.env.local`에 `OPENROUTER_API_KEY` 하나가 필요합니다.

## 구조

```
app/film/                 반응형 실시간 영화 페이지 (디렉터·오디오·대사 루프·HUD·종료 카드)
app/api/session/          세션 기록 저장 (data/sessions/) + 자기보고 일치율 집계
lib/directionState.js     연출 상태 — 증거 누적·완만 추종·정착도·확신도·궤적
lib/directionMap.js       매핑표(온톨로지) — 장르 앵커값, 사건 트리거, BGM 게인
lib/headPoseSense.js      헤드 포즈 센서 — 사건별·창 단위 증거
lib/filmTimeline.js       타임라인 — 다섯 사건과 배우 위치(시간의 순수 함수)
lib/dialoguePool.js       대사 풀 근접 매칭
components/ReactiveStage.jsx  반응형 무대 (BlockoutStage 지형 재사용, 리깅 임시 배우)
public/reactive/audio/    대사 46줄·SFX 18·BGM 3·안내방송 (+ pool/ 변주 138줄)
public/reactive/models/   Meshy 리깅 캐릭터 (meshopt, 5~7MB)
scripts/                  pull-assets · gen-dialogue-pool · sim-headpose · test-direction · synthesize-dialogue(레거시)
```

대시보드·업로드·할 일·조명 프리셋(`/`, `/todo`, `/upload`, `/whitebox`, `/vo`, `/sfx`)은 8월 구조 그대로이며 Supabase를 씁니다.
그쪽은 `ONBOARDING.md`를 보세요.
