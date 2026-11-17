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

  /**
   * Flatten StiPivotTableHelper.getViewerData() result into row objects.
   * cells[r][c].text; headerHeight × headerWidth = corner; amounts in the rest.
   */
  function parsePivotViewerData(viewerData) {
    if (!viewerData || typeof viewerData !== "object") return null;
    var cells = viewerData.cells;
    if (!Array.isArray(cells) || cells.length < 1) return null;
    var headerHeight = Number(viewerData.headerHeight) || 0;
    var headerWidth = Number(viewerData.headerWidth) || 0;
    if (headerHeight < 0) headerHeight = 0;
    if (headerWidth < 0) headerWidth = 0;
    if (headerHeight >= cells.length) return null;

    var colCount = 0;
    for (var r0 = 0; r0 < cells.length; r0++) {
      if (Array.isArray(cells[r0]) && cells[r0].length > colCount)
        colCount = cells[r0].length;
    }
    if (colCount < 1) return null;

    // Column names: join header rows for each data column; row-header cols get labels
    var rawNames = [];
    for (var c = 0; c < colCount; c++) {
      if (c < headerWidth) {
        rawNames.push(c === 0 ? "row" : "row_" + c);
        continue;
      }
      var parts = [];
      for (var hr = 0; hr < headerHeight; hr++) {
        var row = cells[hr];
        var t = Array.isArray(row) ? cellText(row[c]) : "";
        t = String(t).replace(/\s+/g, " ").trim();
        if (t && parts.indexOf(t) < 0) parts.push(t);
      }
      var name = parts.join(" / ") || "c" + c;
      rawNames.push(name);
    }

    // Drop chrome labels (Close button etc.)
    var keepIdx = [];
    var filteredNames = [];
    for (var i = 0; i < rawNames.length; i++) {
      if (i >= headerWidth && isChromeLabel(rawNames[i])) continue;
      keepIdx.push(i);
      filteredNames.push(rawNames[i]);
    }
    if (!filteredNames.length) return null;
    var columns = uniqueNames(filteredNames);

    var rows = [];
    for (var r = headerHeight; r < cells.length; r++) {
      var crow = cells[r];
      if (!Array.isArray(crow)) continue;
      var obj = {};
      var any = false;
      var anyAmount = false;
      for (var k = 0; k < keepIdx.length; k++) {
        var ci = keepIdx[k];
        var val = cellText(crow[ci]);
        val = String(val).replace(/\s+/g, " ").trim();
        obj[columns[k]] = val;
        if (val) any = true;
        if (ci >= headerWidth && val && /[\d]/.test(val)) anyAmount = true;
      }
      // skip empty / spacer rows
      if (!any) continue;
      // keep total rows and data rows
      rows.push(obj);
      if (!anyAmount && headerWidth > 0) {
        // still keep — row headers alone can be useful; amounts may be blank for subheads
      }
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

  var api = {
    decodeExportData: decodeExportData,
    parseExportJson: parseExportJson,
    parsePivotViewerData: parsePivotViewerData,
    isChromeLabel: isChromeLabel,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.dashExportJson = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
