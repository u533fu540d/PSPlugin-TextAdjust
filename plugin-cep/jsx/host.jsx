#target photoshop
/*
 * CEP 面板的 Photoshop 宿主脚本（ExtendScript）
 * 由面板通过 CSInterface.evalScript 调用，所有函数返回 JSON 字符串。
 */

/* ================= 基础工具 ================= */

function taTrim(s) {
  return String(s == null ? "" : s).replace(/^\s+|\s+$/g, "");
}

function taNum(v) {
  if (v == null) return NaN;
  if (typeof v === "number") return v;
  if (typeof v.value === "number") return v.value;
  return parseFloat(v);
}

function taRound2(n) {
  return Math.round(n * 100) / 100;
}

function taPx(v) {
  try {
    if (v && typeof v.as === "function") return v.as("px");
  } catch (e) {}
  return taNum(v);
}

function taToHexByte(n) {
  var v = Math.round(n);
  if (v < 0) v = 0;
  if (v > 255) v = 255;
  var s = v.toString(16).toUpperCase();
  if (s.length < 2) s = "0" + s;
  return s;
}

function taRgbToHex(r, g, b) {
  return "#" + taToHexByte(r) + taToHexByte(g) + taToHexByte(b);
}

function taHexToRgb(hex) {
  var h = taTrim(hex).replace(/^#/, "");
  if (h.length === 3) {
    h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16)
  };
}

function taColorToHex(color) {
  try {
    var rgb = color.rgb;
    var r = taNum(rgb.red);
    var g = taNum(rgb.green);
    var b = taNum(rgb.blue);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return "#000000";
    if (r <= 1 && g <= 1 && b <= 1 && (r + g + b) > 0) {
      r = r * 255;
      g = g * 255;
      b = b * 255;
    }
    return taRgbToHex(r, g, b);
  } catch (e) {
    return "#000000";
  }
}

function taTitleCase(str) {
  return String(str).replace(/\w\S*/g, function (word) {
    return word.charAt(0).toUpperCase() + word.substring(1).toLowerCase();
  });
}

function taArrayIndexOf(arr, value) {
  for (var i = 0; i < arr.length; i++) {
    if (arr[i] === value) return i;
  }
  return -1;
}

/* 枚举探测：ExtendScript 不同版本枚举名可能不同，逐个尝试 */
function taEnum(globalName, valueName) {
  try {
    var g = eval(globalName);
    if (g && typeof g[valueName] !== "undefined") return g[valueName];
  } catch (e) {}
  return undefined;
}

function taTrySet(obj, prop, candidates) {
  for (var i = 0; i < candidates.length; i++) {
    if (candidates[i] === undefined || candidates[i] === null) continue;
    try {
      obj[prop] = candidates[i];
      return true;
    } catch (e) {}
  }
  return false;
}

/* ================= 极简 JSON 序列化（ExtendScript 无 JSON） ================= */

function taJsonQuote(s) {
  var str = String(s);
  var out = "\"";
  for (var i = 0; i < str.length; i++) {
    var c = str.charAt(i);
    if (c === "\\") out += "\\\\";
    else if (c === "\"") out += "\\\"";
    else if (c === "\n") out += "\\n";
    else if (c === "\r") out += "\\r";
    else if (c === "\t") out += "\\t";
    else {
      var code = str.charCodeAt(i);
      if (code < 32) {
        var h = code.toString(16);
        out += "\\u" + ("0000" + h).slice(-4);
      } else {
        out += c;
      }
    }
  }
  return out + "\"";
}

function taJsonStringify(value) {
  if (value === null || value === undefined) return "null";
  var t = typeof value;
  if (t === "number") return isFinite(value) ? String(value) : "null";
  if (t === "boolean") return value ? "true" : "false";
  if (t === "string") return taJsonQuote(value);
  if (value instanceof Array) {
    var arr = [];
    for (var i = 0; i < value.length; i++) arr.push(taJsonStringify(value[i]));
    return "[" + arr.join(",") + "]";
  }
  if (t === "object") {
    var props = [];
    for (var k in value) {
      if (value.hasOwnProperty(k)) props.push(taJsonQuote(k) + ":" + taJsonStringify(value[k]));
    }
    return "{" + props.join(",") + "}";
  }
  return "null";
}

/* ================= 图层 ================= */

function taCollectTextLayers(container, out) {
  var children = container.layers;
  for (var i = 0; i < children.length; i++) {
    var layer = children[i];
    if (layer.typename === "LayerSet") {
      taCollectTextLayers(layer, out);
      continue;
    }
    var isText = false;
    try { isText = (layer.kind === LayerKind.TEXT); } catch (eK) { isText = false; }
    if (isText) out.push(layer);
  }
  return out;
}

function taCollectImageLayers(container, out) {
  var children = container.layers;
  for (var i = 0; i < children.length; i++) {
    var layer = children[i];
    if (layer.typename === "LayerSet") {
      taCollectImageLayers(layer, out);
      continue;
    }
    var isImage = false;
    try {
      isImage = layer.typename === "ArtLayer" && layer.kind !== LayerKind.TEXT;
    } catch (eKind) {
      isImage = layer.typename === "ArtLayer";
    }
    if (isImage) out.push(layer);
  }
  return out;
}

