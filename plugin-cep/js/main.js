"use strict";

(function () {
  var cep = window.__adobe_cep__ || null;

  function $(id) {
    return document.getElementById(id);
  }

  function evalScript(script, callback) {
    if (cep && cep.evalScript) {
      cep.evalScript(script, function (res) {
        if (callback) callback(res);
      });
    } else if (callback) {
      callback("__NO_CEP__");
    }
  }

  function jsq(s) {
    return String(s == null ? "" : s)
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r/g, "\\r")
      .replace(/\n/g, "\\n");
  }

  function log(message) {
    var box = $("logBox");
    if (!box) return;
    box.textContent += (box.textContent ? "\n" : "") + message;
    box.scrollTop = box.scrollHeight;
  }

  function setStatus(message) {
    var el = $("status");
    if (el) el.textContent = message;
  }

  var taskBusy = false;
  var taskCancellable = false;
  var taskCancelled = false;
  function taskStart(title, detail, cancellable) {
    taskBusy = true;
    taskCancellable = !!cancellable;
    taskCancelled = false;
    $("taskTitle").textContent = title;
    $("taskDetail").textContent = detail || "请稍候，Photoshop 正在执行操作。";
    $("taskProgressText").textContent = "准备中";
    $("taskProgressBar").style.width = "0%";
    $("taskHint").textContent = taskCancellable ? "可在当前步骤结束后终止" : "请勿重复操作";
    $("btnTaskCancel").classList.toggle("hidden", !taskCancellable);
    $("btnTaskCancel").disabled = false;
    $("taskModal").classList.remove("hidden");
    document.body.classList.add("task-busy");
  }
  function taskUpdate(done, total) {
    var percent = total ? Math.round(done / total * 100) : 0;
    $("taskProgressBar").style.width = percent + "%";
    $("taskProgressText").textContent = total ? done + " / " + total + "（" + percent + "%）" : "处理中";
  }
  function taskEnd() {
    taskBusy = false;
    $("taskModal").classList.add("hidden");
    document.body.classList.remove("task-busy");
    taskCancellable = false;
    taskCancelled = false;
  }
  function taskCancel() {
    if (!taskCancellable) return;
    taskCancelled = true;
    $("btnTaskCancel").disabled = true;
    $("taskHint").textContent = "将在当前步骤结束后终止";
  }
  function setDocumentAvailable(available) {
    $("noDocumentModal").classList.toggle("hidden", available);
    document.body.classList.toggle("no-document", !available);
  }

  function mergeLayerSnapshots(target, snapshots) {
    if (!snapshots) return;
    var byId = {};
    for (var i = 0; i < snapshots.length; i++) byId[String(snapshots[i].id)] = snapshots[i];
    for (var j = 0; j < target.length; j++) {
      var updated = byId[String(target[j].id)];
      if (!updated) continue;
      // 图片图层的主色是插件缓存数据，缩放/撤销返回的快照不含主色，需保留已有结果。
      if (typeof target[j].colorAvailable === "boolean" &&
          target[j].colorAvailable && !updated.colorAvailable) {
        updated.colorAvailable = true;
        updated.colorHex = target[j].colorHex;
      }
      target[j] = updated;
    }
  }

  function markDocumentChanged() {
    // Never save changed in-memory content under the fingerprint of the last saved file.
    state.fingerprint = "";
  }

  function normalizeHex(value) {
    var s = String(value == null ? "" : value).trim().replace(/^#/, "").toUpperCase();
    if (/^[0-9A-F]{6}$/.test(s)) return "#" + s;
    if (/^[0-9A-F]{3}$/.test(s)) return "#" + s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    return "";
  }

  function hexToRgb(hex) {
    var s = normalizeHex(hex).replace("#", "");
    if (s.length !== 6) return null;
    return {
      r: parseInt(s.substring(0, 2), 16),
      g: parseInt(s.substring(2, 4), 16),
      b: parseInt(s.substring(4, 6), 16)
    };
  }

  function toHex2(n) {
    var v = Math.max(0, Math.min(255, Math.round(n)));
    var s = v.toString(16).toUpperCase();
    return s.length < 2 ? "0" + s : s;
  }

  function rgbToHex(r, g, b) {
    return "#" + toHex2(r) + toHex2(g) + toHex2(b);
  }

  function hsvToRgb(h, s, v) {
    var c = v * s;
    var hp = ((h % 360) + 360) % 360 / 60;
    var x = c * (1 - Math.abs((hp % 2) - 1));
    var r = 0, g = 0, b = 0;
    if (hp < 1) { r = c; g = x; }
    else if (hp < 2) { r = x; g = c; }
    else if (hp < 3) { g = c; b = x; }
    else if (hp < 4) { g = x; b = c; }
    else if (hp < 5) { r = x; b = c; }
    else { r = c; b = x; }
    var m = v - c;
    return {
      r: Math.round((r + m) * 255),
      g: Math.round((g + m) * 255),
      b: Math.round((b + m) * 255)
    };
  }

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    var d = max - min;
    var h = 0;
    if (d !== 0) {
      if (max === r) h = 60 * (((g - b) / d) % 6);
      else if (max === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
    }
    if (h < 0) h += 360;
    return { h: h, s: max === 0 ? 0 : d / max, v: max };
  }

  /* ================= 状态 ================= */

  var state = {
    docKey: "",
    cacheKey: "",
    fingerprint: "",
    docName: "",
    mode: "text",
    layers: [],
    images: [],
    fonts: [],
    fontByPs: {},
    selected: {},
    imageSelected: {},
    filters: {
      search: "",
      fontMode: "include",
      fonts: [],
      sizeMin: "",
      sizeMax: "",
      bold: "any",
      italic: "any",
      visible: "any",
      colorMode: "any",
      colorHex: "#ffffff"
    },
    imageFilters: {
      search: "",
      typeMode: "include",
      types: [],
      widthMin: "",
      widthMax: "",
      heightMin: "",
      heightMax: "",
      colorMode: "any",
      colorHex: "#ffffff",
      colorTol: 0
    },
    imageAnchor: "mc"
  };

  var rowEls = {};
  var drag = { active: false, mode: true, lastId: null };
  var fontItemEls = {};
  var fontDrag = { active: false, mode: true, lastFont: null };
  var imageRowEls = {};
  var imageDrag = { active: false, mode: true, lastId: null };
  var lastOperation = { mode: "", ids: [], anchorMarked: false };
  var fontCacheKey = "ta-font-cache-v1";

  function documentCacheKey(cacheKey) {
    return "ta-document-cache-" + String(cacheKey || "");
  }

  function saveDocumentCache() {
    if (!state.cacheKey || !state.fingerprint) return;
    if (/\|dirty$/.test(state.fingerprint)) return;
    try {
      localStorage.setItem(documentCacheKey(state.cacheKey), JSON.stringify({
        docKey: state.docKey,
        cacheKey: state.cacheKey,
        fingerprint: state.fingerprint,
        docName: state.docName,
        layers: state.layers,
        images: state.images,
        savedAt: Date.now()
      }));
    } catch (e) {
      log("文档缓存保存失败：" + String(e.message || e));
    }
  }

  function restoreDocumentCache(data) {
    if (!data) return false;
    data.docKey = data.docKey || data.id || "";
    data.cacheKey = data.cacheKey || data.docKey;
    if (!data.docKey || !data.cacheKey || !data.fingerprint || /\|dirty$/.test(data.fingerprint)) return false;
    try {
      var cached = JSON.parse(localStorage.getItem(documentCacheKey(data.cacheKey)) || "null");
      if (!cached || cached.cacheKey !== data.cacheKey || cached.fingerprint !== data.fingerprint) return false;
      state.docKey = data.docKey;
      state.cacheKey = data.cacheKey;
      state.fingerprint = data.fingerprint;
      state.docName = cached.docName || data.name || "";
      state.layers = cached.layers || [];
      state.images = cached.images || [];
      $("docName").textContent = state.docName || "未打开文档";
      renderFontFilter();
      renderList();
      renderImageTypeFilter();
      renderImageList();
      setStatus("已恢复文档缓存：文本 " + state.layers.length + " 个，图片 " + state.images.length + " 个");
      log("已恢复缓存（" + new Date(cached.savedAt || Date.now()).toLocaleString() + "）");
      return true;
    } catch (e) {
      log("文档缓存读取失败：" + String(e.message || e));
      return false;
    }
  }

  function layerFont(layer) {
    return layer.font || "";
  }

  function fontInfoForPs(ps) {
    return state.fontByPs[ps] || { ps: ps || "", family: ps || "", style: "", missing: true };
  }

  function layerFontInfo(layer) {
    return fontInfoForPs(layerFont(layer));
  }

  function fontStyleLabel(style) {
    var value = String(style || "Regular");
    var key = value.toLowerCase().replace(/[\s_-]/g, "");
    if (key === "regular" || key === "normal" || key === "roman" || key === "r") return "常规";
    if (key === "bold" || key === "b") return "粗体";
    if (key === "italic" || key === "i") return "斜体";
    if (key === "bolditalic" || key === "boldoblique" || key === "bi") return "粗斜体";
    return value;
  }

  function fontStyleKey(font) {
    return font.style || "Regular";
  }

  function fontDisplayName(font) {
    var family = font.family || font.name || font.ps || "?";
    var style = font.style ? fontStyleLabel(font.style) : "";
    return style ? family + " - " + style : family;
  }

  function matchLayer(layer, f) {
    if (f.search) {
      var hay = (layer.name + "\n" + layer.contents).toLowerCase();
      if (hay.indexOf(f.search.toLowerCase()) === -1) return false;
    }

    if (f.fonts.length) {
      var has = f.fonts.indexOf(layerFont(layer)) !== -1;
      if (f.fontMode === "include" && !has) return false;
      if (f.fontMode === "exclude" && has) return false;
    }

    var min = f.sizeMin === "" ? null : parseFloat(f.sizeMin);
    var max = f.sizeMax === "" ? null : parseFloat(f.sizeMax);
    if (min != null || max != null) {
      if (layer.size == null) return false;
      if (min != null && !isNaN(min) && layer.size < min) return false;
      if (max != null && !isNaN(max) && layer.size > max) return false;
    }

    if (f.bold !== "any" && (layer.bold ? "yes" : "no") !== f.bold) return false;
    if (f.italic !== "any" && (layer.italic ? "yes" : "no") !== f.italic) return false;
    if (f.visible !== "any" && (layer.visible ? "yes" : "no") !== f.visible) return false;

    if (f.colorMode !== "any") {
      var want = hexToRgb(f.colorHex);
      var got = hexToRgb(layer.colorHex);
      if (want && got) {
        var maxDiff = Math.max(
          Math.abs(want.r - got.r),
          Math.abs(want.g - got.g),
          Math.abs(want.b - got.b)
        );
        var tol = isNaN(f.colorTol) ? 0 : f.colorTol;
        var limit = Math.round(tol / 100 * 255);
        var near = maxDiff <= limit;
        if (f.colorMode === "eq" && !near) return false;
        if (f.colorMode === "neq" && near) return false;
      } else if (f.colorMode === "eq") {
        return false;
      }
    }

    return true;
  }

  function filteredLayers() {
    var out = [];
    for (var i = 0; i < state.layers.length; i++) {
      if (matchLayer(state.layers[i], state.filters)) out.push(state.layers[i]);
    }
    return out;
  }

  function readFilters() {
    state.filters.search = $("fSearch").value;
    state.filters.fontMode = $("fFontMode").value;
    state.filters.sizeMin = $("fSizeMin").value;
    state.filters.sizeMax = $("fSizeMax").value;
    state.filters.bold = $("fBold").value;
    state.filters.italic = $("fItalic").value;
    state.filters.visible = $("fVisible").value;
    state.filters.colorMode = $("fColorMode").value;
    state.filters.colorTol = parseFloat($("fColorTolNum").value);
    if (isNaN(state.filters.colorTol)) state.filters.colorTol = 0;
  }

  function renderColorSwatch() {
    var el = $("fColorSwatch");
    if (el) el.style.background = state.filters.colorHex || "#FFFFFF";
  }

  function renderImageColorSwatch() {
    var el = $("iColorSwatch");
    if (el) el.style.background = state.imageFilters.colorHex || "#FFFFFF";
  }

  function renderEditColorSwatch() {
    var el = $("eColorSwatch");
    if (el) el.style.background = $("eColor").value || "#000000";
    if ($("eColorHex")) $("eColorHex").textContent = $("eColor").value || "#000000";
  }

  /* ================= 颜色选择弹层（色环 + SV 方块 + 通道滑条 + 吸管） ================= */

  var CP_WHEEL = 200;
  var CP_OUTER = 95;
  var CP_INNER = 70;
  var cp = {
    h: 0,
    s: 1,
    v: 1,
    mode: "rgb1",
    target: "text",
    picking: false
  };
  var cpRows = [];
  var cpTrackDrag = null;
  var cpSquareDrag = false;
  var cpRingDrag = false;
  var cpRingDrawn = false;

  function cpCurrentRgb() {
    return hsvToRgb(cp.h, cp.s, cp.v);
  }

  function cpCurrentHex() {
    var rgb = cpCurrentRgb();
    return rgbToHex(rgb.r, rgb.g, rgb.b);
  }

  function cpSetFromHex(hex) {
    var rgb = hexToRgb(hex) || { r: 255, g: 255, b: 255 };
    var hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    cp.h = hsv.h;
    cp.s = hsv.s;
    cp.v = hsv.v;
  }

  function cpDrawRing() {
    var cv = $("cpRing");
    if (!cv || !cv.getContext) return;
    var ctx = cv.getContext("2d");
    var c = CP_WHEEL / 2;
    var r = (CP_OUTER + CP_INNER) / 2;
    ctx.clearRect(0, 0, CP_WHEEL, CP_WHEEL);
    ctx.lineWidth = CP_OUTER - CP_INNER;
    for (var a = 0; a < 360; a += 2) {
      ctx.beginPath();
      ctx.strokeStyle = "hsl(" + a + ",100%,50%)";
      ctx.arc(c, c, r, -(a + 2.5) * Math.PI / 180, -(a - 0.5) * Math.PI / 180, false);
      ctx.stroke();
    }
    cpRingDrawn = true;
  }

  function cpValueFraction(key) {
    var rgb = cpCurrentRgb();
    if (key === "r") return rgb.r / 255;
    if (key === "g") return rgb.g / 255;
    if (key === "b") return rgb.b / 255;
    if (key === "h") return cp.h / 360;
    if (key === "s") return cp.s;
    return cp.v;
  }

  function cpTrackGradient(key) {
    var rgb = cpCurrentRgb();
    if (key === "r") return "linear-gradient(to right, " + rgbToHex(0, rgb.g, rgb.b) + ", " + rgbToHex(255, rgb.g, rgb.b) + ")";
    if (key === "g") return "linear-gradient(to right, " + rgbToHex(rgb.r, 0, rgb.b) + ", " + rgbToHex(rgb.r, 255, rgb.b) + ")";
    if (key === "b") return "linear-gradient(to right, " + rgbToHex(rgb.r, rgb.g, 0) + ", " + rgbToHex(rgb.r, rgb.g, 255) + ")";
    if (key === "h") return "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)";
    if (key === "s") return "linear-gradient(to right, hsl(" + Math.round(cp.h) + ",0%," + Math.round(cp.v * 100) + "%), hsl(" + Math.round(cp.h) + ",100%," + Math.round(cp.v * 100) + "%))";
    return "linear-gradient(to right, #000, hsl(" + Math.round(cp.h) + "," + Math.round(cp.s * 100) + "%,100%))";
  }

  function cpChannelText(key) {
    var rgb = cpCurrentRgb();
    if (key === "r" || key === "g" || key === "b") {
      var v = key === "r" ? rgb.r : key === "g" ? rgb.g : rgb.b;
      if (cp.mode === "rgb1") {
        var f = v / 255;
        var t = f.toFixed(2);
        if (t.charAt(t.length - 1) === "0") t = t.substring(0, t.length - 1);
        return t;
      }
      return String(Math.round(v));
    }
    if (key === "h") return String(Math.round(cp.h));
    if (key === "s") return String(Math.round(cp.s * 100));
    return String(Math.round(cp.v * 100));
  }

  function cpSetChannel(key, value) {
    if (isNaN(value)) return;
    if (key === "h") {
      cp.h = ((value % 360) + 360) % 360;
      return;
    }
    if (key === "s") {
      cp.s = Math.max(0, Math.min(1, value / 100));
      return;
    }
    if (key === "v") {
      cp.v = Math.max(0, Math.min(1, value / 100));
      return;
    }
    var rgb = cpCurrentRgb();
    if (key === "r") rgb.r = value;
    else if (key === "g") rgb.g = value;
    else if (key === "b") rgb.b = value;
    else return;
    rgb.r = Math.max(0, Math.min(255, rgb.r));
    rgb.g = Math.max(0, Math.min(255, rgb.g));
    rgb.b = Math.max(0, Math.min(255, rgb.b));
    var hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    cp.h = hsv.h;
    cp.s = hsv.s;
    cp.v = hsv.v;
  }

  function cpRender() {
    var rgb = cpCurrentRgb();
    var hex = rgbToHex(rgb.r, rgb.g, rgb.b);

    if (!cpRingDrawn) cpDrawRing();

    $("cpSquare").style.background =
      "linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, hsl(" +
      Math.round(cp.h) + ", 100%, 50%))";
    $("cpCursor").style.left = cp.s * 100 + "%";
    $("cpCursor").style.top = (1 - cp.v) * 100 + "%";

    var rad = cp.h * Math.PI / 180;
    var mid = (CP_OUTER + CP_INNER) / 2;
    $("cpHueDot").style.left = CP_WHEEL / 2 + mid * Math.cos(rad) + "px";
    $("cpHueDot").style.top = CP_WHEEL / 2 - mid * Math.sin(rad) + "px";

    $("cpPreview").style.background = hex;
    $("cpHex").value = hex.toUpperCase();

    for (var i = 0; i < cpRows.length; i++) {
      var row = cpRows[i];
      row.track.style.background = cpTrackGradient(row.key);
      row.thumb.style.left = cpValueFraction(row.key) * 100 + "%";
      row.input.value = cpChannelText(row.key);
    }
  }

  function cpBuildSliders() {
    var host = $("cpSliders");
    host.innerHTML = "";
    cpRows = [];

    var defs;
    if (cp.mode === "hsv") {
      defs = [{ key: "h", label: "H" }, { key: "s", label: "S" }, { key: "v", label: "V" }];
    } else {
      defs = [{ key: "r", label: "R" }, { key: "g", label: "G" }, { key: "b", label: "B" }];
    }

    for (var i = 0; i < defs.length; i++) {
      var def = defs[i];
      var row = document.createElement("div");
      row.className = "cp-row";

      var label = document.createElement("span");
      label.className = "cp-row-label";
      label.textContent = def.label;
      row.appendChild(label);

      var track = document.createElement("div");
      track.className = "cp-row-track";
      var thumb = document.createElement("div");
      thumb.className = "cp-row-thumb";
      track.appendChild(thumb);
      row.appendChild(track);

      var input = document.createElement("input");
      input.className = "input cp-row-input";
      input.type = "text";
      row.appendChild(input);
      host.appendChild(row);

      var ref = { key: def.key, track: track, thumb: thumb, input: input };
      (function (r) {
        r.track.addEventListener("mousedown", function (ev) {
          if (ev.button !== 0) return;
          ev.preventDefault();
          cpTrackDrag = r;
          cpApplyTrack(ev, r);
        });
        r.input.addEventListener("input", function () {
          var value = parseFloat(r.input.value);
          if (isNaN(value)) return;
          if (cp.mode === "rgb1") value = value * 255;
          cpSetChannel(r.key, value);
          cpRender();
        });
      })(ref);
      cpRows.push(ref);
    }
  }

  function cpApplyTrack(ev, ref) {
    var rect = ref.track.getBoundingClientRect();
    var t = (ev.clientX - rect.left) / rect.width;
    t = Math.max(0, Math.min(1, t));
    var value;
    if (ref.key === "h") value = t * 360;
    else if (ref.key === "s" || ref.key === "v") value = t * 100;
    else value = t * 255;
    cpSetChannel(ref.key, value);
    cpRender();
  }

  function cpSetMode(mode) {
    cp.mode = mode === "rgb" ? "rgb1" : mode || "rgb1";
    var sel = $("cpMode");
    if (sel) sel.value = cp.mode;
    cpBuildSliders();
    cpRender();
  }

  function openColorPicker(hex, target) {
    cp.target = target || "text";
    cpSetFromHex(hex);
    $("colorModal").classList.remove("hidden");
    if (!cpRingDrawn) cpDrawRing();
    cpRender();
  }

  function closeColorPicker() {
    cpStopPick();
    $("colorModal").classList.add("hidden");
  }

  function cpUpdatePickBtn() {
    var btn = $("cpPick");
    if (btn) btn.classList.toggle("active", cp.picking);
  }

  function cpStopPick() {
    cp.picking = false;
    cpUpdatePickBtn();
  }

  function cpStartPick() {
    if (cp.picking) {
      cpStopPick();
      setStatus("已取消吸色");
      return;
    }
    cp.picking = true;
    cpUpdatePickBtn();
    setStatus("正在打开 Photoshop 原生颜色选择器…");
    evalScript('TA_showNativeColorPicker("' + jsq(cpCurrentHex()) + '")', function (res) {
      cp.picking = false;
      cpUpdatePickBtn();
      if (res === "__NO_CEP__") {
        setStatus("未检测到 CEP 环境");
        return;
      }
      var result;
      try { result = JSON.parse(res); } catch (e) {
        setStatus("原生取色结果解析失败");
        log("原生取色解析失败: " + res);
        return;
      }
      if (result.cancelled) {
        setStatus("已取消吸色");
        return;
      }
      if (result.error || !result.hex) {
        setStatus("吸色失败：" + (result.error || "未取得颜色"));
        log("吸色失败：" + (result.error || "未取得颜色"));
        return;
      }
      cpSetFromHex(result.hex);
      cpRender();
      setStatus("已吸取颜色 " + result.hex);
    });
  }

  function cpApplySV(evt) {
    var rect = $("cpSquare").getBoundingClientRect();
    var x = (evt.clientX - rect.left) / rect.width;
    var y = (evt.clientY - rect.top) / rect.height;
    cp.s = Math.max(0, Math.min(1, x));
    cp.v = 1 - Math.max(0, Math.min(1, y));
    cpRender();
  }

  function cpApplyRing(evt) {
    var rect = $("cpRing").getBoundingClientRect();
    var x = evt.clientX - rect.left - CP_WHEEL / 2;
    var y = evt.clientY - rect.top - CP_WHEEL / 2;
    var ang = Math.atan2(-y, x) * 180 / Math.PI;
    if (ang < 0) ang += 360;
    cp.h = ang;
    cpRender();
  }

  function cpInRing(evt) {
    var rect = $("cpRing").getBoundingClientRect();
    var x = evt.clientX - rect.left - CP_WHEEL / 2;
    var y = evt.clientY - rect.top - CP_WHEEL / 2;
    var dist = Math.sqrt(x * x + y * y);
    return dist >= CP_INNER - 8 && dist <= CP_OUTER + 8;
  }

  function wireColorPicker() {
    $("cpSquare").addEventListener("mousedown", function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      cpSquareDrag = true;
      cpApplySV(e);
    });

    $("cpRing").addEventListener("mousedown", function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      cpRingDrag = true;
      cpApplyRing(e);
    });

    document.addEventListener("mousemove", function (e) {
      if (cpSquareDrag) cpApplySV(e);
      else if (cpRingDrag) cpApplyRing(e);
      else if (cpTrackDrag) cpApplyTrack(e, cpTrackDrag);
    });
    document.addEventListener("mouseup", function () {
      cpSquareDrag = false;
      cpRingDrag = false;
      cpTrackDrag = null;
    });

    $("cpMode").addEventListener("change", function () {
      cpSetMode($("cpMode").value);
    });

    $("cpHex").addEventListener("input", function () {
      var rgb = hexToRgb($("cpHex").value);
      if (!rgb) return;
      var hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
      cp.h = hsv.h;
      cp.s = hsv.s;
      cp.v = hsv.v;
      cpRender();
    });

    $("cpPick").addEventListener("click", cpStartPick);

    $("cpOK").addEventListener("click", function () {
      if (cp.target === "image") {
        state.imageFilters.colorHex = cpCurrentHex().toUpperCase();
        renderImageColorSwatch();
        if ($("iColorMode").value === "any") $("iColorMode").value = "eq";
        closeColorPicker();
        if (ensureImageColorsForFilter()) return;
        renderImageList();
        return;
      }
      if (cp.target === "edit") {
        $("eColor").value = cpCurrentHex().toUpperCase();
        if ($("eColorMode").value === "none") $("eColorMode").value = "set";
        renderEditColorSwatch();
        closeColorPicker();
        return;
      }
      state.filters.colorHex = cpCurrentHex().toUpperCase();
      renderColorSwatch();
      if ($("fColorMode").value === "any") $("fColorMode").value = "eq";
      closeColorPicker();
      renderList();
    });
    $("cpCancel").addEventListener("click", closeColorPicker);
    $("colorModal").addEventListener("click", function (e) {
      if (e.target === $("colorModal")) closeColorPicker();
    });
    $("colorModal").addEventListener("contextmenu", function (e) {
      if (cp.picking) {
        e.preventDefault();
        cpStopPick();
        setStatus("已取消吸色");
      }
    });
  }

  /* ================= 渲染 ================= */

  function indexFonts() {
    state.fontByPs = {};
    for (var i = 0; i < state.fonts.length; i++) {
      var font = state.fonts[i];
      if (!font || !font.ps) continue;
      font.family = font.family || font.name || font.ps;
      font.style = font.style || "Regular";
      state.fontByPs[font.ps] = font;
    }
  }

  function fontFamiliesFromFaces(faces) {
    var seen = {};
    var families = [];
    for (var i = 0; i < faces.length; i++) {
      var family = faces[i].family || faces[i].name || faces[i].ps;
      if (!family || seen[family]) continue;
      seen[family] = true;
      families.push({ key: family, label: family });
    }
    families.sort(function (a, b) {
      if (a.label < b.label) return -1;
      if (a.label > b.label) return 1;
      return 0;
    });
    return families;
  }

  function documentFontFaces() {
    var seen = {};
    var faces = [];
    for (var i = 0; i < state.layers.length; i++) {
      var ps = layerFont(state.layers[i]);
      if (!ps || seen[ps]) continue;
      seen[ps] = true;
      faces.push(fontInfoForPs(ps));
    }
    return faces;
  }

  function fontFacesForFamily(family) {
    var faces = [];
    for (var i = 0; i < state.fonts.length; i++) {
      if (state.fonts[i].family === family) faces.push(state.fonts[i]);
    }
    faces.sort(function (a, b) {
      var as = fontStyleLabel(fontStyleKey(a));
      var bs = fontStyleLabel(fontStyleKey(b));
      if (as < bs) return -1;
      if (as > bs) return 1;
      return 0;
    });
    return faces;
  }

  function setFontSelected(ps, on) {
    var idx = state.filters.fonts.indexOf(ps);
    if (on && idx === -1) state.filters.fonts.push(ps);
    else if (!on && idx !== -1) state.filters.fonts.splice(idx, 1);
    var item = fontItemEls[ps];
    if (item) item.classList.toggle("selected", on);
  }

  function applyFontDragTo(ps) {
    if (!ps) return;
    if ((state.filters.fonts.indexOf(ps) !== -1) !== fontDrag.mode) {
      setFontSelected(ps, fontDrag.mode);
    }
  }

  function startFontDragSelect(ps) {
    fontDrag.active = true;
    fontDrag.mode = state.filters.fonts.indexOf(ps) === -1;
    fontDrag.lastFont = String(ps);
    setFontSelected(ps, fontDrag.mode);
    document.body.classList.add("dragging-fonts");
    updateFontCount();
  }

  function onFontDragMove(ev) {
    if (!fontDrag.active) return;
    var target = ev.target;
    var item = target && target.closest ? target.closest(".font-item") : null;
    if (!item) return;
    var ps = item.dataset.font;
    if (ps === fontDrag.lastFont) return;
    fontDrag.lastFont = ps;
    applyFontDragTo(ps);
    updateFontCount();
  }

  function endFontDragSelect() {
    if (!fontDrag.active) return;
    fontDrag.active = false;
    fontDrag.lastFont = null;
    document.body.classList.remove("dragging-fonts");
    renderList();
  }

  function renderFontFilter() {
    var host = $("fontList");
    host.innerHTML = "";
    fontItemEls = {};

    state.docFontFaces = documentFontFaces();
    state.docFontFaces.sort(function (a, b) {
      var an = fontDisplayName(a);
      var bn = fontDisplayName(b);
      if (an < bn) return -1;
      if (an > bn) return 1;
      return 0;
    });
    state.docFonts = [];
    for (var i = 0; i < state.docFontFaces.length; i++) state.docFonts.push(state.docFontFaces[i].ps);

    var validSelection = [];
    for (var j = 0; j < state.filters.fonts.length; j++) {
      if (state.docFonts.indexOf(state.filters.fonts[j]) !== -1) validSelection.push(state.filters.fonts[j]);
    }
    state.filters.fonts = validSelection;

    if (!state.docFontFaces.length) {
      host.innerHTML = '<div class="empty-hint">当前文档未发现文本图层</div>';
      updateFontCount();
      return;
    }

    for (var k = 0; k < state.docFontFaces.length; k++) {
      (function (font) {
        var item = document.createElement("div");
        item.className = "font-item" + (state.filters.fonts.indexOf(font.ps) !== -1 ? " selected" : "") + (font.missing ? " missing" : "");
        item.dataset.font = font.ps;
        item.textContent = fontDisplayName(font) + (font.missing ? " (字体缺失)" : "");
        fontItemEls[font.ps] = item;
        item.addEventListener("mousedown", function (ev) {
          if (ev.button !== 0) return;
          ev.preventDefault();
          startFontDragSelect(font.ps);
        });
        host.appendChild(item);
      })(state.docFontFaces[k]);
    }

    updateFontCount();
  }

  function updateFontCount() {
    var n = state.filters.fonts.length;
    $("fontCount").textContent = n ? n + " 已选" : "全部";
  }

  function renderBatchFontStyles() {
    var family = $("eFont").value;
    var sel = $("eFontStyle");
    var current = sel.value;
    sel.innerHTML = "";

    if (!family) {
      var placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "（先选择字体）";
      sel.appendChild(placeholder);
      sel.disabled = true;
      return;
    }

    var faces = fontFacesForFamily(family);
    if (!faces.length) {
      var missing = document.createElement("option");
      missing.value = "";
      missing.textContent = "（没有可用样式）";
      sel.appendChild(missing);
      sel.disabled = true;
      return;
    }

    sel.disabled = false;
    var fallback = faces[0].ps;
    for (var i = 0; i < faces.length; i++) {
      var opt = document.createElement("option");
      opt.value = faces[i].ps;
      opt.textContent = fontStyleLabel(fontStyleKey(faces[i]));
      sel.appendChild(opt);
      var key = fontStyleKey(faces[i]).toLowerCase().replace(/[\s_-]/g, "");
      if (key === "regular" || key === "normal" || key === "roman" || key === "r") fallback = faces[i].ps;
    }
    sel.value = current && Array.prototype.some.call(sel.options, function (o) { return o.value === current; })
      ? current
      : fallback;
  }

  function renderFontSelect() {
    var sel = $("eFont");
    var current = sel.value;
    var families = fontFamiliesFromFaces(state.fonts);
    sel.innerHTML = "";
    var none = document.createElement("option");
    none.value = "";
    none.textContent = "（不修改）";
    sel.appendChild(none);
    for (var i = 0; i < families.length; i++) {
      var opt = document.createElement("option");
      opt.value = families[i].key;
      opt.textContent = families[i].label;
      sel.appendChild(opt);
    }
    sel.value = Array.prototype.some.call(sel.options, function (o) { return o.value === current; })
      ? current
      : "";
    renderBatchFontStyles();
  }

  function readImageFilters() {
    state.imageFilters.search = $("iSearch").value;
    state.imageFilters.typeMode = $("iTypeMode").value;
    state.imageFilters.widthMin = $("iWidthMin").value;
    state.imageFilters.widthMax = $("iWidthMax").value;
    state.imageFilters.heightMin = $("iHeightMin").value;
    state.imageFilters.heightMax = $("iHeightMax").value;
    state.imageFilters.colorMode = $("iColorMode").value;
    state.imageFilters.colorTol = parseFloat($("iColorTolNum").value);
    if (isNaN(state.imageFilters.colorTol)) state.imageFilters.colorTol = 0;
  }

  function matchImage(layer, f) {
    if (f.search && String(layer.name || "").toLowerCase().indexOf(f.search.toLowerCase()) === -1) return false;
    if (f.types && f.types.length) {
      var typeHit = f.types.indexOf(layer.type || "raster") !== -1;
      if (f.typeMode === "include" && !typeHit) return false;
      if (f.typeMode === "exclude" && typeHit) return false;
    }
    var wMin = f.widthMin === "" ? null : parseFloat(f.widthMin);
    var wMax = f.widthMax === "" ? null : parseFloat(f.widthMax);
    var hMin = f.heightMin === "" ? null : parseFloat(f.heightMin);
    var hMax = f.heightMax === "" ? null : parseFloat(f.heightMax);
    if (wMin != null && !isNaN(wMin) && layer.width < wMin) return false;
    if (wMax != null && !isNaN(wMax) && layer.width > wMax) return false;
    if (hMin != null && !isNaN(hMin) && layer.height < hMin) return false;
    if (hMax != null && !isNaN(hMax) && layer.height > hMax) return false;

    if (f.colorMode !== "any") {
      var want = hexToRgb(f.colorHex);
      var got = hexToRgb(layer.colorHex);
      if (want && got) {
        var maxDiff = Math.max(Math.abs(want.r - got.r), Math.abs(want.g - got.g), Math.abs(want.b - got.b));
        var limit = Math.round((isNaN(f.colorTol) ? 0 : f.colorTol) / 100 * 255);
        var near = maxDiff <= limit;
        if (f.colorMode === "eq" && !near) return false;
        if (f.colorMode === "neq" && near) return false;
      } else {
        var fullTolerance = !isNaN(f.colorTol) && f.colorTol >= 100;
        if (f.colorMode === "eq" && !fullTolerance) return false;
        if (f.colorMode === "neq" && fullTolerance) return false;
      }
    }
    return true;
  }

  function filteredImages() {
    var out = [];
    readImageFilters();
    for (var i = 0; i < state.images.length; i++) {
      if (matchImage(state.images[i], state.imageFilters)) out.push(state.images[i]);
    }
    return out;
  }

  function imageTypeLabel(type) {
    if (type === "smartObject") return "智能对象";
    if (type === "shape") return "形状";
    if (type === "video") return "视频图层";
    if (type === "text") return "文本";
    if (type === "adjustment") return "调整图层";
    return "像素图层";
  }

  function imageTypeOrder(type) {
    var order = { raster: 1, smartObject: 2, shape: 3, adjustment: 4, video: 5, text: 6 };
    return order[type] || 99;
  }

  function imageTypesFromLayers() {
    var seen = {};
    var list = [];
    for (var i = 0; i < state.images.length; i++) {
      var type = state.images[i].type || "raster";
      if (seen[type]) continue;
      seen[type] = true;
      list.push(type);
    }
    list.sort(function (a, b) { return imageTypeOrder(a) - imageTypeOrder(b) || imageTypeLabel(a).localeCompare(imageTypeLabel(b)); });
    return list;
  }

  function setImageTypeSelected(type, selected) {
    var arr = state.imageFilters.types;
    var idx = arr.indexOf(type);
    if (selected && idx === -1) arr.push(type);
    if (!selected && idx !== -1) arr.splice(idx, 1);
  }

  function updateImageTypeCount() {
    var n = state.imageFilters.types.length;
    $("imageTypeCount").textContent = n ? n + " 已选" : "全部";
  }

  function renderImageTypeFilter() {
    var host = $("imageTypeList");
    host.innerHTML = "";
    var types = imageTypesFromLayers();
    var valid = [];
    for (var i = 0; i < state.imageFilters.types.length; i++) {
      if (types.indexOf(state.imageFilters.types[i]) !== -1) valid.push(state.imageFilters.types[i]);
    }
    state.imageFilters.types = valid;
    if (!types.length) {
      host.innerHTML = '<div class="empty-hint">当前文档未发现图片图层类型</div>';
      updateImageTypeCount();
      return;
    }
    for (var j = 0; j < types.length; j++) {
      (function (type) {
        var item = document.createElement("div");
        item.className = "font-item" + (state.imageFilters.types.indexOf(type) !== -1 ? " selected" : "");
        item.dataset.type = type;
        item.textContent = imageTypeLabel(type);
        item.addEventListener("mousedown", function (ev) {
          if (ev.button !== 0) return;
          ev.preventDefault();
          setImageTypeSelected(type, state.imageFilters.types.indexOf(type) === -1);
          renderImageTypeFilter();
          renderImageList();
        });
        host.appendChild(item);
      })(types[j]);
    }
    updateImageTypeCount();
  }

  function renderImageList() {
    var host = $("imageList");
    host.innerHTML = "";
    imageRowEls = {};
    var layers = filteredImages();
    if (!state.images.length) {
      host.innerHTML = '<div class="empty-hint">当前文档没有图片图层</div>';
    } else if (!layers.length) {
      host.innerHTML = '<div class="empty-hint">没有符合筛选条件的图片</div>';
    } else {
      for (var i = 0; i < layers.length; i++) host.appendChild(buildImageRow(layers[i]));
    }
    updateImageCounts();
  }

  var IMAGE_TYPE_ICONS = {
    raster: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="3" y="3" width="6" height="6" fill="currentColor"/><rect x="9" y="9" width="6" height="6" fill="currentColor"/><rect x="15" y="15" width="6" height="6" fill="currentColor"/></svg>',
    shape: '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="12" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="16" cy="16" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
    smartObject: '<svg viewBox="0 0 24 24"><path d="M6 2.5h8l6 6v13H6z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M14 2.5v6h6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
    video: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 9l5 3-5 3z" fill="currentColor"/></svg>',
    adjustment: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/></svg>',
    text: '<svg viewBox="0 0 24 24"><path d="M5 5h14v3M12 5v14M9 19h6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>'
  };

  function buildImageTypeIcon(layer) {
    var icon = document.createElement("span");
    icon.className = "layer-type-icon";
    icon.innerHTML = IMAGE_TYPE_ICONS[layer.type] || IMAGE_TYPE_ICONS.raster;
    icon.title = layer.typeLabel || "图层";
    return icon;
  }

  function buildImageRow(layer) {
    var row = document.createElement("div");
    row.className = "layer-row" + (state.imageSelected[layer.id] ? " selected" : "");
    row.dataset.id = layer.id;
    imageRowEls[layer.id] = row;
    var main = document.createElement("div");
    main.className = "layer-main";
    var title = document.createElement("div");
    title.className = "layer-title";
    var name = document.createElement("span");
    name.className = "layer-name";
    name.textContent = layer.name || "(未命名)";
    title.appendChild(name);
    main.appendChild(title);
    var sub = document.createElement("div");
    sub.className = "layer-sub";
    sub.textContent = Math.round(layer.width) + " x " + Math.round(layer.height) + " px";
    main.appendChild(sub);

    var meta = document.createElement("div");
    meta.className = "layer-meta";
    var swatch = document.createElement("span");
    swatch.className = "swatch" + (layer.colorAvailable ? "" : " missing-color");
    swatch.style.background = layer.colorHex || "#555555";
    swatch.title = layer.colorHex || "尚未提取主色，点击“提取主色”后获取";
    var sizeCol = document.createElement("span");
    sizeCol.className = "meta-col meta-size image-size";
    sizeCol.textContent = Math.round(layer.width) + " x " + Math.round(layer.height);
    meta.appendChild(buildImageTypeIcon(layer));
    meta.appendChild(swatch);
    meta.appendChild(sizeCol);

    row.appendChild(main);
    row.appendChild(meta);
    row.addEventListener("mousedown", function (ev) {
      if (ev.button !== 0) return;
      ev.preventDefault();
      startImageDragSelect(layer.id);
    });
    return row;
  }

  function setImageSelected(id, on) {
    if (on) state.imageSelected[id] = true;
    else delete state.imageSelected[id];
    var row = imageRowEls[id];
    if (row) row.classList.toggle("selected", on);
  }

  function applyImageDragTo(id) {
    if (id == null) return;
    var wasOn = !!state.imageSelected[id];
    if (wasOn !== imageDrag.mode) setImageSelected(id, imageDrag.mode);
  }

  function startImageDragSelect(id) {
    imageDrag.active = true;
    imageDrag.mode = !state.imageSelected[id];
    imageDrag.lastId = String(id);
    setImageSelected(id, imageDrag.mode);
    document.body.classList.add("dragging-list");
    updateImageCounts();
  }

  function onImageDragMove(ev) {
    if (!imageDrag.active) return;
    var target = ev.target;
    var row = target && target.closest ? target.closest("#imageList .layer-row") : null;
    if (!row) return;
    if (row.dataset.id === imageDrag.lastId) return;
    imageDrag.lastId = row.dataset.id;
    applyImageDragTo(row.dataset.id);
    updateImageCounts();
  }

  function endImageDragSelect() {
    if (!imageDrag.active) return;
    imageDrag.active = false;
    imageDrag.lastId = null;
    document.body.classList.remove("dragging-list");
    updateImageCounts();
  }

  function updateImageCounts() {
    var layers = filteredImages();
    var selected = 0;
    for (var i = 0; i < layers.length; i++) if (state.imageSelected[layers[i].id]) selected++;
    $("imageListCount").textContent = "匹配 " + layers.length + " / 共 " + state.images.length + (selected ? "，已选 " + selected : "");
    $("imageApplyInfo").textContent = selected ? "已选中 " + selected + " 个图层" : "未选择图层（点击列表项选择）";
    var extracted = 0;
    var colorTargets = 0;
    for (var j = 0; j < state.images.length; j++) {
      if (state.images[j].empty) continue;
      colorTargets++;
      if (state.images[j].colorAvailable) extracted++;
    }
    $("imageColorExtractStatus").textContent = !colorTargets ? "主色：无可提取图层" :
      (extracted === colorTargets ? "主色：已完成" : "主色：已提取 " + extracted + "/" + colorTargets);
  }

  function hasMissingImageColors() {
    for (var i = 0; i < state.images.length; i++) {
      if (!state.images[i].empty && !state.images[i].colorAvailable) return true;
    }
    return false;
  }

  function ensureImageColorsForFilter() {
    if ($("iColorMode").value === "any" || !hasMissingImageColors()) return false;
    extractImageColorsWithConfirm(function () {
      $("iColorMode").value = "any";
      renderImageList();
    });
    return true;
  }

  var extractConfirmAction = null;
  var extractCancelAction = null;

  function showExtractColorConfirm(onConfirm, onCancel) {
    extractConfirmAction = onConfirm;
    extractCancelAction = onCancel;
    $("extractColorModal").classList.remove("hidden");
  }

  function closeExtractColorConfirm(confirmed) {
    $("extractColorModal").classList.add("hidden");
    var action = confirmed ? extractConfirmAction : extractCancelAction;
    extractConfirmAction = null;
    extractCancelAction = null;
    if (action) action();
  }

  function allImageColorIds() {
    var ids = [];
    for (var i = 0; i < state.images.length; i++) if (!state.images[i].empty) ids.push(state.images[i].id);
    return ids;
  }

  function selectedImageColorIds() {
    var layers = filteredImages();
    var ids = [];
    for (var i = 0; i < layers.length; i++) {
      if (state.imageSelected[layers[i].id] && !layers[i].empty) ids.push(layers[i].id);
    }
    return ids;
  }

  function extractImageColorsWithConfirm(ids, onCancel) {
    if (typeof ids === "function") { onCancel = ids; ids = null; }
    if (ids === null || ids === undefined) ids = allImageColorIds();
    if (!state.images.length) {
      setStatus("当前没有可提取主色的图片图层");
      return;
    }
    if (!ids.length) {
      setStatus("没有可提取主色的非空图片图层");
      return;
    }
    showExtractColorConfirm(function () {
      taskStart("提取图片图层主色", "正在分批分析图层，期间请勿操作 Photoshop。", true);
      var batchSize = 1;
      var allColors = [];
      var allErrors = [];
      var total = ids.length;
      function next(offset) {
        setStatus("正在提取主色 " + Math.min(offset + batchSize, total) + " / " + total + "…");
        evalScript('TA_extractImageColors("' + ids.join(",") + '",' + offset + ',' + batchSize + ')', function (res) {
      if (res === "__NO_CEP__") {
        setStatus("未检测到 CEP 环境");
        taskEnd();
        return;
      }
      var result;
      try { result = JSON.parse(res); } catch (e) {
        setStatus("主色提取结果解析失败");
        log("主色提取解析失败: " + res);
        taskEnd();
        return;
      }
      allColors = allColors.concat(result.colors || []);
      allErrors = allErrors.concat(result.errors || []);
      taskUpdate(Math.min(offset + batchSize, total), total);
      if (taskCancelled) {
        var cancelledMsg = "已终止主色提取：已完成 " + allColors.length + " 个";
        setStatus(cancelledMsg); log(cancelledMsg);
        var partial = {};
        for (var pc = 0; pc < allColors.length; pc++) partial[allColors[pc].id] = allColors[pc];
        for (var pj = 0; pj < state.images.length; pj++) if (partial[state.images[pj].id]) {
          state.images[pj].colorHex = partial[state.images[pj].id].colorHex;
          state.images[pj].colorAvailable = true;
        }
        renderImageList(); saveDocumentCache(); taskEnd();
        return;
      }
      if (!result.done) {
        setTimeout(function () { next(offset + batchSize); }, 0);
        return;
      }
      var byId = {};
      for (var c = 0; c < allColors.length; c++) byId[allColors[c].id] = allColors[c];
      for (var j = 0; j < state.images.length; j++) {
        var color = byId[state.images[j].id];
        if (color) { state.images[j].colorHex = color.colorHex; state.images[j].colorAvailable = true; }
      }
      var msg = "主色提取完成：成功 " + allColors.length + " 个";
      if (allErrors.length) msg += "，失败 " + allErrors.length + " 个";
      setStatus(msg); log(msg);
      for (var eidx = 0; eidx < allErrors.length; eidx++) log("  ✗ " + allErrors[eidx]);
      renderImageList(); saveDocumentCache(); taskEnd();
        });
      }
      next(0);
    }, function () {
      setStatus("已取消提取主色");
      if (onCancel) onCancel();
    });
  }

  function applyListRowHeight() {
    var slider = $("listRowHeight");
    var host = $("layerList");
    var height = parseInt(slider.value, 10);
    if (isNaN(height)) height = 42;
    height = Math.max(26, Math.min(70, height));
    slider.value = height;
    $("listRowHeightValue").textContent = height;
    host.style.setProperty("--layer-row-height", height + "px");
    if (height <= 40) host.classList.add("compact");
    else host.classList.remove("compact");
  }

  function applyImageRowHeight() {
    var slider = $("imageRowHeight");
    var host = $("imageList");
    var height = parseInt(slider.value, 10);
    if (isNaN(height)) height = 42;
    height = Math.max(26, Math.min(70, height));
    slider.value = height;
    $("imageRowHeightValue").textContent = height;
    host.style.setProperty("--layer-row-height", height + "px");
    if (height <= 40) host.classList.add("compact");
    else host.classList.remove("compact");
  }

  function renderList() {
    readFilters();

    var host = $("layerList");
    host.innerHTML = "";
    rowEls = {};

    var layers = filteredLayers();

    if (!state.layers.length) {
      host.innerHTML = '<div class="empty-hint">' + (state.docName ? "当前文档没有文本图层" : "请打开文档并点击「扫描 / 刷新」") + "</div>";
    } else if (!layers.length) {
      host.innerHTML = '<div class="empty-hint">没有符合筛选条件的文本</div>';
    } else {
      for (var i = 0; i < layers.length; i++) {
        host.appendChild(buildRow(layers[i]));
      }
    }

    updateCounts();
  }

  function buildRow(layer) {
    var row = document.createElement("div");
    row.className = "layer-row" + (state.selected[layer.id] ? " selected" : "");
    row.dataset.id = layer.id;
    rowEls[layer.id] = row;

    var main = document.createElement("div");
    main.className = "layer-main";

    var title = document.createElement("div");
    title.className = "layer-title";
    var name = document.createElement("span");
    name.className = "layer-name";
    name.textContent = layer.name || "(未命名)";
    title.appendChild(name);
    if (!layer.visible) {
      var hidden = document.createElement("span");
      hidden.className = "badge";
      hidden.textContent = "隐藏";
      title.appendChild(hidden);
    }
    main.appendChild(title);

    var previewText = (layer.contents || "").replace(/\s+/g, " ").slice(0, 40);
    if (previewText) {
      var preview = document.createElement("div");
      preview.className = "layer-sub";
      preview.textContent = previewText;
      main.appendChild(preview);
    }

    // 右侧属性列
    var meta = document.createElement("div");
    meta.className = "layer-meta";

    var swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = layer.colorHex;

    var fontCol = document.createElement("span");
    fontCol.className = "meta-col meta-font";
    var fontInfo = layerFontInfo(layer);
    fontCol.textContent = fontDisplayName(fontInfo);
    fontCol.title = fontCol.textContent;

    var sizeCol = document.createElement("span");
    sizeCol.className = "meta-col meta-size";
    sizeCol.textContent = layer.size != null ? Math.round(layer.size * 100) / 100 + " px" : "?";

    var styleCol = document.createElement("span");
    styleCol.className = "layer-meta-style";
    var boldTag = document.createElement("span");
    boldTag.className = "tag " + (layer.bold ? "on" : "off");
    boldTag.textContent = "粗";
    var italicTag = document.createElement("span");
    italicTag.className = "tag " + (layer.italic ? "on" : "off");
    italicTag.textContent = "斜";
    styleCol.appendChild(boldTag);
    styleCol.appendChild(italicTag);

    meta.appendChild(swatch);
    meta.appendChild(fontCol);
    meta.appendChild(sizeCol);
    meta.appendChild(styleCol);

    row.appendChild(main);
    row.appendChild(meta);
    row.addEventListener("mousedown", function (ev) {
      if (ev.button !== 0) return;
      ev.preventDefault();
      startDragSelect(layer.id);
    });
    return row;
  }

  /* ---------- 列表拖选 ---------- */

  function setRowSelected(id, on) {
    if (on) state.selected[id] = true;
    else delete state.selected[id];
    var row = rowEls[id];
    if (row) row.classList.toggle("selected", on);
  }

  function applyDragTo(id) {
    if (id == null) return;
    var wasOn = !!state.selected[id];
    if (wasOn !== drag.mode) setRowSelected(id, drag.mode);
  }

  function startDragSelect(id) {
    drag.active = true;
    drag.mode = !state.selected[id];
    setRowSelected(id, drag.mode);
    document.body.classList.add("dragging-list");
    updateCounts();
  }

  function onDragMove(ev) {
    if (!drag.active) return;
    var target = ev.target;
    var row = target && target.closest ? target.closest(".layer-row") : null;
    if (!row) return;
    if (row.dataset.id === drag.lastId) return;
    drag.lastId = row.dataset.id;
    applyDragTo(row.dataset.id);
    updateCounts();
  }

  function endDragSelect() {
    if (!drag.active) return;
    drag.active = false;
    drag.lastId = null;
    document.body.classList.remove("dragging-list");
    updateCounts();
  }

  function updateCounts() {
    var layers = filteredLayers();
    var selected = 0;
    for (var i = 0; i < layers.length; i++) {
      if (state.selected[layers[i].id]) selected++;
    }
    $("listCount").textContent =
      "匹配 " + layers.length + " / 共 " + state.layers.length + (selected ? "，已选 " + selected : "");
    $("applyInfo").textContent = selected ? "已选中 " + selected + " 个图层" : "未选择图层（点击列表项选择）";
  }

  function selectedLayerIds() {
    var layers = filteredLayers();
    var ids = [];
    for (var i = 0; i < layers.length; i++) {
      if (state.selected[layers[i].id]) ids.push(layers[i].id);
    }
    return ids;
  }

  /* ================= 选项 ================= */

  function collectOptions() {
    var colorMode = $("eColorMode").value;
    return {
      font: $("eFont").value ? $("eFontStyle").value : "",
      sizeMode: $("eSizeMode").value,
      size: $("eSize").value,
      colorHex: colorMode === "set" ? $("eColor").value : "",
      bold: $("eBold").value,
      italic: $("eItalic").value,
      underline: $("eUnderline").value,
      strikeThrough: $("eStrike").value,
      capitalization: $("eCaps").value,
      baseline: $("eBaseline").value,
      baselineShift: $("eBaselineShift").value,
      textCase: $("eTextCase").value,
      tracking: $("eTracking").value,
      leading: $("eLeading").value,
      hScale: $("eHScale").value,
      vScale: $("eVScale").value,
      antiAlias: $("eAntiAlias").value,
      kerning: $("eKerning").value
    };
  }

  function hasAnyChange(o) {
    if (o.font) return true;
    if (o.sizeMode !== "none" && o.size !== "") return true;
    if (o.colorHex) return true;
    if (o.bold !== "keep" || o.italic !== "keep") return true;
    if (o.underline !== "keep" || o.strikeThrough !== "keep") return true;
    if (o.capitalization !== "keep" || o.baseline !== "keep") return true;
    if (o.textCase !== "keep") return true;
    if (o.tracking !== "" || o.leading !== "") return true;
    if (o.hScale !== "" || o.vScale !== "") return true;
    if (o.baselineShift !== "") return true;
    if (o.antiAlias !== "keep" || o.kerning !== "keep") return true;
    return false;
  }

  function validateOptions(o) {
    function isNum(v) {
      return v === "" || (!isNaN(parseFloat(v)) && isFinite(Number(v)));
    }
    if (o.sizeMode !== "none" && o.size === "") return "请填写字号";
    if (!isNum(o.size)) return "字号不是有效数字";
    if (!isNum(o.tracking)) return "字距不是有效数字";
    if (!isNum(o.leading)) return "行距不是有效数字";
    if (!isNum(o.hScale)) return "水平缩放不是有效数字";
    if (!isNum(o.vScale)) return "垂直缩放不是有效数字";
    if (!isNum(o.baselineShift)) return "基线偏移不是有效数字";
    if (o.colorHex && !/^#[0-9a-fA-F]{6}$/.test(o.colorHex)) return "颜色格式应为 #RRGGBB";
    return null;
  }

  /* ================= 应用 ================= */

  function doApply() {
    if (taskBusy) return;
    var o = collectOptions();
    log("--- 应用开始 ---");
    log("选项: " + JSON.stringify(o));

    if (!hasAnyChange(o)) {
      setStatus("请先设置至少一项要修改的属性");
      log("中止：未设置任何修改项");
      return;
    }

    var invalid = validateOptions(o);
    if (invalid) {
      setStatus("无法应用：" + invalid);
      log("中止：" + invalid);
      return;
    }

    var ids = selectedLayerIds();
    if (!ids.length) {
      setStatus("请先在列表中点击选择要应用的图层");
      log("中止：未选择任何图层（点击列表项选择，蓝色高亮即为选中）");
      return;
    }

    taskStart("应用文本调整", "正在分批处理选中的文本图层，期间请勿操作 Photoshop。", true);
    lastOperation = { mode: "text", ids: [] };
    taskUpdate(0, ids.length);
    setStatus("正在应用 " + ids.length + " 个图层…");

    var batchSize = 1;
    var completedIds = [];
    var combined = { ok: 0, failed: 0, errors: [], layers: [] };
    function runBatch(offset) {
      if (taskCancelled || offset >= ids.length) { finish(taskCancelled); return; }
      var batch = ids.slice(offset, offset + batchSize);
      var script =
      "TA_apply(" +
      '"' + batch.join(",") + '",' +
      '"' + jsq(o.font) + '",' +
      '"' + jsq(o.sizeMode) + '",' +
      '"' + jsq(o.size) + '",' +
      '"' + jsq(o.colorHex) + '",' +
      '"' + jsq(o.bold) + '",' +
      '"' + jsq(o.italic) + '",' +
      '"' + jsq(o.capitalization) + '",' +
      '"' + jsq(o.baseline) + '",' +
      '"' + jsq(o.textCase) + '",' +
      '"' + jsq(o.tracking) + '",' +
      '"' + jsq(o.leading) + '",' +
      '"' + jsq(o.hScale) + '",' +
      '"' + jsq(o.vScale) + '",' +
      '"' + jsq(o.underline) + '",' +
      '"' + jsq(o.strikeThrough) + '",' +
      '"' + jsq(o.baselineShift) + '",' +
      '"' + jsq(o.antiAlias) + '",' +
      '"' + jsq(o.kerning) + '"' +
      ")";

      evalScript(script, function (res) {
      if (res === "__NO_CEP__") {
        setStatus("未检测到 CEP 环境");
        log("错误：未检测到 CEP 环境（请通过 Photoshop 扩展面板打开）");
        taskEnd();
        return;
      }
      var result;
      try {
        result = JSON.parse(res);
      } catch (e) {
        setStatus("返回数据解析失败");
        log("解析失败: " + res);
        taskEnd();
        return;
      }

      completedIds = completedIds.concat(batch);
      combined.ok += result.ok || 0;
      combined.failed += result.failed || 0;
      combined.errors = combined.errors.concat(result.errors || []);
      combined.layers = combined.layers.concat(result.layers || []);
      taskUpdate(completedIds.length, ids.length);
      if (!taskCancelled && completedIds.length < ids.length) {
        setTimeout(function () { runBatch(completedIds.length); }, 0);
        return;
      }
      finish(taskCancelled);
      });
    }
    function finish(cancelled) {
      var message = (cancelled ? "已终止：" : "完成：") + "成功 " + combined.ok + " 个";
      if (combined.failed) message += "，失败 " + combined.failed + " 个";
      setStatus(message);
      log(message);
      if (combined.errors.length) {
        for (var k = 0; k < combined.errors.length; k++) log("  ✗ " + combined.errors[k]);
      }
      log("--- 应用结束 ---");

      taskEnd();
      lastOperation = { mode: "text", ids: completedIds, anchorMarked: true };
      mergeLayerSnapshots(state.layers, combined.layers);
      renderFontFilter();
      renderList();
      if (combined.ok) markDocumentChanged();
      saveDocumentCache();
    }
    evalScript("TA_markHistoryAnchor()", function () { runBatch(0); });
  }

  function selectLayersInPhotoshop() {
    var ids = selectedLayerIds();
    if (!ids.length) {
      setStatus("请先在列表中选择要在 Photoshop 中选中的图层");
      return;
    }

    setStatus("正在 Photoshop 中选中 " + ids.length + " 个图层…");
    evalScript('TA_selectLayers("' + ids.join(",") + '")', function (res) {
      if (res === "__NO_CEP__") {
        setStatus("未检测到 CEP 环境");
        return;
      }

      var result;
      try {
        result = JSON.parse(res);
      } catch (e) {
        setStatus("图层选择结果解析失败");
        log("图层选择结果解析失败: " + res);
        return;
      }

      var message;
      if (!result.ok && result.errors && result.errors.length) {
        message = "图层选择失败：" + result.errors[0];
      } else {
        message = "已在 Photoshop 中选中 " + result.ok + " 个图层";
        if (result.failed) message += "，失败 " + result.failed + " 个";
      }
      setStatus(message);
      log(message);
      if (result.errors && result.errors.length) {
        for (var i = 0; i < result.errors.length; i++) log("  ✗ " + result.errors[i]);
      }
    });
  }

  function selectedImageIds() {
    var layers = filteredImages();
    var ids = [];
    for (var i = 0; i < layers.length; i++) if (state.imageSelected[layers[i].id] && !layers[i].empty) ids.push(layers[i].id);
    return ids;
  }

  function doApplyImage() {
    if (taskBusy) return;
    var ids = selectedImageIds();
    if (!ids.length) {
      setStatus("请先在图片列表中选择要缩放的图层");
      return;
    }
    var mode = $("iScaleMode").value;
    var w = $("iTargetW").value;
    var h = $("iTargetH").value;
    var p = $("iScalePercent").value;
    if (mode === "percent") {
      if (p === "" || isNaN(parseFloat(p)) || parseFloat(p) <= 0) {
        setStatus("请填写有效的缩放比例");
        return;
      }
    } else if ((w === "" || isNaN(parseFloat(w)) || parseFloat(w) <= 0) && (h === "" || isNaN(parseFloat(h)) || parseFloat(h) <= 0)) {
      setStatus("请至少填写一个有效目标宽度或高度");
      return;
    }

    taskStart("应用图片调整", "正在分批处理选中的图片图层，期间请勿操作 Photoshop。", true);
    lastOperation = { mode: "image", ids: [] };
    taskUpdate(0, ids.length);
    setStatus("正在缩放 " + ids.length + " 个图片图层…");
    var batchSize = 1, completedIds = [], combined = { ok: 0, failed: 0, skipped: 0, errors: [], layers: [] };
    function runBatch(offset) {
      if (taskCancelled || offset >= ids.length) { finish(taskCancelled); return; }
      var batch = ids.slice(offset, offset + batchSize);
      var script = "TA_applyImageScale(" + '"' + batch.join(",") + '","' + jsq(mode) + '","' + jsq(w) + '","' + jsq(h) + '","' + jsq(p) + '","' + jsq(state.imageAnchor) + '")';
      evalScript(script, function (res) {
      if (res === "__NO_CEP__") {
        setStatus("未检测到 CEP 环境");
        taskEnd();
        return;
      }
      var result;
      try { result = JSON.parse(res); } catch (e) {
        setStatus("图片缩放结果解析失败");
        log("图片缩放解析失败: " + res);
        taskEnd();
        return;
      }
      completedIds = completedIds.concat(batch);
      combined.ok += result.ok || 0; combined.failed += result.failed || 0; combined.skipped += result.skipped || 0;
      combined.errors = combined.errors.concat(result.errors || []); combined.layers = combined.layers.concat(result.layers || []);
      taskUpdate(completedIds.length, ids.length);
      if (!taskCancelled && completedIds.length < ids.length) {
        setTimeout(function () { runBatch(completedIds.length); }, 0);
        return;
      }
      finish(taskCancelled);
      });
    }
    function finish(cancelled) {
      var message = (cancelled ? "已终止图片缩放：" : "图片缩放完成：") + "成功 " + combined.ok + " 个";
      if (combined.skipped) message += "，跳过空图层 " + combined.skipped + " 个";
      if (combined.failed) message += "，失败 " + combined.failed + " 个";
      setStatus(message);
      log(message);
      for (var i = 0; i < combined.errors.length; i++) log("  ✗ " + combined.errors[i]);
      taskEnd();
      lastOperation = { mode: "image", ids: completedIds, anchorMarked: true };
      mergeLayerSnapshots(state.images, combined.layers);
      renderImageList();
      if (combined.ok) markDocumentChanged();
      saveDocumentCache();
    }
    evalScript("TA_markHistoryAnchor()", function () { runBatch(0); });
  }

  function selectImagesInPhotoshop() {
    var ids = selectedImageIds();
    if (!ids.length) {
      setStatus("请先在列表中选择要在 Photoshop 中选中的图层");
      return;
    }
    setStatus("正在 Photoshop 中选中 " + ids.length + " 个图层…");
    evalScript('TA_selectLayers("' + ids.join(",") + '")', function (res) {
      if (res === "__NO_CEP__") {
        setStatus("未检测到 CEP 环境");
        return;
      }
      var result;
      try { result = JSON.parse(res); } catch (e) {
        setStatus("图层选择结果解析失败");
        log("图层选择结果解析失败: " + res);
        return;
      }
      var message;
      if (!result.ok && result.errors && result.errors.length) message = "图层选择失败：" + result.errors[0];
      else {
        message = "已在 Photoshop 中选中 " + result.ok + " 个图层";
        if (result.failed) message += "，失败 " + result.failed + " 个";
      }
      setStatus(message);
      log(message);
      if (result.errors && result.errors.length) for (var i = 0; i < result.errors.length; i++) log("  ✗ " + result.errors[i]);
    });
  }

  function focusUnionBounds(layers, selectedMap) {
    var bound = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    var count = 0;
    for (var i = 0; i < layers.length; i++) {
      if (!selectedMap[layers[i].id]) continue;
      var layer = layers[i];
      if (typeof layer.left !== "number" || typeof layer.top !== "number") continue;
      if (layer.right <= layer.left || layer.bottom <= layer.top) continue;
      bound.left = Math.min(bound.left, layer.left);
      bound.top = Math.min(bound.top, layer.top);
      bound.right = Math.max(bound.right, layer.right);
      bound.bottom = Math.max(bound.bottom, layer.bottom);
      count++;
    }
    return count ? bound : null;
  }

  function runFocus(ids, bound, label) {
    if (!bound) {
      setStatus("选中项缺少有效边界，请先刷新" + label + "图层");
      return;
    }
    evalScript(
      'TA_focusLayers("' + ids.join(",") + '",' + bound.left + "," + bound.top + "," + bound.right + "," + bound.bottom + ")",
      function (res) {
        var result;
        try { result = JSON.parse(res); } catch (e) { result = { ok: false }; }
        setStatus(result.ok ? "已选中并聚焦 " + result.ok + " 个" + label + "图层" : label + "图层聚焦失败：" + ((result.errors && result.errors[0]) || "未知错误"));
        if (result.errors) for (var i = 0; i < result.errors.length; i++) log("  ✗ " + result.errors[i]);
      }
    );
  }

  function focusImagesInPhotoshop() {
    var ids = selectedImageIds();
    if (!ids.length) {
      setStatus("请先在图片列表中选择要聚焦的图层");
      return;
    }
    runFocus(ids, focusUnionBounds(filteredImages(), state.imageSelected), "图片");
  }

  function focusTextInPhotoshop() {
    var ids = selectedLayerIds();
    if (!ids.length) {
      setStatus("请先在文本列表中选择要聚焦的图层");
      return;
    }
    runFocus(ids, focusUnionBounds(filteredLayers(), state.selected), "文本");
  }

  function doUndoLastBatch() {
    if (taskBusy) return;
    taskStart("撤销上一轮修改", "正在恢复 Photoshop 文档状态，期间请勿操作 Photoshop。");
    taskUpdate(0, 1);
    setStatus("正在撤销上一轮修改…");
    var undoScript = lastOperation.anchorMarked ? "TA_undoBatchHistory()" : "TA_undo()";
    evalScript(undoScript, function (res) {
      if (res === "__NO_CEP__") {
        setStatus("未检测到 CEP 环境");
        taskEnd();
        return;
      }
      var result;
      try { result = JSON.parse(res); } catch (e) {
        setStatus("撤销结果解析失败");
        log("撤销解析失败: " + res);
        taskEnd();
        return;
      }
      if (result.error) {
        var noHistory = result.error.indexOf("当前不可用") !== -1 || result.error.indexOf("not currently available") !== -1;
        var message = noHistory ? "没有可撤销的上一轮修改" : "撤销失败：" + result.error;
        setStatus(message);
        log(message);
        taskEnd();
        return;
      }
      setStatus("已撤销上一轮修改");
      log("已撤销上一轮修改");
      taskUpdate(1, 1);
      markDocumentChanged();
      taskEnd();
      if (!lastOperation.ids.length) return;
      evalScript('TA_snapshotLayers("' + lastOperation.ids.join(",") + '",' + (lastOperation.mode === "image" ? "true" : "false") + ")", function (snapshotRes) {
        try {
          var snapshot = JSON.parse(snapshotRes);
          if (lastOperation.mode === "image") {
            mergeLayerSnapshots(state.images, snapshot.layers);
            renderImageList();
          } else {
            mergeLayerSnapshots(state.layers, snapshot.layers);
            renderFontFilter();
            renderList();
          }
          saveDocumentCache();
        } catch (eSnapshot) {
          setStatus("撤销完成，请手动刷新列表以同步状态");
        }
      });
    });
  }

  /* ================= 扫描 / 初始化 ================= */

  function scan() {
    if (taskBusy) return;
    taskStart("刷新文本图层", "正在分批读取文本属性，期间请勿操作 Photoshop。", true);
    var batchSize = 5;
    var collected = [];
    var scanMeta = null;
    function next(offset) {
      evalScript("TA_scan(" + offset + "," + batchSize + ")", function (res) {
      if (res === "__NO_CEP__") {
        setStatus("未检测到 CEP 环境");
        log("错误：未检测到 CEP 环境（请通过 Photoshop 扩展面板打开）");
        taskEnd();
        return;
      }
      var data;
      try {
        data = JSON.parse(res);
      } catch (e) {
        setStatus("扫描返回解析失败");
        log("扫描解析失败: " + res);
        taskEnd();
        return;
      }
      if (data.cacheKey && data.fingerprint) scanMeta = data;

      for (var b = 0; b < (data.layers || []).length; b++) collected.push(data.layers[b]);
      taskUpdate(collected.length, data.total || collected.length);
      if (taskCancelled) {
        setStatus("已终止文本刷新；已读取 " + collected.length + " 个图层，原列表保持不变");
        evalScript("TA_clearScanCache()");
        taskEnd();
        return;
      }
      if (!data.done) {
        setTimeout(function () { next(offset + batchSize); }, 0);
        return;
      }
      if (data.error) {
        state.docName = "";
        state.layers = [];
        state.selected = {};
      } else {
        var meta = scanMeta || data;
        state.docKey = meta.docKey || state.docKey;
        state.cacheKey = meta.cacheKey || state.cacheKey;
        state.fingerprint = meta.fingerprint || state.fingerprint;
        state.docName = meta.docName || "";
        state.layers = collected;
        var alive = {};
        for (var i = 0; i < state.layers.length; i++) alive[state.layers[i].id] = true;
        var nextSelected = {};
        for (var id in state.selected) {
          if (state.selected.hasOwnProperty(id) && alive[id]) nextSelected[id] = true;
        }
        var hasAny = false;
        for (var key in nextSelected) {
          if (nextSelected.hasOwnProperty(key)) { hasAny = true; break; }
        }
        if (!hasAny) {
          for (var k = 0; k < state.layers.length; k++) nextSelected[state.layers[k].id] = true;
        }
        state.selected = nextSelected;
      }

      $("docName").textContent = state.docName || "未打开文档";
      renderFontFilter();
      renderList();
      setStatus(data.error ? data.error : "文档「" + state.docName + "」：共 " + state.layers.length + " 个文本图层");
      saveDocumentCache();
      taskEnd();
      });
    }
    setTimeout(function () { next(0); }, 0);
  }

  function scanImages() {
    if (taskBusy) return;
    taskStart("刷新图片图层", "正在读取图片图层信息，期间请勿操作 Photoshop。", false);
    var batchSize = 5;
    var collected = [];
    var scanMeta = null;
    var scanIds = [];
    function next(offset) {
      if (taskCancelled) { setStatus("已终止图片刷新；原列表保持不变"); evalScript("TA_clearScanCache()"); taskEnd(); return; }
      var idArg = scanIds.length ? ',"' + scanIds.join(",") + '"' : ",\"\"";
      evalScript("TA_scanImages(" + offset + "," + batchSize + idArg + ")", function (res) {
      if (res === "__NO_CEP__") {
        setStatus("未检测到 CEP 环境");
        taskEnd();
        return;
      }
      var data;
      try { data = JSON.parse(res); } catch (e) {
        setStatus("图片扫描返回解析失败");
        log("图片扫描解析失败: " + res);
        taskEnd();
        return;
      }
      if (data.error) {
        state.docName = "";
        state.images = [];
        state.imageSelected = {};
        $("docName").textContent = "未打开文档";
        renderImageList();
        setStatus(data.error);
        taskEnd();
        return;
      }
      if (data.cacheKey && data.fingerprint) scanMeta = data;
      if (data.ids && data.ids.length) scanIds = data.ids;
      for (var b = 0; b < (data.layers || []).length; b++) collected.push(data.layers[b]);
      taskUpdate(collected.length, data.total || collected.length);
      if (taskCancelled) { setStatus("已终止图片刷新；原列表保持不变"); evalScript("TA_clearScanCache()"); taskEnd(); return; }
      if (!data.done) { setTimeout(function () { next(offset + batchSize); }, 0); return; }
      if (data.error) {
        state.docName = "";
        state.images = [];
        state.imageSelected = {};
      } else {
        var meta = scanMeta || data;
        state.docKey = meta.docKey || state.docKey;
        state.cacheKey = meta.cacheKey || state.cacheKey;
        state.fingerprint = meta.fingerprint || state.fingerprint;
        state.docName = meta.docName || "";
        // 刷新会重新生成不含主色的快照，按图层 ID 保留已提取的主色。
        var previousColors = {};
        for (var pi = 0; pi < state.images.length; pi++) {
          if (state.images[pi].colorAvailable) previousColors[state.images[pi].id] = state.images[pi];
        }
        state.images = collected;
        for (var nj = 0; nj < state.images.length; nj++) {
          var kept = previousColors[state.images[nj].id];
          if (kept && !state.images[nj].empty) {
            state.images[nj].colorHex = kept.colorHex;
            state.images[nj].colorAvailable = true;
          }
        }
        var alive = {};
        for (var i = 0; i < state.images.length; i++) alive[state.images[i].id] = true;
        var next = {};
        for (var id in state.imageSelected) if (state.imageSelected.hasOwnProperty(id) && alive[id]) next[id] = true;
        var hasAny = false;
        for (var key in next) if (next.hasOwnProperty(key)) { hasAny = true; break; }
        if (!hasAny) for (var k = 0; k < state.images.length; k++) next[state.images[k].id] = true;
        state.imageSelected = next;
      }
      $("docName").textContent = state.docName || "未打开文档";
      renderImageTypeFilter();
      renderImageList();
      setStatus(data.error ? data.error : "文档「" + state.docName + "」：共 " + state.images.length + " 个图片图层");
      saveDocumentCache();
      taskEnd();
      });
    }
    setTimeout(function () { next(0); }, 0);
  }

  function loadFonts() {
    try {
      var cached = JSON.parse(localStorage.getItem(fontCacheKey) || "null");
      if (cached && cached.fonts instanceof Array && cached.fonts.length) {
        state.fonts = cached.fonts;
        indexFonts();
        renderFontSelect();
        renderFontFilter();
        renderList();
        log("已恢复系统字体缓存 " + state.fonts.length + " 个");
        return;
      }
    } catch (eCache) {}
    evalScript("TA_getFonts()", function (res) {
      try {
        state.fonts = JSON.parse(res) || [];
      } catch (e) {
        state.fonts = [];
      }
      indexFonts();
      try { localStorage.setItem(fontCacheKey, JSON.stringify({ fonts: state.fonts, savedAt: Date.now() })); } catch (eSave) {}
      renderFontSelect();
      renderFontFilter();
      renderList();
      log("已加载系统字体 " + state.fonts.length + " 个");
    });
  }

  function loadHost(callback) {
    var extPath = "";
    try {
      if (cep && cep.getSystemPath) extPath = cep.getSystemPath("extension");
    } catch (e) {}
    if (!extPath) {
      log("警告：无法获取扩展路径，尝试直接调用宿主函数");
      callback();
      return;
    }
    var p = extPath.replace(/\\/g, "/");
    evalScript('$.evalFile("' + p + '/jsx/host.jsx")', function () {
      callback();
    });
  }

  function wire() {
    try {
      var savedRowHeight = parseInt(localStorage.getItem("taListRowHeight"), 10);
      if (savedRowHeight >= 26 && savedRowHeight <= 70) $("listRowHeight").value = savedRowHeight;
    } catch (e) {}
    applyListRowHeight();
    try {
      var savedImageRowHeight = parseInt(localStorage.getItem("taImageRowHeight"), 10);
      if (savedImageRowHeight >= 26 && savedImageRowHeight <= 70) $("imageRowHeight").value = savedImageRowHeight;
    } catch (e) {}
    applyImageRowHeight();
    $("listRowHeight").addEventListener("input", function () {
      applyListRowHeight();
      try { localStorage.setItem("taListRowHeight", $("listRowHeight").value); } catch (e) {}
    });
    $("imageRowHeight").addEventListener("input", function () {
      applyImageRowHeight();
      try { localStorage.setItem("taImageRowHeight", $("imageRowHeight").value); } catch (e) {}
    });

    function setMode(mode) {
      state.mode = mode;
      $("tabText").classList.toggle("active", mode === "text");
      $("tabImage").classList.toggle("active", mode === "image");
      $("textPanel").classList.toggle("hidden", mode !== "text");
      $("imagePanel").classList.toggle("hidden", mode !== "image");
      if (mode === "image" && !state.images.length) scanImages();
      else if (mode === "text") updateCounts();
      else updateImageCounts();
    }

    $("tabText").addEventListener("click", function () { setMode("text"); });
    $("tabImage").addEventListener("click", function () { setMode("image"); });

    $("btnScan").addEventListener("click", function () {
      if (state.mode === "image") scanImages();
      else scan();
    });
    $("btnCheckDocument").addEventListener("click", function () {
      checkActiveDocument();
    });
    $("btnTaskCancel").addEventListener("click", taskCancel);

    ["fSearch", "fSizeMin", "fSizeMax"].forEach(function (id) {
      $(id).addEventListener("input", function () {
        renderList();
      });
    });
    ["fFontMode", "fBold", "fItalic", "fVisible", "fColorMode"].forEach(function (id) {
      $(id).addEventListener("change", function () {
        renderList();
      });
    });

    $("fColorSwatch").addEventListener("click", function () {
      openColorPicker(state.filters.colorHex, "text");
    });

    ["iSearch", "iWidthMin", "iWidthMax", "iHeightMin", "iHeightMax"].forEach(function (id) {
      $(id).addEventListener("input", renderImageList);
    });
    $("iTypeMode").addEventListener("change", renderImageList);
    $("btnToggleImageTypes").addEventListener("click", function () {
      $("imageTypeBox").classList.toggle("hidden");
    });
    $("btnImageTypeAll").addEventListener("click", function () {
      state.imageFilters.types = imageTypesFromLayers();
      renderImageTypeFilter();
      renderImageList();
    });
    $("btnImageTypeNone").addEventListener("click", function () {
      state.imageFilters.types = [];
      renderImageTypeFilter();
      renderImageList();
    });
    $("iColorMode").addEventListener("change", function () {
      if (ensureImageColorsForFilter()) return;
      renderImageList();
    });
    $("iColorSwatch").addEventListener("click", function () {
      openColorPicker(state.imageFilters.colorHex, "image");
    });
    $("iColorTol").addEventListener("input", function () {
      $("iColorTolNum").value = $("iColorTol").value;
      if ($("iColorMode").value === "any") $("iColorMode").value = "eq";
      if (ensureImageColorsForFilter()) return;
      renderImageList();
    });
    $("iColorTolNum").addEventListener("input", function () {
      var v = parseFloat($("iColorTolNum").value);
      if (!isNaN(v)) $("iColorTol").value = Math.max(0, Math.min(100, v));
      if ($("iColorMode").value === "any") $("iColorMode").value = "eq";
      if (ensureImageColorsForFilter()) return;
      renderImageList();
    });
    $("fColorTol").addEventListener("input", function () {
      $("fColorTolNum").value = $("fColorTol").value;
      if ($("fColorMode").value === "any") $("fColorMode").value = "eq";
      renderList();
    });
    $("fColorTolNum").addEventListener("input", function () {
      var v = parseFloat($("fColorTolNum").value);
      if (!isNaN(v)) $("fColorTol").value = Math.max(0, Math.min(100, v));
      if ($("fColorMode").value === "any") $("fColorMode").value = "eq";
      renderList();
    });

    $("btnToggleFonts").addEventListener("click", function () {
      $("fontBox").classList.toggle("hidden");
    });
    $("btnFontAll").addEventListener("click", function () {
      state.filters.fonts = (state.docFonts || []).slice();
      renderFontFilter();
      renderList();
    });
    $("btnFontNone").addEventListener("click", function () {
      state.filters.fonts = [];
      renderFontFilter();
      renderList();
    });
    $("btnResetFilters").addEventListener("click", function () {
      $("fSearch").value = "";
      $("fFontMode").value = "include";
      $("fSizeMin").value = "";
      $("fSizeMax").value = "";
      $("fBold").value = "any";
      $("fItalic").value = "any";
      $("fVisible").value = "any";
      $("fColorMode").value = "any";
      $("fColorTol").value = "0";
      $("fColorTolNum").value = "0";
      state.filters.colorHex = "#FFFFFF";
      renderColorSwatch();
      state.filters.fonts = [];
      renderFontFilter();
      renderList();
    });

    $("btnResetImageFilters").addEventListener("click", function () {
      $("iSearch").value = "";
      $("iWidthMin").value = "";
      $("iWidthMax").value = "";
      $("iHeightMin").value = "";
      $("iHeightMax").value = "";
      $("iTypeMode").value = "include";
      state.imageFilters.types = [];
      $("iColorMode").value = "any";
      $("iColorTol").value = "0";
      $("iColorTolNum").value = "0";
      state.imageFilters.colorHex = "#FFFFFF";
      renderImageColorSwatch();
      renderImageTypeFilter();
      renderImageList();
    });
    $("btnExtractImageColors").addEventListener("click", function () {
      extractImageColorsWithConfirm();
    });
    $("btnExtractSelectedImageColors").addEventListener("click", function () {
      var ids = selectedImageColorIds();
      if (!ids.length) {
        setStatus("请先在图片列表中选择要提取主色的图层");
        return;
      }
      extractImageColorsWithConfirm(ids);
    });
    $("extractColorConfirm").addEventListener("click", function () {
      closeExtractColorConfirm(true);
    });
    $("extractColorCancel").addEventListener("click", function () {
      closeExtractColorConfirm(false);
    });
    $("extractColorModal").addEventListener("click", function (e) {
      if (e.target === $("extractColorModal")) closeExtractColorConfirm(false);
    });
    $("extractColorModal").addEventListener("contextmenu", function (e) {
      e.preventDefault();
      closeExtractColorConfirm(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !$("extractColorModal").classList.contains("hidden")) {
        closeExtractColorConfirm(false);
      }
    });

    $("btnImageSelectAll").addEventListener("click", function () {
      var layers = filteredImages();
      for (var i = 0; i < layers.length; i++) state.imageSelected[layers[i].id] = true;
      renderImageList();
    });
    $("btnImageInvert").addEventListener("click", function () {
      var layers = filteredImages();
      for (var i = 0; i < layers.length; i++) {
        if (state.imageSelected[layers[i].id]) delete state.imageSelected[layers[i].id];
        else state.imageSelected[layers[i].id] = true;
      }
      renderImageList();
    });
    $("btnImageClearSel").addEventListener("click", function () {
      state.imageSelected = {};
      renderImageList();
    });
    $("btnImageSelectInPs").addEventListener("click", selectImagesInPhotoshop);
    $("btnImageFocus").addEventListener("click", focusImagesInPhotoshop);

    $("iScaleMode").addEventListener("change", function () {
      var percent = $("iScaleMode").value === "percent";
      var targets = document.querySelectorAll(".image-target-size");
      var scales = document.querySelectorAll(".image-scale-percent");
      for (var i = 0; i < targets.length; i++) targets[i].classList.toggle("hidden", percent);
      for (var j = 0; j < scales.length; j++) scales[j].classList.toggle("hidden", !percent);
    });
    var anchorButtons = $("iAnchorGrid").querySelectorAll(".anchor-point");
    for (var ab = 0; ab < anchorButtons.length; ab++) {
      anchorButtons[ab].addEventListener("click", function () {
        for (var i = 0; i < anchorButtons.length; i++) anchorButtons[i].classList.remove("active");
        this.classList.add("active");
        state.imageAnchor = this.getAttribute("data-anchor") || "mc";
      });
    }
    $("btnApplyImage").addEventListener("click", doApplyImage);
    $("btnUndoImage").addEventListener("click", doUndoLastBatch);

    $("btnSelectAll").addEventListener("click", function () {
      var layers = filteredLayers();
      for (var i = 0; i < layers.length; i++) state.selected[layers[i].id] = true;
      renderList();
    });
    $("btnInvert").addEventListener("click", function () {
      var layers = filteredLayers();
      for (var i = 0; i < layers.length; i++) {
        if (state.selected[layers[i].id]) delete state.selected[layers[i].id];
        else state.selected[layers[i].id] = true;
      }
      renderList();
    });
    $("btnClearSel").addEventListener("click", function () {
      state.selected = {};
      renderList();
    });
    $("btnSelectInPs").addEventListener("click", selectLayersInPhotoshop);
    $("btnTextFocus").addEventListener("click", focusTextInPhotoshop);

    document.addEventListener("mousemove", onDragMove);
    document.addEventListener("mouseup", endDragSelect);
    window.addEventListener("blur", endDragSelect);
    document.addEventListener("mousemove", onImageDragMove);
    document.addEventListener("mouseup", endImageDragSelect);
    window.addEventListener("blur", endImageDragSelect);
    document.addEventListener("mousemove", onFontDragMove);
    document.addEventListener("mouseup", endFontDragSelect);
    window.addEventListener("blur", endFontDragSelect);

    $("btnClearFont").addEventListener("click", function () {
      $("eFont").value = "";
      renderBatchFontStyles();
    });
    $("eFont").addEventListener("change", renderBatchFontStyles);

    $("eSize").addEventListener("input", function () {
      if ($("eSizeMode").value !== "none") return;
      var v = $("eSize").value.trim();
      if (!v) return;
      $("eSizeMode").value = (v.charAt(0) === "-" || v.charAt(0) === "+") ? "scale" : "absolute";
    });
    $("eColorSwatch").addEventListener("click", function () {
      openColorPicker($("eColor").value, "edit");
    });
    $("eColor").addEventListener("input", function () {
      renderEditColorSwatch();
      if ($("eColorMode").value === "none") $("eColorMode").value = "set";
    });

    $("btnApply").addEventListener("click", doApply);
    $("btnUndoText").addEventListener("click", doUndoLastBatch);

    $("btnToggleEditor").addEventListener("click", function () {
      var body = $("editorBody");
      var collapsed = body.classList.toggle("hidden");
      $("btnToggleEditor").textContent = collapsed ? "展开" : "收起";
    });

    $("btnToggleLog").addEventListener("click", function () {
      var box = $("logBox");
      var hidden = box.classList.toggle("hidden");
      $("btnToggleLog").textContent = hidden ? "调试输出" : "隐藏调试";
    });
  }

  function boot() {
    wire();
    wireColorPicker();
    cpSetMode("rgb");
    renderColorSwatch();
    renderImageColorSwatch();
    renderEditColorSwatch();
    loadHost(function () {
      log("=== 批量调整工具（CEP 版）===");
      loadFonts();
      checkActiveDocument();
    });
  }

  function checkActiveDocument() {
    evalScript("TA_getDocumentKey()", function (res) {
      var data = null;
      try { data = JSON.parse(res); } catch (e) {}
      if (!data || data.error || !(data.docKey || data.id)) {
        setDocumentAvailable(false);
        setStatus("未打开 Photoshop 文档");
        return;
      }
      setDocumentAvailable(true);
      var restored = restoreDocumentCache(data);
      if (!restored) scan();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
