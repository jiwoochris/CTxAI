# 목소리 → 4장르 채점 파이프라인

관객 발화를 텍스트로 바꾸고, 공포/로맨스/코미디/판타지 4가지 점수(0~1)로 채점하는 백엔드.
설계 배경은 Notion 문서 「정류장 — 아무도 같은 밤을 보지 않는다」 §7 참고.

## 원리

```
오디오 파일 → ① STT(Whisper) → 한국어 텍스트 → ② LLM 채점(Claude Haiku) → 4장르 점수 JSON
```

1. **STT** — 오디오를 OpenRouter의 `openai/whisper-1`로 보내 한국어 텍스트로 전사한다.
2. **채점** — 전사된 텍스트를 `anthropic/claude-haiku-4.5`에 "공포/로맨스/코미디/판타지 점수를 JSON으로만 출력해"라는 프롬프트로 보낸다. 복잡한 추론이 아니라 단순 분류라 가장 싸고 빠른 모델로 충분하다.

두 호출 모두 **`OPENROUTER_API_KEY` 하나**로 처리한다. OpenAI/Anthropic 개별 키는 쓰지 않는다 — 이미 검증된 키 하나로 두 단계를 다 처리하는 쪽이 새 키 발급보다 빠르다는 판단(Bus/test_pipeline.sh 에서 최초 검증).

## 구성 요소

| 파일 | 역할 |
|---|---|
| [`app/api/mood/route.js`](../app/api/mood/route.js) | STT + 채점을 순서대로 호출하는 API 라우트. 입력: `multipart/form-data`의 `audio` 필드. 출력: `{ ok, transcript, scores, meta }` |
| [`components/GenreScores.jsx`](../components/GenreScores.jsx) | 전사문 + 4장르 막대그래프 표시 (1단계·2단계 공용) |
| [`components/PipelineCheck.jsx`](../components/PipelineCheck.jsx) | 1단계 UI — 사전 녹음 샘플 재생 |
| [`components/MoodRecorder.jsx`](../components/MoodRecorder.jsx) | 2단계 UI — 실시간 마이크 녹음 |
| [`lib/moodMix.js`](../lib/moodMix.js) | 3단계 로직 — 장르별 배경 루프 합성 + 상위 2개 크로스페이드 믹서 |
| [`components/SoundMixer.jsx`](../components/SoundMixer.jsx) | 3단계 UI — 믹서 켜기/끄기, 현재 섞이는 소리 표시 |
| [`app/verify/page.js`](../app/verify/page.js) | 1·2·3단계를 한 페이지에서 확인하는 전용 화면 (`/verify`) |
| `public/samples/*.m4a` | 1단계용 사전 녹음 샘플 (공포·로맨스·코미디·판타지·혼합) |

## 3단계 — 소리 섞기 (3D보다 먼저)

1·2단계가 만든 점수를 실제로 **들리는 반응**으로 바꾸는 단계. Notion 문서 §3 "함정 하나 — 전부
섞으면 색이 사라진다"의 사운드 버전 구현이다.

```
scores { horror, romance, comedy, fantasy } → 상위 2개만 추출 → GainNode 4개에 반영 → 크로스페이드 재생
```

- [`lib/moodMix.js`](../lib/moodMix.js) — 장르별 연속 배경 루프(오실레이터 + 트레몰로 LFO로 합성한
  placeholder, 실제 녹음 음원 없는 현재 단계 전제) 4개를 항상 재생해두고, `setScores()`가 호출될 때마다
  점수를 **상위 2개만 남기고 나머지는 0으로** 만든 뒤 `GainNode.gain`을 0.8초에 걸쳐 부드럽게
  크로스페이드한다. 왜 상위 2개만인가: 4개를 다 반영하면 탁한 회색이 되어 아무 인상도 남지 않는다는
  설계 규칙을 사운드에도 그대로 적용한 것.
- [`components/SoundMixer.jsx`](../components/SoundMixer.jsx) — 믹서 켜기/끄기 버튼과 "지금 섞이는
  소리" 표시. Web Audio 오실레이터는 한 번 멈추면 재시작할 수 없으므로, 끌 때마다 믹서 인스턴스를
  버리고 켤 때 새로 만든다.
- `/verify` 페이지에서 1단계(샘플 재생)·2단계(마이크 녹음) 중 하나가 분석을 끝내면 그 점수가 그대로
  `SoundMixer`로 흘러들어가 즉시 배경음이 바뀐다 — 3D 없이 "오, 반응한다"를 확인하는 지점이자, 페어
  테스트(두 사람에게 다른 배합을 들려주고 "뭐 들었어?"를 비교)를 지금 단계만으로 돌릴 수 있는 지점.

## 1단계 vs 2단계 — 무엇이 다른가

두 단계는 `/api/mood` 이후 로직이 완전히 동일하다. 차이는 **오디오를 어디서 가져오는가** 뿐이다.

- **1단계 (PipelineCheck)**: `public/samples/`의 사전 녹음 파일을 `fetch`로 읽어 그대로 전송. 마이크가 개입하지 않으므로 **STT+LLM 파이프라인 자체의 정확도**만 순수하게 검증한다. 순수 장르 샘플은 해당 점수가 뚜렷하게 높고, 혼합 샘플(공포+로맨스+코미디+판타지가 뒤섞인 문장)은 여러 장르가 고르게 나와야 정상이다.
- **2단계 (MoodRecorder)**: `getUserMedia`로 마이크 권한을 받고 `MediaRecorder`로 실시간 녹음 → 정지 시 `webm` 블롭을 조립해 동일한 엔드포인트로 전송. **마이크 권한, 실제 녹음 인코딩, 네트워크 왕복**까지 실전과 동일한 경로를 검증한다.

즉 1단계는 "두뇌(STT+LLM)가 맞게 도는가", 2단계는 "입(마이크)에서 두뇌까지 배선이 맞는가"를 분리해서 확인하는 구조다.

## 알아둘 점 / 겪었던 이슈

- **Whisper는 파일명 확장자로 컨테이너 포맷을 판단한다.** 실제 바이트와 확장자가 어긋나면(예: m4a 파일에 `.webm` 이름을 붙임) 400 에러가 난다. `route.js`의 `extensionFor()`가 업로드된 파일의 실제 MIME 타입에서 확장자를 뽑아내 이 문제를 막는다.
- LLM 채점 호출에서 간헐적으로 `llm_network` 오류가 날 수 있다(OpenRouter 쪽 일시적 네트워크 지연). 현재 별도 재시도 로직은 없음 — 재시도가 필요해지면 추가 고려.
- 키가 없으면 두 기능 모두 `503 { configured: false }`를 반환하고 클라이언트가 안내 메시지를 보여준다(다른 라우트인 `dialogue`, `tts`와 동일한 컨벤션).

## 다음 단계 후보

- Meta Quest 브라우저에서 마이크 권한·녹음이 안정적으로 도는지 확인 (Notion 문서 §10 "8월 말~9월" 항목)
- LLM 채점 프롬프트에 재시도/타임아웃 로직 추가
- 합성 배경 루프(`lib/moodMix.js`)를 실제 녹음/제작 음원으로 교체
- 빛·안개 색을 같은 점수(상위 2개)로 실시간 조절하는 로직 추가 — 8/17 시연 핵심 항목 5번
- 실제 두 사람 페어 테스트 진행하고 "너 나랑 다른 걸 봤네"가 나오는지 기록
