# 정류장(버스 정류장) 팀 온보딩 가이드

**프로젝트**: 버스 정류장 — 관객 반응 기반 실시간 서사 블렌딩 (KAIST CTxAI 캡스톤 7조)
**한 줄 소개**: 관객이 아무것도 선택하지 않아도, 행동·목소리 반응만으로 공포·로맨스·블랙코미디가 실시간으로 배합되어 완성되는 정류장 체험.

---

## 1. 지금 라이브로 뭐가 있는지

| | |
|---|---|
| 라이브 사이트 | **https://busstop-team.vercel.app** (막히면 **https://busstop-team-live.vercel.app** 로 대체) |
| GitHub | https://github.com/drew25927/CTxAI (⚠️ 모노레포입니다 — 아래 §2 참고) |
| Vercel 프로젝트 | `drew-b295/busstop-team` |
| Supabase | 프로젝트 `busstop` (ap-northeast-2) — 파일·대사오디오·SFX·할일 전부 여기 저장 |

로그인 없이 팀 전원이 같은 주소로 들어가서 확인합니다. **로컬에서 개발 서버를 켜도 실제 프로덕션과 같은 Supabase를 보므로**, 로컬에서 저장한 것도 배포 없이 바로 팀 전체에 보입니다(코드 변경만 배포가 필요).

**자주 쓰는 페이지**
- `/` (`/todo`로 자동 이동) — 할 일 목록. **여기가 실제 홈**입니다
- `/upload` — 파일 올리는 곳 (필요할 때만 들어감, 평소엔 숨김)
- `/story` (v1·기존) / `/story-v2` (v2·연속 블렌딩, 신규) — 관객용 체험 데모
- `/judge` (v1) / `/judge-v2` (v2) — 판정이 실제로 어떻게 나오는지 보는 개발자용 대시보드
- `/guide?doc=tech-direction` — 오늘 기준 기술 방향 설명 문서

---

## 2. 저장소 구조 — ⚠️ 반드시 읽으세요

이 GitHub 저장소는 **모노레포**라 우리 프로젝트가 아닌 파일이 섞여 있습니다.

```
CTxAI/
├── Bus/                          ← 우리 프로젝트 기획·규격 문서
│   ├── 규격/                     ← 판정 기준, 기술 방향, 업무 분장 등 핵심 문서
│   └── 7조_버스정류장.md          ← 원 제안서 (핵심기술 정의)
├── ctxai-busstop-xr-audio-proto/ ← 우리 프로젝트 실제 앱 (Next.js)
├── CLAUDE.md, WORLD.md, myfortune/  ← ⚠️ 다른 팀 창작 세션 파일, 우리 것 아님 — 건드리지 마세요
```

작업할 땐 `Bus/`와 `ctxai-busstop-xr-audio-proto/`만 보시면 됩니다.

---

## 3. 로컬 개발 시작하기

```bash
git clone https://github.com/drew25927/CTxAI.git
cd CTxAI/ctxai-busstop-xr-audio-proto
npm install
npm run dev
```

`http://localhost:3000` 접속. 환경 변수(`OPENROUTER_API_KEY`, Supabase 키 등)는 `.env.local`이 필요합니다 — 개발 담당에게 요청하세요 (git에는 안 올라가 있음, 의도적으로 gitignore 처리).

**배포**는 아무나 함부로 하지 말고 개발 담당과 상의 후 진행하세요:
```bash
cd ctxai-busstop-xr-audio-proto
npm run milestones   # 대시보드 "진행 상황"에 최근 커밋을 반영 (git 있는 로컬에서만 동작)
TOK=$(cat .vercel-token | tr -d '[:space:]')
npx --yes vercel deploy --prod --token="$TOK" --yes
```
`.vercel-token`도 gitignore 대상이라 따로 공유받아야 합니다.

---

## 4. 지금 뭘 하고 있는지 (2026-08-22 기준)

- **핵심 기술**: 관객 반응(행동·텍스트·음성 3채널)을 STT+LLM, 웹캠 표정 인식, 오디오 톤 분석으로 읽어서, 공포·로맨스·블랙코미디 배합 비율을 실시간으로 만듭니다. 판타지는 드롭 확정.
- **v1 vs v2**: 관객이 장르 하나를 받는 이산 버전(v1, `/story`)과, 배합 비율 자체를 유지하는 연속 블렌딩 버전(v2, `/story-v2`)이 나란히 있습니다. v2가 원래 제안서(`Bus/7조_버스정류장.md`)의 핵심 주장에 더 가깝습니다.
- **자세한 근거**: `Bus/규격/기술_발전_방향.md`, `Bus/규격/판정_기준.md`, `Bus/규격/구현_리스크와_지원_필요사항.md` 순서로 읽으면 전체 그림이 잡힙니다.

---

## 5. 역할별로 뭘 해야 하는지

`Bus/규격/방향전환_업무재분장.md`에 **기획·아트·사운드·개발 역할별로 지금 해야 할 일이 쉬운 설명과 함께** 정리돼 있습니다. 실제 할 일 체크리스트는 `/todo` 페이지에서 실시간으로 관리됩니다 — 완료하면 체크하고, 새로 생기면 자유롭게 추가해주세요.

---

## 6. 막히면

- 무엇을 만들지 헷갈리면 → `Bus/규격/기술_발전_방향.md`
- 판정이 이상하게 나오면 → `Bus/규격/판정_기준.md` (알려진 한계·잠정치들이 정리돼 있음)
- 그 외엔 개발 담당에게 GitHub 이슈나 Slack으로 편하게 물어보세요.
