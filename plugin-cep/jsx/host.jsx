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

function taSnapshot(layer) {
  var s = {
    id: layer.id,
    name: layer.name,
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

/* ================= 供面板调用的接口 ================= */

function TA_scan() {
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
    raw = taCollectTextLayers(doc, []);
  } catch (eLayers) {
    return taJsonStringify({ docName: docName, layers: [], error: "读取图层失败：" + String(eLayers.message || eLayers) });
  }

  var layers = [];
  for (var i = 0; i < raw.length; i++) {
    try { layers.push(taSnapshot(raw[i])); } catch (eSnap) {}
  }

  return taJsonStringify({ docName: docName, layers: layers, error: null });
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

function TA_apply(idsCsv, font, sizeMode, sizeValue, colorHex, bold, italic, caps, baseline, textCase, tracking, leading, hScale, vScale, underline, strikeThrough, baselineShift, antiAlias, kerning) {
  var result = { ok: 0, failed: 0, errors: [] };

  var doc;
  try {
    doc = app.activeDocument;
  } catch (e) {
    result.errors.push("没有打开的文档");
    return taJsonStringify(result);
  }

  var idSet = {};
  var ids = String(idsCsv).split(",");
  for (var i = 0; i < ids.length; i++) {
    var idText = taTrim(ids[i]);
    if (idText) idSet[idText] = true;
  }

  var all = taCollectTextLayers(doc, []);
  var targets = [];
  for (var j = 0; j < all.length; j++) {
    if (idSet[String(all[j].id)]) targets.push(all[j]);
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

  var originalActive = null;
  try { originalActive = doc.activeLayer; } catch (eA) {}

  try {
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
  } finally {
    try { app.displayDialogs = prevDialogs; } catch (eDr) {}
    if (originalActive) {
      try { doc.activeLayer = originalActive; } catch (eAr) {}
    }
  }

  return taJsonStringify(result);
}
