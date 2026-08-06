/* ══════════════════════════════════════════════════════════════════
   정류장 — 조명 프리셋 저장 / 불러오기 도구
   PlayCanvas 에디터 페이지의 브라우저 콘솔에 붙여넣고 Enter.
   화면 오른쪽 위에 패널이 뜹니다.

   개발 · 2026-08-07 · 요청서 v5.0 D2 · §2.4
   ══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var PANEL_ID = "ctx-preset-tool";
  var PRESET_VERSION = "1.0";
  var PRESETS = ["lp_neutral", "lp_H", "lp_R", "lp_C", "lp_F"];
  var LABELS = {
    lp_neutral: "중립 — 체험 시작 ~ 1:40",
    lp_H: "🖤 공포",
    lp_R: "💗 로맨스",
    lp_C: "💛 코미디",
    lp_F: "💜 판타지",
  };

  if (typeof window.editor === "undefined") {
    alert("PlayCanvas 에디터 페이지가 아닙니다.\n\n에디터를 연 상태에서 다시 실행해 주세요.");
    return;
  }

  /* ── 에디터 API 접근 — 버전에 따라 경로가 다르므로 순서대로 시도 ── */

  var probe = { entities: null, settings: null };

  function listEntities() {
    try {
      if (editor.api && editor.api.globals && editor.api.globals.entities) {
        probe.entities = "api.globals.entities.list";
        return editor.api.globals.entities.list();
      }
    } catch (e) {}
    try {
      var l = editor.call("entities:list");
      if (l) { probe.entities = "editor.call('entities:list')"; return l; }
    } catch (e) {}
    probe.entities = "FAILED";
    return [];
  }

  function sceneSettings() {
    try {
      if (editor.api && editor.api.globals && editor.api.globals.settings &&
          editor.api.globals.settings.scene) {
        probe.settings = "api.globals.settings.scene";
        return editor.api.globals.settings.scene;
      }
    } catch (e) {}
    try {
      var s = editor.call("sceneSettings");
      if (s) { probe.settings = "editor.call('sceneSettings')"; return s; }
    } catch (e) {}
    probe.settings = "FAILED";
    return null;
  }

  // observer.get(path) 를 안전하게. 없으면 fallback 반환.
  function g(obs, path, fallback) {
    if (!obs) return fallback;
    try {
      var v = obs.get(path);
      return v === undefined || v === null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function s(obs, path, value) {
    if (!obs || value === undefined || value === null) return false;
    try { obs.set(path, value); return true; } catch (e) { return false; }
  }

  /* ── 저장 — 현재 씬에서 조명 관련 값만 뽑는다 ────────────────── */

  // 에디터 씬 설정 키. 버전에 따라 이름이 다를 수 있어 후보를 순서대로 본다.
  var SCENE_KEYS = {
    ambient:        ["render.global_ambient", "render.ambient", "global_ambient"],
    exposure:       ["render.exposure", "exposure"],
    tonemapping:    ["render.tonemapping", "tonemapping"],
    gamma:          ["render.gamma_correction", "gamma_correction"],
    fogType:        ["render.fog", "fog"],
    fogColor:       ["render.fog_color", "fog_color"],
    fogDensity:     ["render.fog_density", "fog_density"],
    fogStart:       ["render.fog_start", "fog_start"],
    fogEnd:         ["render.fog_end", "fog_end"],
    skyIntensity:   ["render.skyboxIntensity", "skyboxIntensity"],
    skyMip:         ["render.skyboxMip", "skyboxMip"],
    skyRotation:    ["render.skyboxRotation", "skyboxRotation"],
  };

  function readSceneKey(obs, candidates) {
    for (var i = 0; i < candidates.length; i++) {
      var v = g(obs, candidates[i], undefined);
      if (v !== undefined) return { path: candidates[i], value: v };
    }
    return null;
  }

  function capture(name) {
    var settings = sceneSettings();
    var scene = {};
    var scenePaths = {};   // 실제로 읽힌 경로를 기록 — 불러오기 때 같은 경로로 되돌린다

    Object.keys(SCENE_KEYS).forEach(function (k) {
      var hit = readSceneKey(settings, SCENE_KEYS[k]);
      if (hit) { scene[k] = hit.value; scenePaths[k] = hit.path; }
    });

    var lights = [];
    listEntities().forEach(function (e) {
      var light = g(e, "components.light", null);
      if (!light) return;
      lights.push({
        name: g(e, "name", "(이름 없음)"),
        resourceId: g(e, "resource_id", null),
        enabled: g(e, "enabled", true),
        componentEnabled: light.enabled !== false,
        type: light.type,
        color: light.color,
        intensity: light.intensity,
        range: light.range,
        falloffMode: light.falloffMode,
        innerConeAngle: light.innerConeAngle,
        outerConeAngle: light.outerConeAngle,
        castShadows: light.castShadows,
        shadowIntensity: light.shadowIntensity,
        shadowBias: light.shadowBias,
        shadowDistance: light.shadowDistance,
        position: g(e, "position", null),
        rotation: g(e, "rotation", null),
      });
    });

    if (!lights.length) {
      warn("이 씬에서 light 컴포넌트를 찾지 못했습니다. 조명이 없는 씬이거나 에디터 API 경로가 다릅니다.");
    }

    return {
      presetVersion: PRESET_VERSION,
      name: name,
      capturedAt: new Date().toISOString().slice(0, 19) + "Z",
      scene: scene,
      lights: lights,
      _probe: {
        entities: probe.entities,
        settings: probe.settings,
        scenePaths: scenePaths,
        lightCount: lights.length,
        editorVersion: (window.config && config.url && config.url.frontend) || "unknown",
      },
    };
  }

  /* ── 불러오기 — 저장했던 값을 씬에 되돌린다 ─────────────────── */

  function apply(preset) {
    if (!preset || preset.presetVersion !== PRESET_VERSION) {
      warn("프리셋 형식이 다릅니다 (presetVersion=" + (preset && preset.presetVersion) + ").");
      return;
    }

    var settings = sceneSettings();
    var okScene = 0, failScene = 0;
    var paths = (preset._probe && preset._probe.scenePaths) || {};

    Object.keys(preset.scene || {}).forEach(function (k) {
      var candidates = paths[k] ? [paths[k]].concat(SCENE_KEYS[k] || []) : (SCENE_KEYS[k] || []);
      for (var i = 0; i < candidates.length; i++) {
        if (s(settings, candidates[i], preset.scene[k])) { okScene++; return; }
      }
      failScene++;
    });

    // 조명은 resourceId 우선, 없으면 이름으로 찾는다 (아트가 엔티티를 다시 만들었을 수 있음)
    var entities = listEntities();
    var byId = {}, byName = {};
    entities.forEach(function (e) {
      var rid = g(e, "resource_id", null);
      if (rid) byId[rid] = e;
      var n = g(e, "name", null);
      if (n && !byName[n]) byName[n] = e;
    });

    var okLights = 0, missing = [];
    (preset.lights || []).forEach(function (L) {
      var e = (L.resourceId && byId[L.resourceId]) || byName[L.name];
      if (!e) { missing.push(L.name); return; }

      [ "type", "color", "intensity", "range", "falloffMode",
        "innerConeAngle", "outerConeAngle", "castShadows",
        "shadowIntensity", "shadowBias", "shadowDistance" ].forEach(function (k) {
        if (L[k] !== undefined && L[k] !== null) s(e, "components.light." + k, L[k]);
      });
      if (L.componentEnabled !== undefined) s(e, "components.light.enabled", L.componentEnabled);
      if (L.enabled !== undefined) s(e, "enabled", L.enabled);
      if (L.position) s(e, "position", L.position);
      if (L.rotation) s(e, "rotation", L.rotation);
      okLights++;
    });

    var msg = "불러왔습니다 — 조명 " + okLights + "개, 씬 설정 " + okScene + "개";
    if (missing.length) msg += "\n못 찾은 조명: " + missing.join(", ");
    if (failScene) msg += "\n적용 실패한 씬 설정 " + failScene + "개";
    log(missing.length || failScene ? "warn" : "ok", msg);
  }

  /* ── 파일 입출력 ─────────────────────────────────────────────── */

  function download(preset) {
    var blob = new Blob([JSON.stringify(preset, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = preset.name + ".json";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function pickFile(cb) {
    var input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = function () {
      var f = input.files && input.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try { cb(JSON.parse(r.result)); }
        catch (e) { warn("JSON 을 읽지 못했습니다: " + e.message); }
      };
      r.readAsText(f);
    };
    input.click();
  }

  /* ── 패널 ────────────────────────────────────────────────────── */

  var statusEl;

  function log(kind, msg) {
    if (!statusEl) { console.log(msg); return; }
    statusEl.textContent = msg;
    statusEl.style.color = kind === "ok" ? "#7fd67f" : kind === "warn" ? "#e8c46a" : "#e88";
    console.log("[프리셋] " + msg);
  }
  function warn(msg) { log("warn", msg); }

  function build() {
    var old = document.getElementById(PANEL_ID);
    if (old) old.remove();

    var box = document.createElement("div");
    box.id = PANEL_ID;
    box.style.cssText = [
      "position:fixed", "top:56px", "right:16px", "z-index:2147483647",
      "width:280px", "padding:14px", "border-radius:10px",
      "background:#23252a", "color:#e6e6e6", "font:13px/1.5 -apple-system,BlinkMacSystemFont,'Pretendard',sans-serif",
      "box-shadow:0 8px 32px rgba(0,0,0,.5)", "border:1px solid #3a3d44",
    ].join(";");

    var btn = "display:block;width:100%;margin-top:8px;padding:9px;border:0;border-radius:6px;" +
              "font:600 13px/1 inherit;cursor:pointer;color:#fff;";

    box.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
        '<b style="font-size:13px">조명 프리셋</b>' +
        '<span id="ctx-x" style="cursor:pointer;opacity:.5;padding:0 4px">✕</span>' +
      '</div>' +
      '<select id="ctx-name" style="width:100%;padding:7px;border-radius:6px;background:#181a1e;' +
        'color:#e6e6e6;border:1px solid #3a3d44;font:13px inherit">' +
        PRESETS.map(function (p) {
          return '<option value="' + p + '">' + p + " — " + LABELS[p] + "</option>";
        }).join("") +
      "</select>" +
      '<button id="ctx-save" style="' + btn + 'background:#2f7d4f">💾 저장 (JSON 내려받기)</button>' +
      '<button id="ctx-load" style="' + btn + 'background:#3a5f9e">📂 불러오기</button>' +
      '<div id="ctx-status" style="margin-top:10px;font-size:11.5px;line-height:1.45;' +
        'white-space:pre-wrap;color:#8b8f96;min-height:32px"></div>' +
      '<div style="margin-top:8px;padding-top:8px;border-top:1px solid #3a3d44;' +
        'font-size:11px;color:#6f747c">저장한 파일을 개발에 보내 주세요.<br>조합 프리셋은 만들지 않습니다.</div>';

    document.body.appendChild(box);
    statusEl = box.querySelector("#ctx-status");

    box.querySelector("#ctx-x").onclick = function () { box.remove(); };

    box.querySelector("#ctx-save").onclick = function () {
      var name = box.querySelector("#ctx-name").value;
      try {
        var p = capture(name);
        download(p);
        log(p.lights.length ? "ok" : "warn",
          "저장했습니다 — " + name + ".json\n조명 " + p.lights.length +
          "개, 씬 설정 " + Object.keys(p.scene).length + "개");
      } catch (e) {
        warn("저장 실패: " + e.message);
        console.error(e);
      }
    };

    box.querySelector("#ctx-load").onclick = function () {
      pickFile(function (p) {
        try { apply(p); } catch (e) { warn("불러오기 실패: " + e.message); console.error(e); }
      });
    };

    // 열자마자 한 번 훑어서 API 경로가 잡히는지 보여 준다
    var n = listEntities().length;
    var lights = 0;
    listEntities().forEach(function (e) { if (g(e, "components.light", null)) lights++; });
    log(lights ? "ok" : "warn",
      "엔티티 " + n + "개 · 조명 " + lights + "개 인식\n" +
      "설정 경로: " + probe.settings);
  }

  build();
  console.log("%c[정류장] 프리셋 도구 준비됨", "color:#7fd67f;font-weight:600");
})();
