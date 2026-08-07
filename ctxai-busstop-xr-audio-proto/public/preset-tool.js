/* ══════════════════════════════════════════════════════════════════
   정류장 — 조명 프리셋 저장 / 불러오기
   PlayCanvas 에디터에서 북마크릿을 누르면 실행됩니다.

   「저장」을 누르면 서버로 바로 갑니다. 파일을 보내실 필요 없습니다.
   서버가 안 되면 예전처럼 파일로 내려받습니다 — 어느 쪽이든 막히지 않습니다.

   개발 · 2026-08-07 · 요청서 v5.0 D2 · §2.4
   ══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var PANEL_ID = "ctx-preset-tool";
  var PRESET_VERSION = "1.0";
  var STORE_KEY = "ctx-preset-server";
  var PRESETS = ["lp_neutral", "lp_H", "lp_R", "lp_C", "lp_F"];
  var LABELS = {
    lp_neutral: "중립 — 체험 시작 ~ 1:40",
    lp_H: "🖤 공포", lp_R: "💗 로맨스", lp_C: "💛 코미디", lp_F: "💜 판타지",
  };

  // 북마크릿이 심어 준 주소 → 저장해 둔 주소 → 물어보기
  var SERVER = (window.CTX_PRESET_SERVER || localStorage.getItem(STORE_KEY) || "").replace(/\/$/, "");

  if (typeof window.editor === "undefined") {
    alert("PlayCanvas 에디터 페이지가 아닙니다.\n\n에디터(편집 화면)를 연 상태에서 눌러 주세요.");
    return;
  }

  /* ── 에디터 API — 버전마다 경로가 달라 순서대로 시도 ────────── */

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

  function g(obs, path, fallback) {
    if (!obs) return fallback;
    try {
      var v = obs.get(path);
      return v === undefined || v === null ? fallback : v;
    } catch (e) { return fallback; }
  }

  function setv(obs, path, value) {
    if (!obs || value === undefined || value === null) return false;
    try { obs.set(path, value); return true; } catch (e) { return false; }
  }

  var SCENE_KEYS = {
    ambient:      ["render.global_ambient", "render.ambient", "global_ambient"],
    exposure:     ["render.exposure", "exposure"],
    tonemapping:  ["render.tonemapping", "tonemapping"],
    gamma:        ["render.gamma_correction", "gamma_correction"],
    fogType:      ["render.fog", "fog"],
    fogColor:     ["render.fog_color", "fog_color"],
    fogDensity:   ["render.fog_density", "fog_density"],
    fogStart:     ["render.fog_start", "fog_start"],
    fogEnd:       ["render.fog_end", "fog_end"],
    skyIntensity: ["render.skyboxIntensity", "skyboxIntensity"],
    skyMip:       ["render.skyboxMip", "skyboxMip"],
    skyRotation:  ["render.skyboxRotation", "skyboxRotation"],
  };

  function capture(name) {
    var settings = sceneSettings();
    var scene = {}, scenePaths = {};

    Object.keys(SCENE_KEYS).forEach(function (k) {
      var cands = SCENE_KEYS[k];
      for (var i = 0; i < cands.length; i++) {
        var v = g(settings, cands[i], undefined);
        if (v !== undefined) { scene[k] = v; scenePaths[k] = cands[i]; return; }
      }
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
        type: light.type, color: light.color, intensity: light.intensity,
        range: light.range, falloffMode: light.falloffMode,
        innerConeAngle: light.innerConeAngle, outerConeAngle: light.outerConeAngle,
        castShadows: light.castShadows, shadowIntensity: light.shadowIntensity,
        shadowBias: light.shadowBias, shadowDistance: light.shadowDistance,
        position: g(e, "position", null), rotation: g(e, "rotation", null),
      });
    });

    return {
      presetVersion: PRESET_VERSION,
      name: name,
      capturedAt: new Date().toISOString().slice(0, 19) + "Z",
      scene: scene,
      lights: lights,
      _probe: {
        entities: probe.entities, settings: probe.settings,
        scenePaths: scenePaths, lightCount: lights.length,
        project: (window.config && config.project && config.project.name) || "unknown",
      },
    };
  }

  function apply(preset) {
    if (!preset || preset.presetVersion !== PRESET_VERSION) {
      return log("bad", "프리셋 형식이 다릅니다.");
    }
    var settings = sceneSettings();
    var paths = (preset._probe && preset._probe.scenePaths) || {};
    var okScene = 0, failScene = 0;

    Object.keys(preset.scene || {}).forEach(function (k) {
      var cands = paths[k] ? [paths[k]].concat(SCENE_KEYS[k] || []) : (SCENE_KEYS[k] || []);
      for (var i = 0; i < cands.length; i++) {
        if (setv(settings, cands[i], preset.scene[k])) { okScene++; return; }
      }
      failScene++;
    });

    var byId = {}, byName = {};
    listEntities().forEach(function (e) {
      var rid = g(e, "resource_id", null);
      if (rid) byId[rid] = e;
      var n = g(e, "name", null);
      if (n && !byName[n]) byName[n] = e;
    });

    var okLights = 0, missing = [];
    (preset.lights || []).forEach(function (L) {
      var e = (L.resourceId && byId[L.resourceId]) || byName[L.name];
      if (!e) { missing.push(L.name); return; }
      ["type","color","intensity","range","falloffMode","innerConeAngle",
       "outerConeAngle","castShadows","shadowIntensity","shadowBias","shadowDistance"]
        .forEach(function (k) {
          if (L[k] !== undefined && L[k] !== null) setv(e, "components.light." + k, L[k]);
        });
      if (L.componentEnabled !== undefined) setv(e, "components.light.enabled", L.componentEnabled);
      if (L.enabled !== undefined) setv(e, "enabled", L.enabled);
      if (L.position) setv(e, "position", L.position);
      if (L.rotation) setv(e, "rotation", L.rotation);
      okLights++;
    });

    var msg = "불러왔습니다 — 조명 " + okLights + "개";
    if (missing.length) msg += "\n못 찾은 조명: " + missing.join(", ");
    if (failScene) msg += "\n적용 못한 씬 설정 " + failScene + "개";
    log(missing.length || failScene ? "warn" : "ok", msg);
  }

  /* ── 서버 ──────────────────────────────────────────────────── */

  function askServer() {
    var v = prompt(
      "서버 주소를 한 번만 알려 주세요.\n개발이 알려 준 주소를 붙여넣으시면 됩니다.\n\n예) https://정류장도구.vercel.app",
      SERVER || "http://localhost:3000"
    );
    if (!v) return null;
    SERVER = v.replace(/\/$/, "");
    localStorage.setItem(STORE_KEY, SERVER);
    return SERVER;
  }

  function send(preset, done) {
    if (!SERVER && !askServer()) return done(false, "서버 주소가 없습니다");
    fetch(SERVER + "/api/preset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(preset),
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok || !res.j.ok) return done(false, res.j.error || "서버가 거절했습니다");
        done(true, "");
      })
      .catch(function (e) { done(false, e.message); });
  }

  function fetchList(cb) {
    if (!SERVER && !askServer()) return cb(null);
    fetch(SERVER + "/api/preset")
      .then(function (r) { return r.json(); })
      .then(function (j) { cb(j.presets || null); })
      .catch(function () { cb(null); });
  }

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
        catch (e) { log("bad", "JSON 을 읽지 못했습니다: " + e.message); }
      };
      r.readAsText(f);
    };
    input.click();
  }

  /* ── 패널 ──────────────────────────────────────────────────── */

  var statusEl;

  function log(kind, msg) {
    if (!statusEl) return console.log(msg);
    statusEl.textContent = msg;
    statusEl.style.color =
      kind === "ok" ? "#7fd67f" : kind === "warn" ? "#e8c46a" : kind === "bad" ? "#f08c8c" : "#8b8f96";
    console.log("[프리셋] " + msg);
  }

  function build() {
    var old = document.getElementById(PANEL_ID);
    if (old) old.remove();

    var box = document.createElement("div");
    box.id = PANEL_ID;
    box.style.cssText = [
      "position:fixed", "top:56px", "right:16px", "z-index:2147483647",
      "width:290px", "padding:14px", "border-radius:10px",
      "background:#23252a", "color:#e6e6e6",
      "font:13px/1.5 -apple-system,BlinkMacSystemFont,'Pretendard',sans-serif",
      "box-shadow:0 8px 32px rgba(0,0,0,.5)", "border:1px solid #3a3d44",
    ].join(";");

    var btn = "display:block;width:100%;margin-top:8px;padding:10px;border:0;border-radius:6px;" +
              "font:600 13px/1 inherit;cursor:pointer;color:#fff;";

    box.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
        '<b>조명 프리셋</b>' +
        '<span id="ctx-x" style="cursor:pointer;opacity:.5;padding:0 4px">✕</span></div>' +
      '<select id="ctx-name" style="width:100%;padding:8px;border-radius:6px;background:#181a1e;' +
        'color:#e6e6e6;border:1px solid #3a3d44;font:13px inherit">' +
        PRESETS.map(function (p) {
          return '<option value="' + p + '">' + p + " — " + LABELS[p] + "</option>";
        }).join("") + "</select>" +
      '<button id="ctx-save" style="' + btn + 'background:#2f7d4f">💾 저장</button>' +
      '<button id="ctx-load" style="' + btn + 'background:#3a5f9e">📂 불러오기</button>' +
      '<div id="ctx-picker" style="display:none;margin-top:8px"></div>' +
      '<div id="ctx-status" style="margin-top:10px;font-size:11.5px;line-height:1.45;' +
        'white-space:pre-wrap;color:#8b8f96;min-height:34px"></div>' +
      '<div style="margin-top:8px;padding-top:8px;border-top:1px solid #3a3d44;font-size:11px;color:#6f747c">' +
        '저장하면 개발에게 바로 갑니다.<br>조합 프리셋은 만들지 않습니다. ' +
        '<span id="ctx-srv" style="cursor:pointer;text-decoration:underline">서버 바꾸기</span></div>';

    document.body.appendChild(box);
    statusEl = box.querySelector("#ctx-status");

    box.querySelector("#ctx-x").onclick = function () { box.remove(); };
    box.querySelector("#ctx-srv").onclick = function () {
      if (askServer()) log("ok", "서버: " + SERVER);
    };

    box.querySelector("#ctx-save").onclick = function () {
      var name = box.querySelector("#ctx-name").value;
      var p;
      try { p = capture(name); }
      catch (e) { return log("bad", "저장 실패: " + e.message); }

      if (!p.lights.length) {
        return log("bad", "조명을 하나도 못 찾았습니다.\n개발에 알려 주세요 — 설정 경로: " + probe.settings);
      }

      log("", "보내는 중…");
      send(p, function (ok, err) {
        if (ok) {
          log("ok", "저장했습니다 — " + name + "\n조명 " + p.lights.length +
                    "개 · 씬 설정 " + Object.keys(p.scene).length + "개\n개발에게 전달됐습니다.");
        } else {
          download(p);
          log("warn", "서버에 못 보내서 파일로 내려받았습니다.\n(" + err + ")\n" +
                      name + ".json 을 개발에 보내 주세요.");
        }
      });
    };

    var pickerEl = box.querySelector("#ctx-picker");

    function closePicker() { pickerEl.style.display = "none"; pickerEl.innerHTML = ""; }

    function openPicker(list) {
      var saved = (list || []).filter(function (p) { return p.saved; });
      var rowStyle = "display:block;width:100%;text-align:left;margin-top:5px;padding:8px 10px;" +
        "border:1px solid #3a3d44;border-radius:6px;background:#181a1e;color:#e6e6e6;" +
        "font:12.5px inherit;cursor:pointer;";

      var html = "";
      saved.forEach(function (p) {
        html += '<button class="ctx-pick-item" data-name="' + p.name + '" style="' + rowStyle + '">' +
          p.name + " — " + p.label + "</button>";
      });
      if (!saved.length) {
        html += '<div style="font-size:12px;color:#8b8f96;padding:4px 0">서버에 저장된 프리셋이 없습니다.</div>';
      }
      html += '<button id="ctx-pick-file" style="' + rowStyle + '">📁 파일에서 고르기</button>';
      html += '<button id="ctx-pick-cancel" style="' + rowStyle + 'color:#9aa0a8;text-align:center;margin-top:8px">취소</button>';

      pickerEl.innerHTML = html;
      pickerEl.style.display = "block";

      pickerEl.querySelectorAll(".ctx-pick-item").forEach(function (btn) {
        btn.onclick = function () {
          var name = btn.getAttribute("data-name");
          closePicker();
          log("", name + " 불러오는 중…");
          fetch(SERVER + "/api/preset?name=" + encodeURIComponent(name))
            .then(function (r) { return r.json(); })
            .then(function (j) { if (j.ok) apply(j.preset); else log("bad", j.error); })
            .catch(function (e) { log("bad", e.message); });
        };
      });
      pickerEl.querySelector("#ctx-pick-file").onclick = function () {
        closePicker();
        pickFile(apply);
      };
      pickerEl.querySelector("#ctx-pick-cancel").onclick = closePicker;
    }

    box.querySelector("#ctx-load").onclick = function () {
      closePicker();
      log("", "목록 불러오는 중…");
      fetchList(function (list) {
        log("", "");
        openPicker(list);
      });
    };

    var all = listEntities();
    var lights = 0;
    all.forEach(function (e) { if (g(e, "components.light", null)) lights++; });
    log(lights ? "ok" : "bad",
      lights
        ? "조명 " + lights + "개 인식 · 엔티티 " + all.length + "개" + (SERVER ? "\n서버: " + SERVER : "\n서버 미설정")
        : "조명을 못 찾았습니다 (엔티티 " + all.length + "개)\n개발에 알려 주세요 — " + probe.entities);
  }

  build();
})();
