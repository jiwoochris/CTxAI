// 환경 SFX 17종 후보 — Bus/규격/SFX_후보_목록.md 와 짝입니다.
// 스톡(Freesound CC0 / Pixabay 로열티프리)에서 받아온 "후보"이며, 최종 선택은
// 아직 안 났습니다. 팀이 여기서 들어보고 고르면 됩니다.

export const SFX_CANDIDATES = [
  { key: "01", label: "낙수·빗물", file: "01_rain_dripping.mp3" },
  { key: "02", label: "타이어 (트럭 물웅덩이 튀김)", file: "02_tire_splash.mp3" },
  { key: "03a", label: "자전거", file: "03a_bicycle_passing.mp3", note: "웃음소리와 겹쳐서 사용" },
  { key: "03b", label: "웃음소리", file: "03b_laughing.mp3", note: "자전거와 겹쳐서 사용" },
  { key: "04", label: "우산", file: "04_umbrella_rain.mp3" },
  { key: "05", label: "벤치 삐걱임", file: "05_bench_creak.mp3" },
  { key: "06", label: "숨소리", file: "06_breathing.mp3" },
  { key: "07", label: "버스 저주파", file: "07_bus_idle.mp3" },
  { key: "08", label: "문닫힘", file: "08_door_close.mp3" },
  { key: "09", label: "카페 종(딸랑)", file: "09_shop_bell.mp3" },
  { key: "10", label: "개구리 울음", file: "10_frog_croak.mp3" },
  { key: "11", label: "고양이 첫 등장", file: "11_cat_meow.mp3" },
  { key: "12", label: "화면 밖 비명(냐아악)", file: "12_cat_scream.mp3" },
  { key: "13", label: "금속 그릇/화분 넘어지는 소리(달그락)", file: "13_metal_clatter.mp3" },
  { key: "14", label: "포스터 바람에 파닥", file: "14_paper_wind.mp3" },
  { key: "15", label: "지팡이(탁)", file: "15_cane_tap_placeholder.mp3", note: "임시 대체(테이블 탭) — 스톡에 없어서 직접 녹음 추천" },
  { key: "16", label: "벤치에 앉는 쿵", file: "16_sit_thud.mp3" },
  { key: "17", label: "종이 부스럭", file: "17_paper_crinkle.mp3" },
];

export const SFX_SLOT_ID = (key) => `sfx.${key}`;
