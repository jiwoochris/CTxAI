# 버스정류장 XR — 오디오 프로토타입 (Next.js)

기다림 버스정류장 XR 5-Track 프로젝트의 8/17 중간평가용 오디오 프로토타입.
공포 트랙에 대해 (1) 시각+청각 장면 체험 데모 (2) 블라인드 방향 지각 테스트 를 제공합니다.

## 현재 상태 / 알아둘 점

- 실제 녹음/제작된 음원이 없어 Web Audio API로 합성한 **테스트 음원**을 사용합니다 (`lib/audio.js`).
- 방향감은 단순 좌우 패닝이 아니라 `PannerNode`(HRTF)로 근사했습니다. 실제 전시에서는 Unity + Resonance Audio / Steam Audio(앰비소닉)로 교체될 placeholder입니다.
- 나머지 4개 트랙(스릴러/코미디/로맨스/멜로)은 사운드 이벤트 스펙이 아직 미확정이라 무드 프리뷰만 제공합니다.
- AI 대화(D 테스트)는 이번 단계 범위 밖입니다 (스펙 문서 기준 9월 항목).

관련 문서: `버스정류장XR_오디오프로토타입_스펙_2026-07-31`, `디렉터스컷_프로젝트_기준및지침_v2`.

## 로컬 실행

```bash
npm install
npm run dev
```

`http://localhost:3000` 접속. 헤드폰 착용 권장.

## GitHub 업로드

```bash
git init
git add .
git commit -m "Bus stop XR audio prototype"
git branch -M main
git remote add origin https://github.com/ctxai/<repo-이름>.git
git push -u origin main
```

## Vercel 배포

1. https://vercel.com 에서 New Project → 위 GitHub 저장소 선택
2. Framework Preset: Next.js (자동 감지됨), 별도 환경변수 없음
3. Deploy

빌드 명령/출력 디렉터리는 Next.js 기본값 그대로 사용하면 됩니다 (`next build`, `.next`).

## 폴더 구조

```
app/            Next.js App Router 페이지
components/     UI 컴포넌트 (좌석 선택, 트랙 정보, 장면 데모, 방향 테스트, 결과표)
lib/            트랙/이벤트 데이터, 오디오 합성, CSV 내보내기
```

## 다음 단계 후보

- 합성음 → 실제 녹음/제작 음원으로 교체
- 방향 테스트 결과를 로컬 CSV 다운로드가 아니라 서버/스프레드시트에 자동 적재
- 나머지 4개 트랙 사운드 이벤트 스펙 확정 후 동일 구조로 확장
