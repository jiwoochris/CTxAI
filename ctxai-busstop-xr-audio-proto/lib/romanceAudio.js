// 로맨스 트랙 공간 음향 — 소개서 v0.3 §10 구현
//
// 좌표계: forward = -Z, up = +Y, right = +X (Web Audio 기본)
// 관객은 원점. 옆자리 인물은 오른쪽 근접(+X), 도로는 정면(-Z), 카페는 전방 좌측.
//
// 실제 녹음 음원이 아직 없어 Web Audio 로 합성한 테스트 음원이다.
// 다만 "위치·거리·이동·차폐"는 실제 스펙과 동일한 방식으로 구현했다.
// 최종 단계에서 버퍼만 녹음 파일로 교체하면 위치 로직은 그대로 유지된다.
//
// setListenerYaw() 은 HMD 헤드트래킹이 들어올 자리다. WebXR 에서는 매 프레임
// head pose 를 읽어 이 함수를 호출하게 된다. 데모에서는 슬라이더로 대체해,
// "고개를 돌려도 음상이 캐릭터 위치에 남는가"(§10)를 직접 확인할 수 있다.

let ctx = null;

export function getCtx() {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    ctx = new C();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function noise(c, dur) {
  const n = Math.max(1, Math.floor(c.sampleRate * dur));
  const b = c.createBuffer(1, n, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

function panner(c, x, y, z, { ref = 0.6, roll = 1.1, max = 40 } = {}) {
  const p = c.createPanner();
  p.panningModel = "HRTF";
  p.distanceModel = "inverse";
  p.refDistance = ref;
  p.rolloffFactor = roll;
  p.maxDistance = max;
  if (p.positionX) {
    p.positionX.setValueAtTime(x, c.currentTime);
    p.positionY.setValueAtTime(y, c.currentTime);
    p.positionZ.setValueAtTime(z, c.currentTime);
  } else {
    p.setPosition(x, y, z);
  }
  return p;
}

function setPos(p, c, x, y, z, t = 0) {
  const when = c.currentTime + t;
  if (p.positionX) {
    p.positionX.setValueAtTime(x, when);
    p.positionY.setValueAtTime(y, when);
    p.positionZ.setValueAtTime(z, when);
  } else {
    p.setPosition(x, y, z);
  }
}

export function createRomanceAudio() {
  const c = getCtx();
  if (!c) return null;

  // 마스터 — 전시장 볼륨 조정 지점
  const master = c.createGain();
  master.gain.value = 0.9;
  master.connect(c.destination);

  // 공용 잔향 (정류장 캐노피의 짧은 반사)
  const reverb = c.createConvolver();
  {
    const dur = 1.1;
    const n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.6);
      }
    }
    reverb.buffer = buf;
  }
  const reverbGain = c.createGain();
  reverbGain.gain.value = 0.22;
  reverb.connect(reverbGain);
  reverbGain.connect(master);

  const live = []; // 정리 대상 소스

  function track(src) {
    live.push(src);
    return src;
  }

  // ── 옆자리 인물 ─────────────────────────────────────────────
  // 하나의 panner 를 계속 재사용한다. 인물이 이동하면 이 위치만 옮긴다.
  const charPos = { x: 0.55, y: -0.05, z: 0.1 };
  const charPanner = panner(c, charPos.x, charPos.y, charPos.z, { ref: 0.35, roll: 1.4 });
  charPanner.connect(master);
  const charSend = c.createGain();
  charSend.gain.value = 0.5;
  charPanner.connect(charSend);
  charSend.connect(reverb);

  // ── 환경 앰비언트 (젖은 도로 + 맞은편 생활음) ────────────────
  let ambSrc = null;
  function startAmbience() {
    if (ambSrc) return;
    const src = c.createBufferSource();
    src.buffer = noise(c, 4);
    src.loop = true;
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 620;
    const hp = c.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 90;
    const g = c.createGain();
    g.gain.setValueAtTime(0, c.currentTime);
    g.gain.linearRampToValueAtTime(0.1, c.currentTime + 2.5);
    src.connect(lp);
    lp.connect(hp);
    hp.connect(g);
    g.connect(master);
    src.start();
    ambSrc = { src, g };
  }

  function stopAmbience() {
    if (!ambSrc) return;
    try {
      ambSrc.g.gain.linearRampToValueAtTime(0, c.currentTime + 0.6);
      ambSrc.src.stop(c.currentTime + 0.7);
    } catch (e) {}
    ambSrc = null;
  }

  // ── 벤치 눌림 → 옷 마찰 → 숨 ────────────────────────────────
  // §10 "큰 소리로 놀라게 하기보다 여러 작은 단서를 순서대로 쌓는다"
  function benchSit() {
    const t0 = c.currentTime;

    // 목재 눌림 (저역 짧은 임펄스)
    const creak = track(c.createBufferSource());
    creak.buffer = noise(c, 0.5);
    const cf = c.createBiquadFilter();
    cf.type = "lowpass";
    cf.frequency.value = 240;
    const cg = c.createGain();
    cg.gain.setValueAtTime(0.5, t0);
    cg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.45);
    creak.connect(cf);
    cf.connect(cg);
    cg.connect(charPanner);
    creak.start(t0);
    creak.stop(t0 + 0.5);

    // 옷 마찰
    const cloth = track(c.createBufferSource());
    cloth.buffer = noise(c, 0.9);
    const clf = c.createBiquadFilter();
    clf.type = "bandpass";
    clf.frequency.value = 3200;
    clf.Q.value = 0.5;
    const clg = c.createGain();
    clg.gain.setValueAtTime(0, t0 + 0.5);
    clg.gain.linearRampToValueAtTime(0.16, t0 + 0.85);
    clg.gain.linearRampToValueAtTime(0, t0 + 1.35);
    cloth.connect(clf);
    clf.connect(clg);
    clg.connect(charPanner);
    cloth.start(t0 + 0.5);
    cloth.stop(t0 + 1.4);

    // 숨
    breath(1.6);
  }

  function breath(delay = 0) {
    const t0 = c.currentTime + delay;
    const src = track(c.createBufferSource());
    src.buffer = noise(c, 0.8);
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900;
    bp.Q.value = 0.8;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.1, t0 + 0.25);
    g.gain.linearRampToValueAtTime(0, t0 + 0.7);
    src.connect(bp);
    bp.connect(g);
    g.connect(charPanner);
    src.start(t0);
    src.stop(t0 + 0.8);
  }

  // ── 발화 프록시 ─────────────────────────────────────────────
  // TTS 가 붙기 전까지의 대체물. 음절 수에 비례한 길이로 음성 대역의
  // 짧은 버스트를 만들어, 방향·거리·이동을 검증할 수 있게 한다.
  // 실제 구현에서는 여기에 스트리밍 TTS 버퍼를 charPanner 로 연결한다.
  function speak(text, { warm = 0.5 } = {}) {
    const syllables = Math.max(2, (text.match(/[가-힣]/g) || []).length);
    const n = Math.min(syllables, 26);
    const t0 = c.currentTime + 0.02;
    const per = 0.135;
    const base = 148 + warm * 40;

    for (let i = 0; i < n; i++) {
      const t = t0 + i * per;
      const o = track(c.createOscillator());
      o.type = "sawtooth";
      // 문장 끝을 향해 내려가는 억양, 물음표면 올린다
      const contour = /[?？]/.test(text) ? i / n : -(i / n);
      o.frequency.setValueAtTime(base * (1 + contour * 0.16 + (Math.random() - 0.5) * 0.05), t);

      const f1 = c.createBiquadFilter();
      f1.type = "bandpass";
      f1.frequency.value = 620 + Math.random() * 280;
      f1.Q.value = 3.5;
      const f2 = c.createBiquadFilter();
      f2.type = "bandpass";
      f2.frequency.value = 1750 + Math.random() * 520;
      f2.Q.value = 2.6;
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 3600;

      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.16, t + 0.028);
      g.gain.linearRampToValueAtTime(0.001, t + per * 0.88);

      o.connect(f1);
      f1.connect(f2);
      f2.connect(lp);
      lp.connect(g);
      g.connect(charPanner);
      o.start(t);
      o.stop(t + per);
    }
    return n * per;
  }

  // ── 공간을 유지하는 TTS 경로 ────────────────────────────────
  // speechSynthesis 의 출력은 Web Audio 로 가져올 수 없어 위치를 잃는다.
  // 오디오 버퍼를 반환하는 TTS(클라우드 TTS 등)를 쓰면 이 함수로 charPanner 를
  // 통과시켜 "옆자리 오른쪽 0.42m" 를 그대로 유지할 수 있다.
  // 최종 구현에서 써야 하는 경로이며, TTS 엔드포인트가 붙는 즉시 교체 가능하다.
  async function speakBuffer(arrayBuffer) {
    const buf = await c.decodeAudioData(arrayBuffer.slice(0));
    const src = track(c.createBufferSource());
    src.buffer = buf;
    const g = c.createGain();
    g.gain.value = 1;
    src.connect(g);
    g.connect(charPanner);
    src.start();
    return buf.duration;
  }

  // ── 인물 이동 (장르 사건: 조금 다가와 앉음) ──────────────────
  function moveCharacter(x, z, seconds = 2.5) {
    charPos.x = x;
    charPos.z = z;
    if (charPanner.positionX) {
      const when = c.currentTime;
      charPanner.positionX.linearRampToValueAtTime(x, when + seconds);
      charPanner.positionZ.linearRampToValueAtTime(z, when + seconds);
    } else {
      charPanner.setPosition(x, charPos.y, z);
    }
  }

  // ── 맞은편 카페 문 종 ───────────────────────────────────────
  function cafeBell() {
    const t0 = c.currentTime;
    const p = panner(c, -5.5, 0.4, -11, { ref: 2, roll: 0.9 });
    p.connect(master);
    p.connect(reverb);
    [2100, 2840, 3560].forEach((f, i) => {
      const o = track(c.createOscillator());
      o.type = "sine";
      o.frequency.value = f;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t0 + i * 0.05);
      g.gain.linearRampToValueAtTime(0.09 / (i + 1), t0 + i * 0.05 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0005, t0 + 1.2 + i * 0.1);
      o.connect(g);
      g.connect(p);
      o.start(t0 + i * 0.05);
      o.stop(t0 + 1.5);
    });
  }

  // ── 카페 문 열림 + 음악 누출 ────────────────────────────────
  function cafeOpen() {
    cafeBell();
    const t0 = c.currentTime + 0.15;
    const p = panner(c, -5.2, 0.3, -10.5, { ref: 2, roll: 1 });
    p.connect(master);
    p.connect(reverb);
    // 문틈으로 새는 음악 — 고역이 깎인 화음
    [233.1, 293.7, 349.2].forEach((f) => {
      const o = track(c.createOscillator());
      o.type = "triangle";
      o.frequency.value = f;
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(700, t0);
      lp.frequency.linearRampToValueAtTime(1900, t0 + 1.2); // 문이 열리며 고역이 살아남
      lp.frequency.linearRampToValueAtTime(600, t0 + 5.5); // 다시 닫힘
      const g = c.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.07, t0 + 1.2);
      g.gain.linearRampToValueAtTime(0, t0 + 6);
      o.connect(lp);
      lp.connect(g);
      g.connect(p);
      o.start(t0);
      o.stop(t0 + 6.2);
    });
  }

  // ── 캐노피 물방울 (머리 위 후방) ────────────────────────────
  function rainDrip() {
    const p = panner(c, 0.2, 1.1, 0.9, { ref: 0.8 });
    p.connect(master);
    p.connect(reverb);
    for (let i = 0; i < 7; i++) {
      const t = c.currentTime + i * (0.9 + Math.random() * 0.8);
      const src = track(c.createBufferSource());
      src.buffer = noise(c, 0.09);
      const bp = c.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 2400 + Math.random() * 900;
      bp.Q.value = 6;
      const g = c.createGain();
      g.gain.setValueAtTime(0.22, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      src.connect(bp);
      bp.connect(g);
      g.connect(p);
      src.start(t);
      src.stop(t + 0.1);
    }
  }

  // ── 차량 좌 → 우 통과 (젖은 노면) ───────────────────────────
  function carPass() {
    const t0 = c.currentTime;
    const dur = 3.4;
    const p = panner(c, -14, -0.2, -3.2, { ref: 3, roll: 1.2 });
    p.connect(master);

    const o = track(c.createOscillator());
    o.type = "sawtooth";
    o.frequency.setValueAtTime(78, t0);
    o.frequency.linearRampToValueAtTime(104, t0 + dur / 2);
    o.frequency.linearRampToValueAtTime(72, t0 + dur);
    const olp = c.createBiquadFilter();
    olp.type = "lowpass";
    olp.frequency.value = 420;
    const og = c.createGain();
    og.gain.value = 0.32;
    o.connect(olp);
    olp.connect(og);
    og.connect(p);

    // 젖은 노면 타이어 — 로맨스 트랙의 핵심 텍스처
    const tire = track(c.createBufferSource());
    tire.buffer = noise(c, dur);
    const tbp = c.createBiquadFilter();
    tbp.type = "bandpass";
    tbp.frequency.value = 1500;
    tbp.Q.value = 0.55;
    const tg = c.createGain();
    tg.gain.setValueAtTime(0, t0);
    tg.gain.linearRampToValueAtTime(0.2, t0 + dur / 2);
    tg.gain.linearRampToValueAtTime(0, t0 + dur);
    tire.connect(tbp);
    tbp.connect(tg);
    tg.connect(p);

    if (p.positionX) {
      p.positionX.setValueAtTime(-14, t0);
      p.positionX.linearRampToValueAtTime(14, t0 + dur);
    }
    o.start(t0);
    o.stop(t0 + dur);
    tire.start(t0);
    tire.stop(t0 + dur);
  }

  // ── 버스 접근: 먼 저주파 → 타이어 → 브레이크 → 공압문 ────────
  function busApproach() {
    const t0 = c.currentTime;
    const p = panner(c, -1.5, -0.3, -26, { ref: 3, roll: 0.85, max: 80 });
    p.connect(master);
    p.connect(reverb);
    if (p.positionZ) {
      p.positionZ.setValueAtTime(-26, t0);
      p.positionZ.linearRampToValueAtTime(-3.2, t0 + 9);
      p.positionX.setValueAtTime(-1.5, t0);
      p.positionX.linearRampToValueAtTime(-2.2, t0 + 9);
    }

    const rumble = track(c.createOscillator());
    rumble.type = "sine";
    rumble.frequency.setValueAtTime(42, t0);
    rumble.frequency.linearRampToValueAtTime(56, t0 + 8);
    const rg = c.createGain();
    rg.gain.setValueAtTime(0, t0);
    rg.gain.linearRampToValueAtTime(0.5, t0 + 6);
    rg.gain.linearRampToValueAtTime(0.2, t0 + 9.5);
    rg.gain.linearRampToValueAtTime(0, t0 + 11);
    rumble.connect(rg);
    rg.connect(p);
    rumble.start(t0);
    rumble.stop(t0 + 11.2);

    const tire = track(c.createBufferSource());
    tire.buffer = noise(c, 10);
    const tf = c.createBiquadFilter();
    tf.type = "bandpass";
    tf.frequency.value = 1200;
    tf.Q.value = 0.5;
    const tg = c.createGain();
    tg.gain.setValueAtTime(0, t0 + 3);
    tg.gain.linearRampToValueAtTime(0.24, t0 + 8);
    tg.gain.linearRampToValueAtTime(0.02, t0 + 9.6);
    tire.connect(tf);
    tf.connect(tg);
    tg.connect(p);
    tire.start(t0 + 3);
    tire.stop(t0 + 10);

    // 브레이크
    const brake = track(c.createOscillator());
    brake.type = "sawtooth";
    brake.frequency.setValueAtTime(2500, t0 + 8.6);
    brake.frequency.linearRampToValueAtTime(1950, t0 + 9.5);
    const bg = c.createGain();
    bg.gain.setValueAtTime(0, t0 + 8.6);
    bg.gain.linearRampToValueAtTime(0.07, t0 + 8.8);
    bg.gain.linearRampToValueAtTime(0, t0 + 9.6);
    brake.connect(bg);
    bg.connect(p);
    brake.start(t0 + 8.6);
    brake.stop(t0 + 9.7);
  }

  // ── 공압문 — 엔딩. 프로그램 종료 UI 를 세계 안의 출구로 전환 ──
  function busDoor() {
    const t0 = c.currentTime;
    const p = panner(c, -2, -0.1, -2.4, { ref: 1.2 });
    p.connect(master);
    p.connect(reverb);

    // 공압 배출
    const hiss = track(c.createBufferSource());
    hiss.buffer = noise(c, 1.1);
    const hp = c.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 2600;
    const hg = c.createGain();
    hg.gain.setValueAtTime(0.32, t0);
    hg.gain.exponentialRampToValueAtTime(0.002, t0 + 0.9);
    hiss.connect(hp);
    hp.connect(hg);
    hg.connect(p);
    hiss.start(t0);
    hiss.stop(t0 + 1.1);

    // 문짝 접히는 기계음
    const thunk = track(c.createBufferSource());
    thunk.buffer = noise(c, 0.4);
    const tl = c.createBiquadFilter();
    tl.type = "lowpass";
    tl.frequency.value = 380;
    const tgn = c.createGain();
    tgn.gain.setValueAtTime(0.4, t0 + 0.75);
    tgn.gain.exponentialRampToValueAtTime(0.001, t0 + 1.15);
    thunk.connect(tl);
    tl.connect(tgn);
    tgn.connect(p);
    thunk.start(t0 + 0.75);
    thunk.stop(t0 + 1.2);
  }

  // ── 헤드트래킹 자리 ─────────────────────────────────────────
  // WebXR: 매 프레임 XRFrame.getViewerPose() 의 회전을 여기에 넣는다.
  function setListenerYaw(rad) {
    const l = c.listener;
    const fx = -Math.sin(rad);
    const fz = -Math.cos(rad);
    if (l.forwardX) {
      const t = c.currentTime;
      // 급격한 회전에서 지퍼 노이즈가 생기지 않도록 짧은 보간을 준다.
      l.forwardX.linearRampToValueAtTime(fx, t + 0.05);
      l.forwardY.linearRampToValueAtTime(0, t + 0.05);
      l.forwardZ.linearRampToValueAtTime(fz, t + 0.05);
      l.upX.setValueAtTime(0, t);
      l.upY.setValueAtTime(1, t);
      l.upZ.setValueAtTime(0, t);
    } else {
      l.setOrientation(fx, 0, fz, 0, 1, 0);
    }
  }

  function dispose() {
    stopAmbience();
    live.forEach((s) => {
      try {
        s.stop();
      } catch (e) {}
    });
    live.length = 0;
    try {
      master.disconnect();
    } catch (e) {}
  }

  const cues = {
    ambience: startAmbience,
    benchSit,
    cafeBell,
    cafeOpen,
    rainDrip,
    carPass,
    busApproach,
  };

  return {
    cues,
    speak,
    speakBuffer,
    breath,
    moveCharacter,
    busDoor,
    setListenerYaw,
    stopAmbience,
    dispose,
    charPos,
    get masterGain() {
      return master.gain;
    },
  };
}
