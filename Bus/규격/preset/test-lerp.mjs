import { lerpPreset } from "./lightingPresets.js";

const R = { presetVersion:"1.0", name:"lp_R",
  scene:{ ambient:[0.30,0.20,0.18], fogType:1, fogColor:[0.35,0.22,0.20],
          fogDensity:0.010, fogStart:2, fogEnd:40, exposure:1.2, tonemapping:3 },
  lights:[ {name:"key", type:"spot", color:[1.0,0.75,0.55], intensity:2.0, range:8, castShadows:true, enabled:true},
           {name:"warm_fill", type:"omni", color:[1.0,0.6,0.4], intensity:1.2, range:5, enabled:true} ] };

const H = { presetVersion:"1.0", name:"lp_H",
  scene:{ ambient:[0.04,0.07,0.07], fogType:2, fogColor:[0.05,0.10,0.10],
          fogDensity:0.060, fogStart:1, fogEnd:18, exposure:0.7, tonemapping:2 },
  lights:[ {name:"key", type:"spot", color:[0.35,0.55,0.52], intensity:0.6, range:6, castShadows:true, enabled:true},
           {name:"flicker", type:"omni", color:[0.2,0.9,0.5], intensity:0.9, range:3, enabled:true} ] };

let pass = 0, fail = 0;
const ok = (label, cond, extra="") => { cond ? pass++ : fail++; console.log(`${cond?"✓":"✗"} ${label} ${extra}`); };
const near = (a,b,eps=1e-9) => Math.abs(a-b) < eps;

// 끝점
ok("t=0 은 a 그대로", near(lerpPreset(R,H,0).scene.fogDensity, 0.010));
ok("t=1 은 b 그대로", near(lerpPreset(R,H,1).scene.fogDensity, 0.060));

// 연속값
const m = lerpPreset(R,H,0.5,"lp_R-H");
ok("안개 농도 중간값", near(m.scene.fogDensity, 0.035), `= ${m.scene.fogDensity}`);
ok("환경광 색 중간값", m.scene.ambient.every((v,i)=>near(v,(R.scene.ambient[i]+H.scene.ambient[i])/2)), `= [${m.scene.ambient.map(v=>v.toFixed(3))}]`);
ok("노출 중간값", near(m.scene.exposure, 0.95));
ok("색 길이 3 유지", m.scene.ambient.length===3 && m.scene.fogColor.length===3);

// 이산값 — 섞으면 뜻이 깨지는 것들
ok("fogType 은 안 섞임 (t=0.4→a)", lerpPreset(R,H,0.4).scene.fogType===1);
ok("fogType 은 안 섞임 (t=0.6→b)", lerpPreset(R,H,0.6).scene.fogType===2);
ok("tonemapping 은 안 섞임", Number.isInteger(m.scene.tonemapping));
ok("light.type 은 안 섞임", m.lights.find(l=>l.name==="key").type==="spot");

// 양쪽에 있는 조명
const key = m.lights.find(l=>l.name==="key");
ok("공통 조명 세기 중간값", near(key.intensity, 1.3), `= ${key.intensity}`);
ok("공통 조명 색 중간값", near(key.color[1], (0.75+0.55)/2));

// 한쪽에만 있는 조명 → 반대쪽에서 0
const fill = m.lights.find(l=>l.name==="warm_fill");
const flick = m.lights.find(l=>l.name==="flicker");
ok("조명 4개 아니라 3개로 합쳐짐", m.lights.length===3, `= ${m.lights.length}`);
ok("로맨스 전용 조명이 절반에서 반만", near(fill.intensity, 0.6), `= ${fill.intensity}`);
ok("공포 전용 조명이 절반에서 반만", near(flick.intensity, 0.45), `= ${flick.intensity}`);
ok("t=1 에서 로맨스 전용 조명 꺼짐", near(lerpPreset(R,H,1).lights.find(l=>l.name==="warm_fill").intensity, 0));
ok("t=0 에서 공포 전용 조명 꺼짐", near(lerpPreset(R,H,0).lights.find(l=>l.name==="flicker").intensity, 0));

// 순수 배합 — 같은 프리셋 두 장
const pure = lerpPreset(H,H,0.5);
ok("순수 배합(H×H)은 원본과 같음", near(pure.scene.fogDensity,0.060) && near(pure.lights.find(l=>l.name==="flicker").intensity,0.9));

// 범위 밖
ok("t 범위 밖은 잘림", near(lerpPreset(R,H,5).scene.fogDensity, 0.060));
ok("한쪽이 없으면 있는 쪽", lerpPreset(null,H,0.5).name==="lp_H");

console.log(`\n${pass} 통과 / ${fail} 실패`);
process.exit(fail?1:0);
