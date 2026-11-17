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
      lower === "cancel" ||
      lower === "отмена" ||
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
    return String(v == null ? "" : v)
      .replace(/&nbsp;/gi, " ")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
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
    if (headerWidth > colCount) headerWidth = colCount;
    if (headerHeight > rowCount) headerHeight = rowCount;

    function at(col, row) {
      var column = cells[col];
      if (!Array.isArray(column)) return "";
      return normLabel(cellText(column[row]));
    }

    // Reported headerHeight sometimes swallows data rows, leaving only Total/Итого.
    // First visual row with 2+ numbers is the real body start.
    var dataStart = headerHeight;
    for (var rr = 0; rr < rowCount; rr++) {
      var nums = 0;
      for (var cc = 0; cc < colCount; cc++) {
        var cell = at(cc, rr);
        if (!cell) continue;
        if (looksNumericLabel(cell) || (/\d/.test(cell) && /%/.test(cell)))
          nums++;
      }
      if (nums >= 2) {
        dataStart = rr;
        break;
      }
    }
    if (dataStart > 0 && dataStart < headerHeight) headerHeight = dataStart;
    if (headerHeight >= rowCount && dataStart > 0 && dataStart < rowCount)
      headerHeight = dataStart;

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

  var MAP_KEY_RU = {
    "BY-BR": "Брестская",
    "BY-HO": "Гомельская",
    "BY-HR": "Гродненская",
    "BY-HM": "Минск",
    "BY-MI": "Минская",
    "BY-MA": "Могилёвская",
    "BY-VI": "Витебская",
    BrestskayaVoblasts: "Брестская",
    BrestskaiaVoblasts: "Брестская",
    Brestskaya: "Брестская",
    Brestskaia: "Брестская",
    GomelskayaVoblasts: "Гомельская",
    GrodnenskayaVoblasts: "Гродненская",
    MinskayaVoblasts: "Минская",
    MogilevskayaVoblasts: "Могилёвская",
    VitebskayaVoblasts: "Витебская",
    Minsk: "Минск",
    Brest: "Брестская",
  };

  function mapKeyToRu(name) {
    var t = normLabel(name);
    if (!t) return t;
    if (MAP_KEY_RU[t]) return MAP_KEY_RU[t];
    var compact = t.replace(/\s+/g, "");
    if (MAP_KEY_RU[compact]) return MAP_KEY_RU[compact];
    var low = compact.toLowerCase();
    if (low.indexOf("minskaya") >= 0 || low.indexOf("minskaia") >= 0) return "Минская";
    if (low.indexOf("brest") >= 0) return "Брестская";
    if (low.indexOf("gomel") >= 0 || low.indexOf("homel") >= 0) return "Гомельская";
    if (low.indexOf("grodn") >= 0 || low.indexOf("hrodn") >= 0) return "Гродненская";
    if (low.indexOf("mogil") >= 0 || low.indexOf("mahile") >= 0) return "Могилёвская";
    if (low.indexOf("viteb") >= 0 || low.indexOf("vicieb") >= 0) return "Витебская";
    if (low === "minsk") return "Минск";
    return t;
  }

  /** SVG path: elementargument + elementvalue="7 099,31 руб. 31,0 %" */
  function regionFromAttrs(argument, valueText) {
    var name = mapKeyToRu(argument);
    if (!name) return null;
    var decoded = normLabel(valueText);
    var percent = takePercent(decoded);
    var amount = takeMoney(decoded);
    if (!percent && !amount && !decoded) {
      return { name: name, amount: null, percent: null, value: null };
    }
    return {
      name: name,
      amount: amount,
      percent: percent,
      value: amount || percent || decoded,
    };
  }

  function takeMoney(text) {
    var m = String(text).match(
      /-?\d{1,3}(?:\s\d{3})+(?:[.,]\d+)?(?:\s*руб\.?)?|-?\d+[.,]\d+\s*руб\.?/i
    );
    return m ? normLabel(m[0]) : null;
  }

  function takePercent(text) {
    var m = String(text).match(/\d{1,3}(?:[.,]\d+)?\s*%/);
    return m ? normLabel(m[0]) : null;
  }

  /**
   * One painted label often is a single string:
   * "Брестская 7 090,57 руб. 31,0%"
   */
  function regionFromBlob(line) {
    var raw = normLabel(line);
    if (!raw) return null;
    var percent = takePercent(raw);
    var amount = takeMoney(raw);
    var name = raw;
    if (percent) name = name.replace(percent, " ");
    if (amount) name = name.replace(amount, " ");
    name = mapKeyToRu(normLabel(name).replace(/руб\.?/gi, ""));
    if (!name || !isRegionName(name) && !MAP_KEY_RU[normLabel(line).split(" ")[0]]) {
      if (!(percent || amount) || !name) return null;
    }
    if (!isRegionName(name) && !/[А-Яа-яЁё]/.test(name)) return null;
    return {
      name: name,
      amount: amount,
      percent: percent,
      value: amount || percent,
    };
  }

  /**
   * Map overlay texts in paint order: Name, "7 090,57 руб.", "31,0%", next name...
   * Also a single combined line per region.
   */
  function isTotalWord(s) {
    var t = normLabel(s).toLowerCase();
    return t === "итог" || t === "итого" || t === "total" || t === "всего";
  }

  function isZeroNum(s) {
    if (!(looksNumericLabel(s) || isPercentLabel(s))) return false;
    var t = normLabel(s)
      .replace(/\s/g, "")
      .replace(/%/g, "")
      .replace(/руб\.?/gi, "")
      .replace(",", ".");
    return /^0+(\.0+)?$/.test(t);
  }

  function expandCells(row) {
    var out = [];
    if (!Array.isArray(row)) return out;
    for (var i = 0; i < row.length; i++) {
      var cell = row[i];
      var text = "";
      var span = 1;
      if (cell != null && typeof cell === "object" && !Array.isArray(cell)) {
        text = cell.text != null ? cell.text : cell.value != null ? cell.value : "";
        span = Number(cell.colspan || cell.colSpan || 1);
      } else {
        text = cell == null ? "" : String(cell);
      }
      if (!isFinite(span) || span < 1) span = 1;
      if (span > 32) span = 32;
      var label = normLabel(text);
      for (var s = 0; s < span; s++) out.push(label);
    }
    return out;
  }

  function countNums(cells) {
    var n = 0;
    for (var i = 0; i < cells.length; i++) {
      if (looksNumericLabel(cells[i]) || isPercentLabel(cells[i])) n++;
    }
    return n;
  }

  function chunkNumericRows(rows) {
    var n = 0;
    for (var i = 0; i < (rows || []).length; i++) {
      if (countNums(expandCells(rows[i])) >= 1) n++;
    }
    return n;
  }

  function looksLikePaymentHeader(name) {
    var t = normLabel(name);
    if (!t || t.length < 8) return false;
    if (/факт|план|выполнен|бюджет|наименование|регион|имнс|управлен|отдел/i.test(t))
      return false;
    return /налог|акциз|ндс|дивиденд|поступлен/i.test(t);
  }

  /**
   * Painted Stimulsoft pivot: header rows (colspan groups) + body.
   * Close/Cancel/toolbar cells are dropped. Amounts stay inside one cell.
   */
  function parseHtmlGrid(rows) {
    if (!Array.isArray(rows) || rows.length < 2) return null;
    var expanded = [];
    for (var i = 0; i < rows.length; i++) {
      var exp = expandCells(rows[i]).map(function (t) {
        return isChromeLabel(t) ? "" : t;
      });
      if (!exp.length) continue;
      var onlyChrome = true;
      for (var e = 0; e < exp.length; e++) {
        if (exp[e]) {
          onlyChrome = false;
          break;
        }
      }
      if (onlyChrome) continue;
      expanded.push(exp);
    }
    if (expanded.length < 2) return null;
    var headerEnd = 0;
    for (; headerEnd < expanded.length; headerEnd++) {
      if (countNums(expanded[headerEnd]) >= 1) break;
    }
    if (headerEnd === 0 || headerEnd >= expanded.length) return null;
    // Payment-name-only rows before numbers come from a separate label table — drop them.
    while (headerEnd > 1) {
      var prev = expanded[headerEnd - 1] || [];
      var nonEmpty = 0;
      var paymentish = 0;
      for (var p = 0; p < prev.length; p++) {
        if (!prev[p]) continue;
        nonEmpty++;
        if (looksLikePaymentHeader(prev[p])) paymentish++;
      }
      if (nonEmpty > 0 && paymentish === nonEmpty) {
        expanded.splice(headerEnd - 1, 1);
        headerEnd--;
        continue;
      }
      break;
    }
    if (headerEnd < 1 || headerEnd >= expanded.length) return null;
    var width = 0;
    for (var w = 0; w < expanded.length; w++) {
      if (expanded[w].length > width) width = expanded[w].length;
    }
    var names = [];
    for (var c = 0; c < width; c++) {
      var parts = [];
      for (var hr = 0; hr < headerEnd; hr++) {
        var t = expanded[hr][c] || "";
        if (!t || isChromeLabel(t) || looksNumericLabel(t) || looksLikePaymentHeader(t))
          continue;
        if (parts.indexOf(t) < 0) parts.push(t);
      }
      names.push(parts.join(" / ") || "c" + c);
    }
    var keep = [];
    var keptNames = [];
    for (var k = 0; k < names.length; k++) {
      if (!names[k] || isChromeLabel(names[k]) || looksLikePaymentHeader(names[k]))
        continue;
      keep.push(k);
      keptNames.push(names[k]);
    }
    if (!keptNames.length) return null;
    var columns = uniqueNames(keptNames);
    var outRows = [];
    for (var r = headerEnd; r < expanded.length; r++) {
      var obj = {};
      var any = false;
      for (var j = 0; j < keep.length; j++) {
        var val = expanded[r][keep[j]] || "";
        obj[columns[j]] = val;
        if (val) any = true;
      }
      if (any) outRows.push(obj);
    }
    if (!outRows.length) return null;
    return {
      columns: columns,
      rows: outRows,
      row_count: outRows.length,
      capture: "html_grid",
    };
  }

  /**
   * Stimulsoft paints header / body / footer as separate <table>s.
   * Blind vertical concat turns payment rows into column names.
   * Keep header-like chunks (no numbers) above the best body chunk only.
   */
  function joinPivotHtmlChunks(chunks) {
    if (!Array.isArray(chunks) || !chunks.length) return null;
    var headers = [];
    var bodies = [];
    for (var i = 0; i < chunks.length; i++) {
      var ch = chunks[i];
      if (!ch || !ch.length) continue;
      if (chunkNumericRows(ch) < 1) headers.push(ch);
      else bodies.push(ch);
    }
    var best = null;
    var bestScore = -1;
    function consider(rows) {
      var parsed = parseHtmlGrid(rows);
      if (!parsed || !parsed.row_count) return;
      var sc = pivotDataScore(parsed);
      // Prefer real budget headers over smashed payment-name columns
      for (var c = 0; c < (parsed.columns || []).length; c++) {
        if (looksLikePaymentHeader(parsed.columns[c])) sc -= 50;
      }
      if (sc > bestScore) {
        best = parsed;
        bestScore = sc;
      }
    }
    for (var b = 0; b < bodies.length; b++) {
      consider(bodies[b]);
      for (var h = 0; h < headers.length; h++) {
        consider(headers[h].concat(bodies[b]));
      }
      if (headers.length > 1) {
        var allH = [];
        for (var hh = 0; hh < headers.length; hh++) allH = allH.concat(headers[hh]);
        // Only title/header tables that are wide enough — skip label-only skinny tables
        var wideH = headers.filter(function (hdr) {
          var max = 0;
          for (var r = 0; r < hdr.length; r++) {
            var w = expandCells(hdr[r]).filter(function (t) {
              return t && !isChromeLabel(t);
            }).length;
            if (w > max) max = w;
          }
          return max >= 2;
        });
        if (wideH.length) {
          var mergedH = [];
          for (var m = 0; m < wideH.length; m++) mergedH = mergedH.concat(wideH[m]);
          consider(mergedH.concat(bodies[b]));
        }
      }
    }
    if (!bodies.length) consider([].concat.apply([], chunks));
    return bestScore > 0 ? best : null;
  }

  /** Non-zero painted numbers. Total/Итог with 0,0 scores 0. */
  function pivotDataScore(parsed) {
    if (!parsed || !Array.isArray(parsed.rows)) return 0;
    var score = 0;
    for (var i = 0; i < parsed.rows.length; i++) {
      var row = parsed.rows[i];
      if (!row || typeof row !== "object") continue;
      var nonzero = 0;
      var label = false;
      var keys = Object.keys(row);
      for (var k = 0; k < keys.length; k++) {
        var v = row[keys[k]];
        if (looksNumericLabel(v) || isPercentLabel(v)) {
          if (!isZeroNum(v)) nonzero++;
        } else if (v && !isTotalWord(v) && !isChromeLabel(v)) {
          label = true;
        }
      }
      if (nonzero > 0) score += 10 + nonzero;
      else if (label) score += 1;
    }
    return score;
  }

  function pickPivotSource(list) {
    var rank = {
      pivot_viewer: 3,
      data_cache: 2,
      export_json: 2,
      html_grid: 1,
    };
    var best = null;
    var bestScore = -1;
    var bestRank = -1;
    (list || []).forEach(function (p) {
      if (!p || !p.row_count) return;
      var sc = pivotDataScore(p);
      var rk = rank[p.capture] || 0;
      if (!best || sc > bestScore || (sc === bestScore && rk > bestRank)) {
        best = p;
        bestScore = sc;
        bestRank = rk;
      }
    });
    return best;
  }

  /**
   * Primary list defines membership/order. Secondary fills empty amount/percent.
   * allowNew:false — after map drill, do not invent oblasts missing on the painted SVG.
   */
  function mergeRegionLists(primary, secondary, opts) {
    opts = opts || {};
    var allowNew = opts.allowNew !== false;
    var by = {};
    var order = [];
    function take(r, overwrite, canAdd) {
      if (!r || !r.name) return;
      var name = mapKeyToRu(r.name);
      if (!name) return;
      if (!by[name]) {
        if (!canAdd) return;
        by[name] = { name: name, amount: null, percent: null, value: null };
        order.push(name);
      }
      var dst = by[name];
      if (r.amount && (overwrite || !dst.amount)) dst.amount = r.amount;
      if (r.percent && (overwrite || !dst.percent)) dst.percent = r.percent;
      if (r.value && (overwrite || !dst.value)) dst.value = r.value;
      if (!dst.value) dst.value = dst.amount || dst.percent || null;
    }
    (primary || []).forEach(function (r) {
      take(r, true, true);
    });
    (secondary || []).forEach(function (r) {
      take(r, false, allowNew);
    });
    return order.map(function (n) {
      return by[n];
    });
  }

  function pairRegionLabels(lines) {
    var regions = [];
    var cur = null;
    function flush() {
      if (cur && cur.name) regions.push(cur);
      cur = null;
    }
    (lines || []).forEach(function (line) {
      var blob = regionFromBlob(line);
      if (blob && blob.amount && blob.percent) {
        flush();
        regions.push(blob);
        return;
      }
      var t = mapKeyToRu(normLabel(line));
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
    parseHtmlGrid: parseHtmlGrid,
    joinPivotHtmlChunks: joinPivotHtmlChunks,
    pivotDataScore: pivotDataScore,
    pickPivotSource: pickPivotSource,
    mergeRegionLists: mergeRegionLists,
    pairRegionLabels: pairRegionLabels,
    mapKeyToRu: mapKeyToRu,
    regionFromBlob: regionFromBlob,
    regionFromAttrs: regionFromAttrs,
    isChromeLabel: isChromeLabel,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.dashExportJson = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
