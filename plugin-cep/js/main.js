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
    docName: "",
    layers: [],
    fonts: [],
    fontByPs: {},
    selected: {},
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
    }
  };

  var rowEls = {};
  var drag = { active: false, mode: true, lastId: null };
  var fontItemEls = {};
  var fontDrag = { active: false, mode: true, lastFont: null };

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

  /* ================= 颜色选择弹层（RGB / HSV） ================= */

  var cp = { h: 0, s: 1, v: 1, mode: "rgb" };

  function cpCurrentHex() {
    var rgb = hsvToRgb(cp.h, cp.s, cp.v);
    return rgbToHex(rgb.r, rgb.g, rgb.b);
  }

  function cpSetFromHex(hex) {
    var rgb = hexToRgb(hex) || { r: 255, g: 255, b: 255 };
    var hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    cp.h = hsv.h;
    cp.s = hsv.s;
    cp.v = hsv.v;
  }

  function cpRender() {
    var rgb = hsvToRgb(cp.h, cp.s, cp.v);
    var hex = rgbToHex(rgb.r, rgb.g, rgb.b);

    $("cpSV").style.background =
      "linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, hsl(" +
      Math.round(cp.h) + ", 100%, 50%))";
    $("cpCursor").style.left = cp.s * 100 + "%";
    $("cpCursor").style.top = (1 - cp.v) * 100 + "%";
    $("cpPreview").style.background = hex;
    $("cpHex").value = hex;
    $("cpHue").value = Math.round(cp.h);
    $("cpR").value = rgb.r;
    $("cpG").value = rgb.g;
    $("cpB").value = rgb.b;
    $("cpH").value = Math.round(cp.h);
    $("cpS").value = Math.round(cp.s * 100);
    $("cpV").value = Math.round(cp.v * 100);
  }

  function openColorPicker(hex) {
    cpSetFromHex(hex);
    $("colorModal").classList.remove("hidden");
    cpRender();
  }

  function closeColorPicker() {
    $("colorModal").classList.add("hidden");
  }

  function cpSetMode(mode) {
    cp.mode = mode;
    if (mode === "rgb") {
      $("cpRGB").classList.remove("hidden");
      $("cpHSV").classList.add("hidden");
      $("cpModeRGB").classList.add("selected");
      $("cpModeHSV").classList.remove("selected");
    } else {
      $("cpRGB").classList.add("hidden");
      $("cpHSV").classList.remove("hidden");
      $("cpModeRGB").classList.remove("selected");
      $("cpModeHSV").classList.add("selected");
    }
  }

  function wireColorPicker() {
    var sv = $("cpSV");
    var dragging = false;

    function applySV(evt) {
      var rect = sv.getBoundingClientRect();
      var x = (evt.clientX - rect.left) / rect.width;
      var y = (evt.clientY - rect.top) / rect.height;
      cp.s = Math.max(0, Math.min(1, x));
      cp.v = 1 - Math.max(0, Math.min(1, y));
      cpRender();
    }

    sv.addEventListener("mousedown", function (e) {
      dragging = true;
      applySV(e);
      e.preventDefault();
    });
    document.addEventListener("mousemove", function (e) {
      if (dragging) applySV(e);
    });
    document.addEventListener("mouseup", function () {
      dragging = false;
    });

    $("cpHue").addEventListener("input", function () {
      cp.h = parseFloat($("cpHue").value) || 0;
      cpRender();
    });

    function rgbInput() {
      var r = parseInt($("cpR").value, 10);
      var g = parseInt($("cpG").value, 10);
      var b = parseInt($("cpB").value, 10);
      if (isNaN(r) || isNaN(g) || isNaN(b)) return;
      r = Math.max(0, Math.min(255, r));
      g = Math.max(0, Math.min(255, g));
      b = Math.max(0, Math.min(255, b));
      var hsv = rgbToHsv(r, g, b);
      cp.h = hsv.h;
      cp.s = hsv.s;
      cp.v = hsv.v;
      cpRender();
    }
    ["cpR", "cpG", "cpB"].forEach(function (id) {
      $(id).addEventListener("input", rgbInput);
    });

    function hsvInput() {
      var h = parseFloat($("cpH").value);
      var s = parseFloat($("cpS").value);
      var v = parseFloat($("cpV").value);
      if (isNaN(h) || isNaN(s) || isNaN(v)) return;
      cp.h = Math.max(0, Math.min(360, h));
      cp.s = Math.max(0, Math.min(100, s)) / 100;
      cp.v = Math.max(0, Math.min(100, v)) / 100;
      cpRender();
    }
    ["cpH", "cpS", "cpV"].forEach(function (id) {
      $(id).addEventListener("input", hsvInput);
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

    $("cpModeRGB").addEventListener("click", function () { cpSetMode("rgb"); });
    $("cpModeHSV").addEventListener("click", function () { cpSetMode("hsv"); });

    $("cpOK").addEventListener("click", function () {
      state.filters.colorHex = cpCurrentHex().toUpperCase();
      renderColorSwatch();
      if ($("fColorMode").value === "any") $("fColorMode").value = "eq";
      closeColorPicker();
      renderList();
    });
    $("cpCancel").addEventListener("click", closeColorPicker);
    $("cpClose").addEventListener("click", closeColorPicker);
    $("colorModal").addEventListener("click", function (e) {
      if (e.target === $("colorModal")) closeColorPicker();
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

    setStatus("正在应用 " + ids.length + " 个图层…");

    var script =
      "TA_apply(" +
      '"' + ids.join(",") + '",' +
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
        return;
      }
      var result;
      try {
        result = JSON.parse(res);
      } catch (e) {
        setStatus("返回数据解析失败");
        log("解析失败: " + res);
        return;
      }

      var message = "完成：成功 " + result.ok + " 个";
      if (result.failed) message += "，失败 " + result.failed + " 个";
      setStatus(message);
      log(message);
      if (result.errors && result.errors.length) {
        for (var k = 0; k < result.errors.length; k++) log("  ✗ " + result.errors[k]);
      }
      log("--- 应用结束 ---");

      scan();
    });
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

  /* ================= 扫描 / 初始化 ================= */

  function scan() {
    evalScript("TA_scan()", function (res) {
      if (res === "__NO_CEP__") {
        setStatus("未检测到 CEP 环境");
        log("错误：未检测到 CEP 环境（请通过 Photoshop 扩展面板打开）");
        return;
      }
      var data;
      try {
        data = JSON.parse(res);
      } catch (e) {
        setStatus("扫描返回解析失败");
        log("扫描解析失败: " + res);
        return;
      }

      if (data.error) {
        state.docName = "";
        state.layers = [];
        state.selected = {};
      } else {
        state.docName = data.docName || "";
        state.layers = data.layers || [];
        var alive = {};
        for (var i = 0; i < state.layers.length; i++) alive[state.layers[i].id] = true;
        var next = {};
        for (var id in state.selected) {
          if (state.selected.hasOwnProperty(id) && alive[id]) next[id] = true;
        }

        // 默认全选：若当前没有任何选中项，则选中全部图层
        var hasAny = false;
        for (var key in next) {
          if (next.hasOwnProperty(key)) { hasAny = true; break; }
        }
        if (!hasAny) {
          for (var k = 0; k < state.layers.length; k++) next[state.layers[k].id] = true;
        }

        state.selected = next;
      }

      $("docName").textContent = state.docName || "未打开文档";
      renderFontFilter();
      renderList();
      setStatus(data.error ? data.error : "文档「" + state.docName + "」：共 " + state.layers.length + " 个文本图层");
    });
  }

  function loadFonts() {
    evalScript("TA_getFonts()", function (res) {
      try {
        state.fonts = JSON.parse(res) || [];
      } catch (e) {
        state.fonts = [];
      }
      indexFonts();
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
    $("listRowHeight").addEventListener("input", function () {
      applyListRowHeight();
      try { localStorage.setItem("taListRowHeight", $("listRowHeight").value); } catch (e) {}
    });

    $("btnScan").addEventListener("click", function () {
      scan();
    });

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
      openColorPicker(state.filters.colorHex);
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

    document.addEventListener("mousemove", onDragMove);
    document.addEventListener("mouseup", endDragSelect);
    window.addEventListener("blur", endDragSelect);
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
    $("eColor").addEventListener("input", function () {
      $("eColorHex").textContent = $("eColor").value;
      if ($("eColorMode").value === "none") $("eColorMode").value = "set";
    });

    $("btnApply").addEventListener("click", doApply);

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
    loadHost(function () {
      log("=== 文本批量调整（CEP 版）===");
      loadFonts();
      scan();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