function taLayerBounds(layer) {
  try {
    var b = layer.bounds;
    var left = taPx(b[0]);
    var top = taPx(b[1]);
    var right = taPx(b[2]);
    var bottom = taPx(b[3]);
    var w = Math.max(0, right - left);
    var h = Math.max(0, bottom - top);
    return { left: left, top: top, right: right, bottom: bottom, width: w, height: h };
  } catch (e) {
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
}

function taIsEmptyBoundsError(e) {
  var message = String(e && (e.message || e) || "");
  return message.indexOf("定界矩形") !== -1 || message.indexOf("bounding box") !== -1;
}

function taHistogramMean(histogram) {
  var weighted = 0;
  var count = 0;
  for (var i = 0; i < histogram.length; i++) {
    var n = Number(histogram[i]) || 0;
    weighted += i * n;
    count += n;
  }
  return count ? weighted / count : NaN;
}

function taApproxLayerMainColor(doc, layer, b) {
  if (!b || b.width <= 0 || b.height <= 0) return "";

  var originalDoc = null;
  var originalLayer = null;
  var tempDoc = null;
  try { originalDoc = app.activeDocument; } catch (eDoc) {}
  try { originalLayer = doc.activeLayer; } catch (eLayer) {}

  try {
    var maxSide = Math.max(b.width, b.height);
    var ratio = maxSide > 64 ? 64 / maxSide : 1;
    var tempW = Math.max(1, Math.round(b.width * ratio));
    var tempH = Math.max(1, Math.round(b.height * ratio));

    tempDoc = app.documents.add(
      UnitValue(tempW, "px"),
      UnitValue(tempH, "px"),
      72,
      "__TA_COLOR_SAMPLE__",
      NewDocumentMode.RGB,
      DocumentFill.TRANSPARENT
    );

    app.activeDocument = doc;
    var duplicate = layer.duplicate(tempDoc, ElementPlacement.PLACEATBEGINNING);
    app.activeDocument = tempDoc;
    try { duplicate.visible = true; } catch (eVisible) {}

    var duplicateBounds = taLayerBounds(duplicate);
    if (duplicateBounds.width <= 0 || duplicateBounds.height <= 0) return "__EMPTY__";
    try { duplicate.translate(UnitValue(-duplicateBounds.left, "px"), UnitValue(-duplicateBounds.top, "px")); }
    catch (eMove) {
      if (taIsEmptyBoundsError(eMove)) return "__EMPTY__";
      throw eMove;
    }
    if (ratio !== 1) {
      try { duplicate.resize(ratio * 100, ratio * 100, AnchorPosition.TOPLEFT); }
      catch (eResize) {
        if (taIsEmptyBoundsError(eResize)) return "__EMPTY__";
        throw eResize;
      }
    }

    var r = taHistogramMean(tempDoc.channels[0].histogram);
    var g = taHistogramMean(tempDoc.channels[1].histogram);
    var blue = taHistogramMean(tempDoc.channels[2].histogram);
    if (isNaN(r) || isNaN(g) || isNaN(blue)) return "";
    return taRgbToHex(r, g, blue);
  } catch (e) {
    return "";
  } finally {
    if (tempDoc) {
      try { tempDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (eClose) {}
    }
    if (originalDoc) {
      try { app.activeDocument = originalDoc; } catch (eRestoreDoc) {}
    }
    if (originalLayer) {
      try { doc.activeLayer = originalLayer; } catch (eRestoreLayer) {}
    }
  }
}

function taSnapshot(layer) {
  var b = taLayerBounds(layer);
  var s = {
    id: layer.id,
    name: layer.name,
    left: taRound2(b.left),
    top: taRound2(b.top),
    right: taRound2(b.right),
    bottom: taRound2(b.bottom),
    contents: "",
    font: "",
    size: null,
    bold: false,
    italic: false,
    colorHex: "#000000",
    visible: true
  };

  try {
    s.visible = !!layer.visible;
  } catch (eV) {}

  try {
    var item = layer.textItem;
    try { s.contents = item.contents || ""; } catch (e1) {}
    try { s.font = item.font || ""; } catch (e2) {}
    try {
      var size = taNum(item.size);
      if (!isNaN(size)) s.size = size;
    } catch (e3) {}
    try { s.bold = !!item.fauxBold; } catch (e4) {}
    try { s.italic = !!item.fauxItalic; } catch (e5) {}
    try { s.colorHex = taColorToHex(item.color); } catch (e6) {}
  } catch (outer) {}

  return s;
}

function taSelectLayerById(layerId, addToSelection) {
  var desc = new ActionDescriptor();
  var ref = new ActionReference();
  ref.putIdentifier(charIDToTypeID("Lyr "), Number(layerId));
  desc.putReference(charIDToTypeID("null"), ref);
  if (addToSelection) {
    desc.putEnumerated(
      stringIDToTypeID("selectionModifier"),
      stringIDToTypeID("selectionModifierType"),
      stringIDToTypeID("addToSelection")
    );
  }
  desc.putBoolean(charIDToTypeID("MkVs"), false);
  executeAction(charIDToTypeID("slct"), desc, DialogModes.NO);
}

function taLayerById(doc, layerId) {
  taSelectLayerById(layerId, false);
  return doc.activeLayer;
}

/* ================= 供面板调用的接口 ================= */

var taTextScanCache = null;
var taImageScanCache = null;

function TA_clearScanCache() {
  taTextScanCache = null;
  taImageScanCache = null;
  return taJsonStringify({ ok: true });
}

function taDocumentFingerprint(doc) {
  var path = "";
  var fileStamp = "";
  var fileSize = "";
  try {
    var file = doc.fullName;
    path = String(file.fsName || "");
    if (file.exists) {
      try { fileStamp = String(file.modified.getTime()); } catch (eStamp) {}
      try { fileSize = String(file.length); } catch (eSize) {}
    }
  } catch (eFile) {}

  var dirty = false;
  try { dirty = !!doc.modified; } catch (eDirty) {}
  var docId = String(doc.id);
  var cacheKey = path ? "file:" + path.toLowerCase() : "session:" + docId;
  return {
    docKey: docId,
    cacheKey: cacheKey,
    name: doc.name || "",
    // Reading file metadata and the dirty flag is constant-time; do not traverse
    // the layer tree here, otherwise cache validation defeats the cache itself.
    fingerprint: [path, fileStamp, fileSize, dirty ? "dirty" : "saved"].join("|")
  };
}

function TA_getDocumentKey() {
  try {
    var doc = app.activeDocument;
    return taJsonStringify(taDocumentFingerprint(doc));
  } catch (e) {
    return taJsonStringify({ docKey: "", name: "", error: "没有打开的文档" });
  }
}

function TA_scan(offset, limit) {
  var doc;
  try {
    doc = app.activeDocument;
  } catch (e) {
    return taJsonStringify({ error: "没有打开的文档" });
  }

  var docName = "";
  try { docName = doc.name || ""; } catch (eName) {}

  var start = Math.max(0, parseInt(offset, 10) || 0);
  var raw;
  try {
    if (start === 0 || !taTextScanCache || taTextScanCache.docId !== String(doc.id)) {
      taTextScanCache = { docId: String(doc.id), layers: taCollectTextLayers(doc, []) };
    }
    raw = taTextScanCache.layers;
  } catch (eLayers) {
    taTextScanCache = null;
    return taJsonStringify({ docName: docName, layers: [], error: "读取图层失败：" + String(eLayers.message || eLayers) });
  }
  var end = limit == null ? raw.length : Math.min(raw.length, start + Math.max(1, parseInt(limit, 10) || 1));
  var layers = [];
  for (var i = start; i < end; i++) {
    try { layers.push(taSnapshot(raw[i])); } catch (eSnap) {}
  }

  var meta = start === 0 ? taDocumentFingerprint(doc) : { docKey: String(doc.id), cacheKey: "", fingerprint: "" };
  var done = end >= raw.length;
  if (done) taTextScanCache = null;
  return taJsonStringify({ docKey: meta.docKey, cacheKey: meta.cacheKey, fingerprint: meta.fingerprint, docName: docName, layers: layers, total: raw.length, offset: start, done: done, error: null });
}

function TA_getFonts() {
  var list = [];
  var seen = {};
  try {
    var fonts = app.fonts;
    var count = fonts.length;
    for (var i = 0; i < count; i++) {
      var f = null;
      try { f = fonts[i]; } catch (e1) { f = null; }
      if (!f) continue;
      var ps = "";
      try { ps = f.postScriptName || ""; } catch (e2) {}
      var nm = "";
      try { nm = f.name || ""; } catch (e3) {}
      var family = "";
      try { family = f.family || ""; } catch (e4) {}
      var style = "";
      try { style = f.style || ""; } catch (e5) {}
      if (!ps) ps = nm;
      if (!ps || seen[ps]) continue;
      seen[ps] = true;
      list.push({
        family: family || nm || ps,
        style: style || "Regular",
        name: nm || family || ps,
        ps: ps
      });
    }
  } catch (outer) {}

  list.sort(function (a, b) {
    if (a.family < b.family) return -1;
    if (a.family > b.family) return 1;
    if (a.style < b.style) return -1;
    if (a.style > b.style) return 1;
    return 0;
  });

  return taJsonStringify(list);
}

function taImageLayerType(layer) {
  try {
    var kind = layer.kind;
    if (kind === LayerKind.SMARTOBJECT) return "smartObject";
    if (kind === LayerKind.TEXT) return "text";
    if (kind === LayerKind.VIDEO) return "video";
    if (kind === LayerKind.SOLIDFILL) return "shape";
    if (kind === LayerKind.GRADIENTFILL) return "shape";
    if (kind === LayerKind.PATTERNFILL) return "shape";
    if (kind === LayerKind.NORMAL) return "raster";
    return "adjustment";
  } catch (e) {
    return "raster";
  }
}

function taImageLayerTypeLabel(type) {
  if (type === "smartObject") return "智能对象";
  if (type === "shape") return "形状";
  if (type === "video") return "视频图层";
  if (type === "text") return "文本";
  if (type === "adjustment") return "调整图层";
  return "像素图层";
}

function taImageSnapshot(doc, layer) {
  var b = taLayerBounds(layer);
  var s = {
    id: layer.id,
    name: layer.name,
    left: taRound2(b.left),
    top: taRound2(b.top),
    right: taRound2(b.right),
    bottom: taRound2(b.bottom),
    width: taRound2(b.width),
    height: taRound2(b.height),
    visible: true,
    empty: b.width <= 0 || b.height <= 0,
    colorHex: "",
    colorAvailable: false
  };
  var type = taImageLayerType(layer);
  s.type = type;
  s.typeLabel = taImageLayerTypeLabel(type);
  try { s.visible = !!layer.visible; } catch (eV) {}
  return s;
}

function TA_scanImages() {
  var doc;
  try {
    doc = app.activeDocument;
  } catch (e) {
    return taJsonStringify({ error: "没有打开的文档" });
  }

  var docName = "";
  try { docName = doc.name || ""; } catch (eName) {}

  var raw;
  try {
    raw = taCollectImageLayers(doc, []);
  } catch (eLayers) {
    return taJsonStringify({ docName: docName, layers: [], error: "读取图片图层失败：" + String(eLayers.message || eLayers) });
  }
  var layers = [];
  for (var i = 0; i < raw.length; i++) {
    try { layers.push(taImageSnapshot(doc, raw[i])); } catch (eSnap) {}
  }

  var meta = taDocumentFingerprint(doc);
  return taJsonStringify({ docKey: meta.docKey, cacheKey: meta.cacheKey, fingerprint: meta.fingerprint, docName: docName, layers: layers, total: layers.length, done: true, error: null });
}

function TA_snapshotLayers(idsCsv, imageMode) {
  var result = { layers: [], error: null };
  var originalActive = null;
  try {
    var doc = app.activeDocument;
    try { originalActive = doc.activeLayer; } catch (eActive) {}
    var idSet = {};
    var ids = String(idsCsv || "").split(",");
    for (var i = 0; i < ids.length; i++) {
      var id = taTrim(ids[i]);
      if (id) idSet[id] = true;
    }
    for (var j in idSet) {
      if (!idSet.hasOwnProperty(j)) continue;
      var layer = taLayerById(doc, Number(j));
      result.layers.push(imageMode ? taImageSnapshot(doc, layer) : taSnapshot(layer));
    }
    if (originalActive) try { doc.activeLayer = originalActive; } catch (eRestore) {}
  } catch (e) {
    result.error = String(e.message || e);
  }
  return taJsonStringify(result);
}

function TA_extractImageColors(idsCsv, offset, limit) {
  var result = { ok: 0, failed: 0, skipped: 0, colors: [], errors: [] };
  var doc;
  try {
    doc = app.activeDocument;
  } catch (e) {
    result.errors.push("没有打开的文档");
    return taJsonStringify(result);
  }

  var ids = [];
  var seen = {};
  var rawIds = String(idsCsv || "").split(",");
  for (var i = 0; i < rawIds.length; i++) {
    var idText = taTrim(rawIds[i]);
    if (idText && !seen[idText]) { seen[idText] = true; ids.push(idText); }
  }

  var originalActive = null;
  try { originalActive = doc.activeLayer; } catch (eActive) {}
  var prevDialogs = null;
  try { prevDialogs = app.displayDialogs; app.displayDialogs = DialogModes.NO; } catch (eDialogs) {}

  var start = Math.max(0, parseInt(offset, 10) || 0);
  var end = limit == null ? ids.length : Math.min(ids.length, start + Math.max(1, parseInt(limit, 10) || 1));
  try {
    for (var j = start; j < end; j++) {
      var layer = taLayerById(doc, Number(ids[j]));
      try {
        var b = taLayerBounds(layer);
        if (b.width <= 0 || b.height <= 0) {
          result.skipped++;
          continue;
        }
        var hex = taApproxLayerMainColor(doc, layer, b);
        if (hex === "__EMPTY__") {
          result.skipped++;
          continue;
        }
        if (!hex) {
          result.failed++;
          result.errors.push(layer.name + "：主色提取失败");
          continue;
        }
        result.colors.push({ id: layer.id, colorHex: hex, colorAvailable: true });
        result.ok++;
      } catch (eColor) {
        result.failed++;
        result.errors.push(layer.name + "：" + String(eColor.message || eColor));
      }
    }
  } finally {
    try { app.displayDialogs = prevDialogs; } catch (eRestoreDialogs) {}
    if (originalActive) {
      try { doc.activeLayer = originalActive; } catch (eRestore) {}
    }
  }

  result.total = ids.length;
  result.offset = start;
  result.done = end >= ids.length;
  return taJsonStringify(result);
}

function TA_showNativeColorPicker(initialHex) {
  var result = { ok: false, cancelled: false, hex: "", error: null };
  var originalHex = "";
  try {
    originalHex = taColorToHex(app.foregroundColor);
  } catch (eOriginal) {}

  try {
    var rgb = taHexToRgb(initialHex);
    if (rgb) {
      var initial = new SolidColor();
      initial.rgb.red = rgb.r;
      initial.rgb.green = rgb.g;
      initial.rgb.blue = rgb.b;
      app.foregroundColor = initial;
    }

    var accepted = app.showColorPicker();
    if (accepted === false) {
      result.cancelled = true;
    } else {
      result.hex = taColorToHex(app.foregroundColor);
      result.ok = !!result.hex;
    }
  } catch (e) {
    result.error = String(e.message || e);
  } finally {
    var originalRgb = taHexToRgb(originalHex);
    if (originalRgb) {
      try {
        var restored = new SolidColor();
        restored.rgb.red = originalRgb.r;
        restored.rgb.green = originalRgb.g;
        restored.rgb.blue = originalRgb.b;
        app.foregroundColor = restored;
      } catch (eRestore) {}
    }
  }

  return taJsonStringify(result);
}

function TA_undo() {
  var result = { ok: true, error: null };
  try {
    executeAction(charIDToTypeID("undo"), undefined, DialogModes.NO);
  } catch (e) {
    result.ok = false;
    result.error = String(e.message || e);
  }
  return taJsonStringify(result);
}

/* 记录操作前的历史状态，撤销时整体回退 */
var taHistoryAnchor = null;

function TA_markHistoryAnchor() {
  var result = { ok: false, count: -1, error: null };
  try {
    var doc = app.activeDocument;
    taHistoryAnchor = doc.activeHistoryState;
    result.count = doc.historyStates.length;
    result.ok = true;
  } catch (e) {
    result.error = String(e.message || e);
  }
  return taJsonStringify(result);
}

function TA_undoBatchHistory() {
  var result = { ok: false, steps: 0, method: "", error: null };
  try {
    var doc = app.activeDocument;
    if (taHistoryAnchor) {
      doc.activeHistoryState = taHistoryAnchor;
      result.ok = true;
      result.method = "anchor";
    }
  } catch (e) {
    result.error = String(e.message || e);
  }
  if (!result.ok && !result.error) {
    try {
      executeAction(charIDToTypeID("undo"), undefined, DialogModes.NO);
      result.ok = true;
      result.steps = 1;
      result.method = "undo";
    } catch (e2) {
      result.error = String(e2.message || e2);
    }
  }
  taHistoryAnchor = null;
  return taJsonStringify(result);
}

function TA_selectLayers(idsCsv) {
  var result = { ok: 0, failed: 0, errors: [] };
  try {
    app.activeDocument;
  } catch (eDoc) {
    result.errors.push("没有打开的文档");
    return taJsonStringify(result);
  }

  var ids = String(idsCsv || "").split(",");
  var seen = {};
  var selectedAny = false;
  for (var i = 0; i < ids.length; i++) {
    var idText = taTrim(ids[i]);
    if (!idText || seen[idText]) continue;
    seen[idText] = true;
    try {
      taSelectLayerById(idText, selectedAny);
      selectedAny = true;
      result.ok++;
    } catch (eSelect) {
      result.failed++;
      result.errors.push("图层 ID " + idText + "：" + String(eSelect.message || eSelect));
    }
  }

  if (!selectedAny && !result.failed) result.errors.push("没有要选择的图层");
  return taJsonStringify(result);
}

function taSetDocumentProperty(property, desc) {
  var s2t = stringIDToTypeID;
  var ref = new ActionReference();
  ref.putProperty(s2t("property"), s2t(property));
  ref.putEnumerated(s2t("document"), s2t("ordinal"), s2t("targetEnum"));
  var d = new ActionDescriptor();
  d.putReference(s2t("null"), ref);
  d.putObject(s2t("to"), s2t(property), desc);
  executeAction(s2t("set"), d, DialogModes.NO);
}

/* 缩放到指定范围并居中：使用文档 zoom / center 属性（Action Manager） */
function taZoomToBounds(left, top, right, bottom, margin) {
  var s2t = stringIDToTypeID;
  var w = right - left;
  var h = bottom - top;
  if (w <= 0 || h <= 0) return false;
  var x = left + w / 2;
  var y = top + h / 2;

  var ref = new ActionReference();
  ref.putProperty(s2t("property"), s2t("viewInfo"));
  ref.putEnumerated(s2t("document"), s2t("ordinal"), s2t("targetEnum"));
  var globalBounds = executeActionGet(ref).getObjectValue(s2t("viewInfo")).getObjectValue(s2t("activeView")).getObjectValue(s2t("globalBounds"));
  var docW = globalBounds.getDouble(s2t("right")) - globalBounds.getDouble(s2t("left"));
  var docH = globalBounds.getDouble(s2t("bottom")) - globalBounds.getDouble(s2t("top"));
  if (docW <= 0 || docH <= 0) return false;

  var k = Math.min(docW / w, docH / h) * (margin || 1);
  var zoomDesc = new ActionDescriptor();
  zoomDesc.putUnitDouble(s2t("zoom"), s2t("percentUnit"), k);
  taSetDocumentProperty("zoom", zoomDesc);

  var centerDesc = new ActionDescriptor();
  centerDesc.putUnitDouble(s2t("horizontal"), s2t("distanceUnit"), x * k);
  centerDesc.putUnitDouble(s2t("vertical"), s2t("distanceUnit"), y * k);
  taSetDocumentProperty("center", centerDesc);
  return true;
}

function TA_focusLayers(idsCsv, left, top, right, bottom) {
  var result = { ok: 0, failed: 0, errors: [] };
  try { app.activeDocument; } catch (eDoc) {
    result.errors.push("没有打开的文档");
    return taJsonStringify(result);
  }
  var ids = String(idsCsv || "").split(",");
  var seen = {};
  var selectedAny = false;
  for (var i = 0; i < ids.length; i++) {
    var idText = taTrim(ids[i]);
    if (!idText || seen[idText]) continue;
    seen[idText] = true;
    try {
      taSelectLayerById(idText, selectedAny);
      selectedAny = true;
      result.ok++;
    } catch (eSelect) {
      result.failed++;
      result.errors.push("图层 ID " + idText + "：" + String(eSelect.message || eSelect));
    }
  }
  var l = parseFloat(left), t = parseFloat(top), r = parseFloat(right), b = parseFloat(bottom);
  if (selectedAny && !isNaN(l) && !isNaN(t) && !isNaN(r) && !isNaN(b) && r > l && b > t) {
    try { taZoomToBounds(l, t, r, b, 0.9); }
    catch (eFocus) { result.errors.push("视图聚焦失败：" + String(eFocus.message || eFocus)); }
  } else if (!result.failed) {
    result.errors.push("没有可聚焦的图层范围");
  }
  return taJsonStringify(result);
}

function taAnchorPosition(anchor) {
  var map = {
    tl: "TOPLEFT", tc: "TOPCENTER", tr: "TOPRIGHT",
    ml: "MIDDLELEFT", mc: "MIDDLECENTER", mr: "MIDDLERIGHT",
    bl: "BOTTOMLEFT", bc: "BOTTOMCENTER", br: "BOTTOMRIGHT"
  };
  var name = map[anchor] || "MIDDLECENTER";
  try { return AnchorPosition[name]; } catch (e) { return AnchorPosition.MIDDLECENTER; }
}

var taImageScaleCtx = null;

function taCorrectImageScale(layer, targetW, targetH, anchor) {
  var w = parseFloat(targetW);
  var h = parseFloat(targetH);
  if ((!w || w <= 0) && (!h || h <= 0)) return;

  // Photoshop rounds transformed layer bounds. Re-read and correct the controlling
  // edge so a one-sided target (for example 50 px wide) lands on that dimension.
  for (var pass = 0; pass < 2; pass++) {
    var b = taLayerBounds(layer);
    var useWidth = !isNaN(w) && w > 0 && (isNaN(h) || h <= 0 || w / b.width <= h / b.height);
    var current = useWidth ? b.width : b.height;
    var target = useWidth ? w : h;
    if (current <= 0 || Math.abs(current - target) < 0.01) return;
    layer.resize(target / current * 100, target / current * 100, taAnchorPosition(anchor));
  }
}

function taImageScaleHistoryRunner() {
  var ctx = taImageScaleCtx;
  if (!ctx) return;
  var doc = ctx.doc;
  var targets = ctx.targets;
  var result = ctx.result;
  for (var k = 0; k < targets.length; k++) {
    var layer = targets[k];
    try {
      var b = taLayerBounds(layer);
      if (b.width <= 0 || b.height <= 0) {
        result.skipped++;
        continue;
      }

      var scale = NaN;
      if (ctx.mode === "percent") {
        scale = parseFloat(ctx.percent);
      } else {
        var w = parseFloat(ctx.targetW);
        var h = parseFloat(ctx.targetH);
        if (!isNaN(w) && w > 0 && !isNaN(h) && h > 0) scale = Math.min(w / b.width, h / b.height) * 100;
        else if (!isNaN(w) && w > 0) scale = w / b.width * 100;
        else if (!isNaN(h) && h > 0) scale = h / b.height * 100;
      }
      if (isNaN(scale) || scale <= 0) {
        result.failed++;
        result.errors.push(layer.name + "：缩放参数无效");
        continue;
      }

      try { doc.activeLayer = layer; } catch (eSel) {}
      try {
        layer.resize(scale, scale, taAnchorPosition(ctx.anchor));
        if (ctx.mode !== "percent") taCorrectImageScale(layer, ctx.targetW, ctx.targetH, ctx.anchor);
      } catch (eResize) {
        if (taIsEmptyBoundsError(eResize)) {
          result.skipped++;
          continue;
        }
        throw eResize;
      }
      result.ok++;
    } catch (eLayer) {
      result.failed++;
      result.errors.push(layer.name + "：" + String(eLayer.message || eLayer));
    }
  }
}

function TA_applyImageScale(idsCsv, mode, targetW, targetH, percent, anchor) {
  var result = { ok: 0, failed: 0, skipped: 0, errors: [], layers: [] };
  var doc;
  try {
    doc = app.activeDocument;
  } catch (eDoc) {
    result.errors.push("没有打开的文档");
    return taJsonStringify(result);
  }
  var originalActive = null;
  try { originalActive = doc.activeLayer; } catch (eA) {}
  var prevDialogs = null;
  try { prevDialogs = app.displayDialogs; app.displayDialogs = DialogModes.NO; } catch (eDialogs) {}

  var idSet = {};
  var ids = String(idsCsv || "").split(",");
  for (var i = 0; i < ids.length; i++) {
    var idText = taTrim(ids[i]);
    if (idText) idSet[idText] = true;
  }

  var targets = [];
  for (var targetId in idSet) {
    if (!idSet.hasOwnProperty(targetId)) continue;
    try { targets.push(taLayerById(doc, Number(targetId))); } catch (eTarget) {
      result.failed++;
      result.errors.push(targetId + "：找不到图层");
    }
  }

  try {
    taImageScaleCtx = {
      doc: doc,
      targets: targets,
      result: result,
      mode: mode,
      targetW: targetW,
      targetH: targetH,
      percent: percent,
      anchor: anchor
    };
    try { doc.suspendHistory("批量调整工具 - 图片", "taImageScaleHistoryRunner()"); }
    catch (eHist) { taImageScaleHistoryRunner(); }
  } finally {
    taImageScaleCtx = null;
    try { app.displayDialogs = prevDialogs; } catch (eDr) {}
    if (originalActive) {
      try { doc.activeLayer = originalActive; } catch (eAr) {}
    }
  }

  for (var s = 0; s < targets.length; s++) {
    try { result.layers.push(taImageSnapshot(doc, targets[s])); } catch (eSnapshot) {}
  }

  return taJsonStringify(result);
}

function taApplyToLayer(layer, o) {
  var item = layer.textItem;

  if (o.textCase === "upper") {
    item.contents = String(item.contents).toUpperCase();
  } else if (o.textCase === "lower") {
    item.contents = String(item.contents).toLowerCase();
  } else if (o.textCase === "title") {
    item.contents = taTitleCase(String(item.contents));
  }

  if (o.font) item.font = o.font;

  if (o.sizeMode === "absolute" && o.size !== "") {
    item.size = parseFloat(o.size);
  } else if (o.sizeMode === "scale" && o.size !== "") {
    item.size = taRound2(taNum(item.size) * (1 + parseFloat(o.size) / 100));
  }

  if (o.colorHex) {
    var rgb = taHexToRgb(o.colorHex);
    if (rgb) {
      var color = new SolidColor();
      color.rgb.red = rgb.r;
      color.rgb.green = rgb.g;
      color.rgb.blue = rgb.b;
      item.color = color;
    }
  }

  if (o.bold === "on") item.fauxBold = true;
  else if (o.bold === "off") item.fauxBold = false;

  if (o.italic === "on") item.fauxItalic = true;
  else if (o.italic === "off") item.fauxItalic = false;

  try {
    if (o.capitalization === "normal") item.capitalization = TextCase.NORMAL;
    else if (o.capitalization === "allcaps") item.capitalization = TextCase.ALLCAPS;
    else if (o.capitalization === "smallcaps") item.capitalization = TextCase.SMALLCAPS;
  } catch (eCaps) {}

  try {
    if (o.baseline === "normal") item.baseline = Baseline.NORMAL;
    else if (o.baseline === "subscript") item.baseline = Baseline.SUBSCRIPT;
    else if (o.baseline === "superscript") item.baseline = Baseline.SUPERSCRIPT;
  } catch (eBase) {}

  if (o.baselineShift !== "") {
    try { item.baselineShift = parseFloat(o.baselineShift); } catch (eShift) {}
  }

  if (o.underline === "on" || o.underline === "off") {
    taTrySet(item, "underline", o.underline === "on"
      ? [taEnum("UnderlineType", "UNDERLINE"), taEnum("Underline", "UNDERLINE"), "underline"]
      : [taEnum("UnderlineType", "UNDERLINEOFF"), taEnum("Underline", "NONE"), "underlineOff"]);
  }

  if (o.strikeThrough === "on" || o.strikeThrough === "off") {
    taTrySet(item, "strikeThrough", o.strikeThrough === "on"
      ? [taEnum("StrikeThroughType", "STRIKEON"), taEnum("StrikeThrough", "STRIKEON"), "strikeThroughOn"]
      : [taEnum("StrikeThroughType", "STRIKEOFF"), taEnum("StrikeThrough", "STRIKEOFF"), "strikeThroughOff"]);
  }

  if (o.antiAlias && o.antiAlias !== "keep") {
    var aaMap = { none: "NONE", sharp: "SHARP", crisp: "CRISP", smooth: "SMOOTH", strong: "STRONG" };
    var aaName = aaMap[o.antiAlias];
    if (aaName) {
      taTrySet(item, "antiAliasMethod", [
        taEnum("AntiAlias", aaName),
        taEnum("AntiAliasMethod", aaName),
        aaName
      ]);
    }
  }

  if (o.kerning && o.kerning !== "keep") {
    var kMap = { metrics: "METRICS", optical: "OPTICAL", manual: "MANUAL" };
    var kName = kMap[o.kerning];
    if (kName) {
      taTrySet(item, "autoKerning", [taEnum("AutoKernType", kName), kName]);
    }
  }

  if (o.tracking !== "") item.tracking = parseFloat(o.tracking);
  if (o.leading !== "") item.leading = parseFloat(o.leading);
  if (o.hScale !== "") item.horizontalScale = parseFloat(o.hScale);
  if (o.vScale !== "") item.verticalScale = parseFloat(o.vScale);
}

var taTextApplyCtx = null;

function taTextApplyHistoryRunner() {
  var ctx = taTextApplyCtx;
  if (!ctx) return;
  var doc = ctx.doc;
  var targets = ctx.targets;
  var result = ctx.result;
  var o = ctx.options;
  for (var k = 0; k < targets.length; k++) {
    var layer = targets[k];
    try {
      var isText = true;
      try { isText = (layer.kind === LayerKind.TEXT); } catch (eKind) {}
      if (!isText) {
        result.failed++;
        result.errors.push(layer.name + "：不是文本图层");
        continue;
      }

      try { doc.activeLayer = layer; } catch (eSel) {}

      taApplyToLayer(layer, o);
      result.ok++;
    } catch (eLayer) {
      result.failed++;
      result.errors.push(layer.name + "：" + String(eLayer.message || eLayer));
    }
  }
}

function TA_apply(idsCsv, font, sizeMode, sizeValue, colorHex, bold, italic, caps, baseline, textCase, tracking, leading, hScale, vScale, underline, strikeThrough, baselineShift, antiAlias, kerning) {
  var result = { ok: 0, failed: 0, errors: [], layers: [] };

  var doc;
  try {
    doc = app.activeDocument;
  } catch (e) {
    result.errors.push("没有打开的文档");
    return taJsonStringify(result);
  }

  var originalActive = null;
  try { originalActive = doc.activeLayer; } catch (eA) {}

  var idSet = {};
  var ids = String(idsCsv).split(",");
  for (var i = 0; i < ids.length; i++) {
    var idText = taTrim(ids[i]);
    if (idText) idSet[idText] = true;
  }

  var targets = [];
  for (var targetId in idSet) {
    if (!idSet.hasOwnProperty(targetId)) continue;
    try { targets.push(taLayerById(doc, Number(targetId))); } catch (eTarget) {
      result.failed++;
      result.errors.push(targetId + "：找不到图层");
    }
  }

  var o = {
    font: font || "",
    sizeMode: sizeMode || "none",
    size: sizeValue == null ? "" : String(sizeValue),
    colorHex: colorHex || "",
    bold: bold || "keep",
    italic: italic || "keep",
    capitalization: caps || "keep",
    baseline: baseline || "keep",
    textCase: textCase || "keep",
    tracking: tracking == null ? "" : String(tracking),
    leading: leading == null ? "" : String(leading),
    hScale: hScale == null ? "" : String(hScale),
    vScale: vScale == null ? "" : String(vScale),
    underline: underline || "keep",
    strikeThrough: strikeThrough || "keep",
    baselineShift: baselineShift == null ? "" : String(baselineShift),
    antiAlias: antiAlias || "keep",
    kerning: kerning || "keep"
  };

  var prevDialogs = null;
  try {
    prevDialogs = app.displayDialogs;
    app.displayDialogs = DialogModes.NO;
  } catch (eD) {}

  try {
    taTextApplyCtx = { doc: doc, targets: targets, result: result, options: o };
    try { doc.suspendHistory("批量调整工具 - 文本", "taTextApplyHistoryRunner()"); }
    catch (eHist) { taTextApplyHistoryRunner(); }
  } finally {
    taTextApplyCtx = null;
    try { app.displayDialogs = prevDialogs; } catch (eDr) {}
    if (originalActive) {
      try { doc.activeLayer = originalActive; } catch (eAr) {}
    }
  }

  for (var s = 0; s < targets.length; s++) {
    try { result.layers.push(taSnapshot(targets[s])); } catch (eSnapshot) {}
  }

  return taJsonStringify(result);
}
