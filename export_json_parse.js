/**
 * Pure helpers: Stimulsoft Table element JSON export → {columns, rows, ...}.
 * Used by dash_debug.js (browser) and tests/test_export_json_parse.js (node).
 * Official path: StiDashboardExportTools.exportAsync(cb, table, StiExportFormat.Json)
 */
(function (root) {
  "use strict";

  function decodeExportData(data) {
    if (data == null) return null;
    if (typeof data === "string") return data;
    try {
      if (typeof TextDecoder !== "undefined") {
        if (data instanceof ArrayBuffer) {
          return new TextDecoder("utf-8").decode(new Uint8Array(data));
        }
        if (
          data.buffer instanceof ArrayBuffer &&
          typeof data.byteLength === "number"
        ) {
          return new TextDecoder("utf-8").decode(
            data instanceof Uint8Array
              ? data
              : new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength)
          );
        }
      }
    } catch (e) {}
    try {
      if (typeof data === "object" && typeof data.length === "number") {
        var arr = [];
        for (var i = 0; i < data.length; i++) arr.push(data[i]);
        if (typeof TextDecoder !== "undefined") {
          return new TextDecoder("utf-8").decode(new Uint8Array(arr));
        }
        return String.fromCharCode.apply(null, arr);
      }
    } catch (e2) {}
    try {
      return String(data);
    } catch (e3) {
      return null;
    }
  }

  function uniqueNames(names) {
    var seen = {};
    var out = [];
    for (var i = 0; i < names.length; i++) {
      var base = String(names[i] == null ? "" : names[i]).replace(/\s+/g, " ").trim() ||
        "c" + i;
      var name = base;
      var n = 2;
      while (seen[name]) {
        name = base + "_" + n;
        n++;
      }
      seen[name] = true;
      out.push(name);
    }
    return out;
  }

  function rowsFromArray(list) {
    if (!Array.isArray(list) || list.length < 1) return null;
    // array of objects
    if (list[0] != null && typeof list[0] === "object" && !Array.isArray(list[0])) {
      var keyOrder = [];
      var seen = {};
      for (var r = 0; r < list.length; r++) {
        var row = list[r];
        if (!row || typeof row !== "object") continue;
        Object.keys(row).forEach(function (k) {
          if (!seen[k]) {
            seen[k] = true;
            keyOrder.push(k);
          }
        });
      }
      if (!keyOrder.length) return null;
      var columns = uniqueNames(keyOrder);
      var rows = [];
      for (var i = 0; i < list.length; i++) {
        var src = list[i];
        if (!src || typeof src !== "object") continue;
        var obj = {};
        var any = false;
        for (var c = 0; c < keyOrder.length; c++) {
          var k = keyOrder[c];
          var v = src[k];
          if (v === undefined) v = null;
          obj[columns[c]] = v;
          if (v !== null && v !== undefined && v !== "") any = true;
        }
        if (any) rows.push(obj);
      }
      if (!rows.length) return null;
      return { columns: columns, rows: rows, row_count: rows.length };
    }
    // array of arrays: first row = headers
    if (Array.isArray(list[0]) && list.length > 1) {
      var headers = list[0].map(function (h, idx) {
        if (h == null) return "c" + idx;
        if (typeof h === "object")
          return h.labelCorrect || h.label || h.name || h.key || "c" + idx;
        return String(h);
      });
      var cols = uniqueNames(headers);
      var body = [];
      for (var j = 1; j < list.length; j++) {
        var cells = list[j];
        if (!Array.isArray(cells)) continue;
        var o = {};
        var has = false;
        for (var x = 0; x < cols.length; x++) {
          var cell = cells[x];
          var val =
            cell != null && typeof cell === "object" && "value" in cell
              ? cell.value
              : cell;
          o[cols[x]] = val === undefined ? null : val;
          if (val !== null && val !== undefined && val !== "") has = true;
        }
        if (has) body.push(o);
      }
      if (!body.length) return null;
      return { columns: cols, rows: body, row_count: body.length };
    }
    return null;
  }

  function findRowArray(parsed) {
    if (parsed == null) return null;
    if (Array.isArray(parsed)) return parsed;
    if (typeof parsed !== "object") return null;
    // Prefer first array-of-objects / array-of-arrays value
    var keys = Object.keys(parsed);
    for (var i = 0; i < keys.length; i++) {
      var v = parsed[keys[i]];
      if (Array.isArray(v) && v.length > 0) return v;
    }
    // nested single wrapper
    for (var j = 0; j < keys.length; j++) {
      var nested = parsed[keys[j]];
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        var found = findRowArray(nested);
        if (found) return found;
      }
    }
    return null;
  }

  function parseExportJson(raw) {
    var text = typeof raw === "string" ? raw : decodeExportData(raw);
    if (text == null || text === "") return null;
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return null;
    }
    var list = findRowArray(parsed);
    var shaped = rowsFromArray(list);
    if (!shaped) return null;
    shaped.capture = "export_json";
    return shaped;
  }

  /** Stimulsoft element chrome labels that must never become data columns. */
  function isChromeLabel(name) {
    if (name == null) return true;
    var s = String(name).replace(/\s+/g, " ").trim();
    if (!s) return true;
    var lower = s.toLowerCase();
    return (
      lower === "close" ||
      lower === "закрыть" ||
      lower === "save" ||
      lower === "сохранить" ||
      lower === "more" ||
      lower === "…" ||
      lower === "..." ||
      lower === "fullscreen" ||
      lower === "full screen"
    );
  }

  function cellText(cell) {
    if (cell == null) return "";
    if (typeof cell !== "object") return String(cell);
    if (cell.text != null && cell.text !== "") return String(cell.text);
    if (cell.value != null && cell.value !== "") return String(cell.value);
    return "";
  }

  function normLabel(v) {
    return String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  }

  function looksNumericLabel(v) {
    var s = normLabel(v).replace(/\s/g, "").replace("%", "").replace("руб.", "").replace("руб", "");
    s = s.replace(",", ".");
    return /^-?\d+(\.\d+)?$/.test(s);
  }

  /**
   * Flatten StiPivotTableHelper.getViewerData().
   * Viewer paints cells[columnIndex][rowIndex] (stimulsoft.viewer.js:
   *   c = e.cells[p][A] with p < headerWidth, A >= headerHeight).
   * headerWidth = row-header columns, headerHeight = column-header rows.
   */
  function parsePivotViewerData(viewerData) {
    if (!viewerData || typeof viewerData !== "object") return null;
    var cells = viewerData.cells;
    if (!Array.isArray(cells) || cells.length < 1) return null;
    var headerHeight = Number(viewerData.headerHeight);
    var headerWidth = Number(viewerData.headerWidth);
    if (!isFinite(headerHeight) || headerHeight < 0) headerHeight = 0;
    if (!isFinite(headerWidth) || headerWidth < 0) headerWidth = 0;

    var colCount = cells.length;
    var rowCount = 0;
    for (var c0 = 0; c0 < colCount; c0++) {
      if (Array.isArray(cells[c0]) && cells[c0].length > rowCount)
        rowCount = cells[c0].length;
    }
    if (rowCount < 1) return null;
    if (headerHeight >= rowCount) headerHeight = 0;
    if (headerWidth > colCount) headerWidth = colCount;

    function at(col, row) {
      var column = cells[col];
      if (!Array.isArray(column)) return "";
      return normLabel(cellText(column[row]));
    }

    var rawNames = [];
    for (var c = 0; c < colCount; c++) {
      if (isChromeLabel(at(c, 0)) && headerHeight <= 1) {
        rawNames.push("");
        continue;
      }
      var parts = [];
      var limit = headerHeight > 0 ? headerHeight : 1;
      for (var hr = 0; hr < limit; hr++) {
        var t = at(c, hr);
        if (!t || isChromeLabel(t) || looksNumericLabel(t)) continue;
        if (parts.indexOf(t) < 0) parts.push(t);
      }
      if (!parts.length) {
        // row-header columns still need a name from their header cell
        var fallback = at(c, 0) || (c < headerWidth ? "row" : "c" + c);
        if (!isChromeLabel(fallback)) parts.push(fallback);
      }
      rawNames.push(parts.join(" / ") || "c" + c);
    }

    var keepIdx = [];
    var filteredNames = [];
    for (var i = 0; i < rawNames.length; i++) {
      if (!rawNames[i] || isChromeLabel(rawNames[i])) continue;
      keepIdx.push(i);
      filteredNames.push(rawNames[i]);
    }
    if (!filteredNames.length) return null;
    var columns = uniqueNames(filteredNames);

    var rows = [];
    for (var r = headerHeight; r < rowCount; r++) {
      var obj = {};
      var any = false;
      for (var k = 0; k < keepIdx.length; k++) {
        var val = at(keepIdx[k], r);
        obj[columns[k]] = val;
        if (val) any = true;
      }
      if (any) rows.push(obj);
    }
    if (!rows.length) return null;
    return {
      columns: columns,
      rows: rows,
      row_count: rows.length,
      capture: "pivot_viewer",
      header_height: headerHeight,
      header_width: headerWidth,
    };
  }

  function isPercentLabel(s) {
    return /^\d{1,3}([.,]\d+)?\s*%$/.test(normLabel(s));
  }

  function isMoneyLabel(s) {
    var t = normLabel(s);
    return /руб/i.test(t) || /^-?\d{1,3}(\s\d{3})+([.,]\d+)?$/.test(t);
  }

  function isRegionName(s) {
    var t = normLabel(s);
    if (!t || t.length > 40) return false;
    if (isPercentLabel(t) || isMoneyLabel(t) || looksNumericLabel(t)) return false;
    if (isChromeLabel(t)) return false;
    return /[A-Za-zА-Яа-яЁё]/.test(t);
  }

  /**
   * Map overlay texts in paint order: Name, "7 090,57 руб.", "31,0%", next name...
   */
  function pairRegionLabels(lines) {
    var regions = [];
    var cur = null;
    function flush() {
      if (cur && cur.name) regions.push(cur);
      cur = null;
    }
    (lines || []).forEach(function (line) {
      var t = normLabel(line);
      if (!t) return;
      if (isRegionName(t)) {
        flush();
        cur = { name: t, amount: null, percent: null, value: null };
        return;
      }
      if (!cur) return;
      if (isPercentLabel(t) && !cur.percent) {
        cur.percent = t;
        return;
      }
      if ((isMoneyLabel(t) || looksNumericLabel(t)) && !cur.amount) {
        cur.amount = t;
        cur.value = t;
      }
    });
    flush();
    return regions;
  }

  var api = {
    decodeExportData: decodeExportData,
    parseExportJson: parseExportJson,
    parsePivotViewerData: parsePivotViewerData,
    pairRegionLabels: pairRegionLabels,
    isChromeLabel: isChromeLabel,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.dashExportJson = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
