/* Viewer llm-pack debug panel (ASCII-only for Windows encoding safety) */
(function () {
  "use strict";

  var ACTIONS = [
    "InitVars",
    "Variables",
    "Sorting",
    "DrillDown",
    "Collapsing",
    "DashboardFiltering",
    "DashboardSorting",
    "DashboardResetAllFilters",
    "DashboardElementDrillDown",
    "DashboardElementDrillUp",
    "DashboardDrillDown",
    "DashboardButtonElementApplyEvents",
  ];

  var PARAM_BAGS = [
    "variables",
    "filteringParameters",
    "sortingParameters",
    "collapsingParameters",
    "drillDownParameters",
    "dashboardElementDrillDownParameters",
  ];

  var llmPackTimer = null;

  function safeClone(value) {
    if (value == null) return value;
    if (typeof value !== "object") return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (e) {
      try {
        return String(value);
      } catch (e2) {
        return "[unserializable]";
      }
    }
  }

  function collectionLength(list) {
    if (list == null) return 0;
    if (typeof list.length === "number") return list.length;
    if (typeof list.Count === "number") return list.Count;
    if (typeof list.count === "number") return list.count;
    return 0;
  }

  function collectionItem(list, index) {
    if (list == null) return null;
    if (typeof list.get === "function") {
      try {
        return list.get(index);
      } catch (e) {}
    }
    if (typeof list.getByIndex === "function") {
      try {
        return list.getByIndex(index);
      } catch (e2) {}
    }
    return list[index];
  }

  function cloneFilterRule(item) {
    if (item == null || typeof item !== "object") return item;
    var path =
      item.path != null && item.path !== ""
        ? item.path
        : item.columnName || item.column || item.columnPath || null;
    var condition = item.condition != null ? item.condition : "EqualTo";
    var value =
      item.value !== undefined
        ? item.value
        : item.Value !== undefined
          ? item.Value
          : item.elementArgument !== undefined
            ? item.elementArgument
            : null;
    // Region map: MapEqualTo often has path=null — keep value under path "map"
    if (
      (path == null || path === "") &&
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      path = "map";
    }
    if (
      (condition === "MapEqualTo" || condition === "mapEqualTo") &&
      (path == null || path === "")
    ) {
      path = "map";
    }
    return {
      typeItem: item.typeItem != null ? item.typeItem : "FilterRule",
      key: item.key != null ? item.key : null,
      path: path,
      condition: condition,
      value: value,
      value2: item.value2 !== undefined ? item.value2 : null,
      path2: item.path2 != null ? item.path2 : null,
      isEnabled: item.isEnabled !== undefined ? item.isEnabled : true,
    };
  }

  function cloneFilteringParameters(fp) {
    // Stimulsoft often passes .NET-like dicts; JSON.stringify drops useful fields.
    // Same shape is used for drillDownParameters on DashboardElementDrillDown.
    if (fp == null) return null;
    if (Array.isArray(fp)) {
      return fp.map(function (item) {
        if (item && typeof item === "object" && item.filters) {
          return cloneFilteringParameters(item);
        }
        if (item && typeof item === "object") {
          return {
            name: item.name != null ? item.name : null,
            value: item.value !== undefined ? item.value : null,
            key: item.key != null ? item.key : null,
            path: item.path != null ? item.path : null,
            condition: item.condition != null ? item.condition : null,
          };
        }
        return safeClone(item);
      });
    }
    if (typeof fp !== "object") return fp;
    var out = {};
    var keys = [
      "elementName",
      "elementGroup",
      "filterGuid",
      "isChecked",
      "columnIndex",
      "filters",
      "filterParameters",
    ];
    keys.forEach(function (k) {
      if (fp[k] !== undefined) {
        if (k === "filters") {
          var list = fp[k];
          var arr = [];
          var n = collectionLength(list);
          if (n > 0) {
            for (var i = 0; i < n; i++) {
              arr.push(cloneFilterRule(collectionItem(list, i)));
            }
          } else if (Array.isArray(list)) {
            list.forEach(function (it) {
              arr.push(cloneFilterRule(it));
            });
          }
          out.filters = arr;
        } else if (k === "filterParameters") {
          out[k] = cloneFilteringParameters(fp[k]) || safeClone(fp[k]);
        } else {
          out[k] = fp[k];
        }
      }
    });
    // also copy any plain enumerable extras
    try {
      Object.keys(fp).forEach(function (k) {
        if (!(k in out)) out[k] = safeClone(fp[k]);
      });
    } catch (e) {}
    return out;
  }

  function dumpArgs(args) {
    var out = { __keys: [], __knownActions: ACTIONS };
    if (!args || typeof args !== "object") {
      out.raw = args;
      return out;
    }
    var keys = [];
    try {
      keys = Object.keys(args);
    } catch (e) {
      keys = [];
    }
    out.__keys = keys.slice();
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k === "report") {
        out[k] = "[StiReport]";
        continue;
      }
      if (
        k === "filteringParameters" ||
        k === "drillDownParameters" ||
        k === "dashboardElementDrillDownParameters"
      ) {
        out[k] = cloneFilteringParameters(args[k]);
        continue;
      }
      out[k] = safeClone(args[k]);
    }
    [
      "event",
      "sender",
      "action",
      "preventDefault",
      "async",
      "variables",
      "sortingParameters",
      "collapsingParameters",
      "drillDownParameters",
      "dashboardElementDrillDownParameters",
      "filteringParameters",
      "data",
    ].forEach(function (k) {
      if (!(k in out) && args[k] !== undefined) {
        if (k === "report") out[k] = "[StiReport]";
        else if (
          k === "filteringParameters" ||
          k === "drillDownParameters" ||
          k === "dashboardElementDrillDownParameters"
        )
          out[k] = cloneFilteringParameters(args[k]);
        else out[k] = safeClone(args[k]);
        out.__keys.push(k);
      }
    });
    // normalize button / drill identity for pack consumers
    var fp = out.filteringParameters || {};
    var dp =
      out.drillDownParameters ||
      out.dashboardElementDrillDownParameters ||
      {};
    if (!Array.isArray(dp) && dp.elementName) out.element = dp.elementName;
    if (fp.elementName) out.element = fp.elementName;
    if (fp.isChecked !== undefined) out.button_checked = !!fp.isChecked;
    if (
      out.action === "DashboardButtonElementApplyEvents" ||
      (fp.elementName && String(fp.elementName).indexOf("Button") === 0)
    ) {
      out.button = fp.elementName;
    }
    if (
      out.action &&
      String(out.action).indexOf("DrillDown") >= 0 &&
      String(out.action).indexOf("DrillUp") < 0
    ) {
      out.drill_down = true;
    }
    if (out.action && String(out.action).indexOf("DrillUp") >= 0) {
      out.drill_up = true;
    }
    var filterBags = [];
    if (fp && fp.filters) filterBags.push(fp.filters);
    if (dp && !Array.isArray(dp) && dp.filters) filterBags.push(dp.filters);
    var dashFilters = [];
    filterBags.forEach(function (list) {
      list.forEach(function (f) {
        if (!f) return;
        dashFilters.push({
          path: f.path || f.name || f.key,
          value: f.value,
          condition: f.condition || "EqualTo",
        });
      });
    });
    if (dashFilters.length) out.dashboard_filters = dashFilters;
    return out;
  }

  function isRealFilterKey(name) {
    if (name == null || name === "") return false;
    var s = String(name);
    if (s.indexOf("__") === 0) return false;
    if (/^\d+$/.test(s)) return false;
    // Latin OR Cyrillic column names (region / область / etc.)
    return /^[A-Za-z_\u0400-\u04FF]/.test(s);
  }

  function flattenParams(args) {
    var params = {};
    function put(name, value) {
      if (!isRealFilterKey(name)) return;
      params[String(name)] = value;
    }
    function walk(src) {
      if (src == null) return;
      if (Array.isArray(src)) {
        // only named variables: {name, value} — never index keys 0,1,2 with UI labels
        src.forEach(function (item) {
          if (item && typeof item === "object" && item.name != null) {
            put(item.name, item.value);
          }
        });
        return;
      }
      if (typeof src !== "object") return;
      Object.keys(src).forEach(function (k) {
        var v = src[k];
        if (v && typeof v === "object" && "value" in v && !Array.isArray(v)) {
          put(k, v.value);
        } else if (v && typeof v === "object" && v.name != null && "value" in v) {
          put(v.name, v.value);
        } else if (
          v == null ||
          typeof v === "string" ||
          typeof v === "number" ||
          typeof v === "boolean"
        ) {
          put(k, v);
        } else if (Array.isArray(v)) {
          walk(v);
        }
      });
    }
    function walkDashboardFilters(src, depth) {
      if (src == null || depth > 8) return;
      if (Array.isArray(src)) {
        src.forEach(function (item) {
          walkDashboardFilters(item, depth + 1);
        });
        return;
      }
      if (typeof src !== "object") return;
      var col =
        src.columnName ||
        src.column ||
        src.path ||
        src.field ||
        src.dataColumn;
      // FilterRule.key is often an internal id — prefer path for region name match
      if (col != null && isRealFilterKey(col)) {
        if ("value" in src) put(col, src.value);
        else if ("values" in src) put(col, src.values);
        else if ("text" in src && typeof src.text !== "object") put(col, src.text);
      }
      var n = collectionLength(src);
      if (n > 0 && (src.filters === undefined || depth > 0)) {
        for (var i = 0; i < n; i++) {
          walkDashboardFilters(collectionItem(src, i), depth + 1);
        }
      }
      try {
        Object.keys(src).forEach(function (k) {
          if (k === "report" || k === "elementName" || k === "isChecked") return;
          var v = src[k];
          if (v && typeof v === "object") walkDashboardFilters(v, depth + 1);
        });
      } catch (e) {}
    }
    PARAM_BAGS.forEach(function (bag) {
      walk(args[bag]);
    });
    // also top-level variables map if present
    if (args && args.variables) walk(args.variables);
    // map Apply-Filter + region drill-in (filters live in either bag)
    ["filteringParameters", "drillDownParameters", "dashboardElementDrillDownParameters"].forEach(
      function (bagName) {
        var bag = args && args[bagName];
        if (!bag) return;
        walkDashboardFilters(bag, 0);
        if (!Array.isArray(bag) && bag.filters) walkDashboardFilters(bag.filters, 0);
      }
    );
    return params;
  }

  function ensurePanel() {
    var el = document.getElementById("dash-interaction-debug");
    if (el) return el;
    el = document.createElement("div");
    el.id = "dash-interaction-debug";
    el.style.cssText = [
      "position:fixed",
      "right:8px",
      "bottom:8px",
      "z-index:2147483647",
      "width:min(560px,48vw)",
      "max-height:55vh",
      "display:flex",
      "flex-direction:column",
      "background:#0b1220",
      "color:#d7f5d0",
      "border:1px solid #334155",
      "box-shadow:0 8px 28px rgba(0,0,0,.35)",
      "font:12px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
      "opacity:.96",
    ].join(";");
    var head = document.createElement("div");
    head.style.cssText =
      "display:flex;align-items:center;gap:8px;padding:8px 10px;background:#111827;border-bottom:1px solid #334155;flex-wrap:wrap;";
    head.innerHTML =
      '<strong style="color:#86efac">SVERKA</strong>' +
      '<span id="dash-interaction-action" style="color:#93c5fd"></span>' +
      '<span id="dash-interaction-meta" style="color:#94a3b8"></span>' +
      '<span style="margin-left:auto"></span>' +
      '<button type="button" id="dash-interaction-compare" style="background:#166534;color:#ecfdf5;border:1px solid #22c55e;padding:3px 10px;cursor:pointer;font-weight:700">SVERKA</button>' +
      '<button type="button" id="dash-interaction-json" style="background:#1f2937;color:#e2e8f0;border:1px solid #475569;padding:2px 8px;cursor:pointer">JSON</button>' +
      '<button type="button" id="dash-interaction-clear" style="background:#1f2937;color:#e2e8f0;border:1px solid #475569;padding:2px 8px;cursor:pointer">clear</button>' +
      '<button type="button" id="dash-interaction-hide" style="background:#1f2937;color:#e2e8f0;border:1px solid #475569;padding:2px 8px;cursor:pointer">hide</button>';
    var pre = document.createElement("pre");
    pre.id = "dash-interaction-pre";
    pre.style.cssText =
      "margin:0;padding:10px;overflow:auto;flex:1;white-space:pre-wrap;word-break:break-word;color:#bbf7d0;";
    pre.textContent =
      "Zhmi zelenuyu knopku SVERKA.\n" +
      "Tam: filtry + stroki dlya sravneniya s ekranom.\n" +
      "NE zhmi staryy verify — eto zhurnal, ne dannye.\n" +
      "Ili otkroy: http://127.0.0.1:8040/api/compare";
    el.appendChild(head);
    el.appendChild(pre);
    (document.documentElement || document.body).appendChild(el);
    document.getElementById("dash-interaction-hide").onclick = function () {
      el.style.display = "none";
    };
    document.getElementById("dash-interaction-clear").onclick = function () {
      pre.textContent = "";
      fetch("/api/params", { method: "DELETE" })
        .then(function () {
          return postViewportAndCompare();
        })
        .catch(function () {});
    };
    document.getElementById("dash-interaction-compare").onclick = function () {
      postViewportAndCompare();
    };
    document.getElementById("dash-interaction-json").onclick = function () {
      refreshLlmPack(0);
    };
    return el;
  }

  function showText(text, label) {
    var el = ensurePanel();
    el.style.display = "flex";
    var actionEl = document.getElementById("dash-interaction-action");
    var metaEl = document.getElementById("dash-interaction-meta");
    if (actionEl) actionEl.textContent = label || "SVERKA";
    if (metaEl) metaEl.textContent = "sravni s frontom";
    var pre = document.getElementById("dash-interaction-pre");
    if (pre) pre.textContent = text;
  }

  function showPack(pack, mode) {
    var el = ensurePanel();
    el.style.display = "flex";
    var actionEl = document.getElementById("dash-interaction-action");
    var metaEl = document.getElementById("dash-interaction-meta");
    var inter = pack && pack.interaction;
    var isVerify =
      mode === "verify" ||
      (pack && typeof pack.ok === "boolean" && !pack.results);
    if (actionEl) {
      if (isVerify) {
        actionEl.textContent = "NE DANNYE";
      } else {
        actionEl.textContent =
          (inter && (inter.action || inter.event)) || "JSON";
      }
    }
    if (metaEl) {
      var nFilters = pack && pack.filters ? Object.keys(pack.filters).length : 0;
      var nResults = 0;
      var nRows = 0;
      if (pack && pack.results && typeof pack.results === "object") {
        nResults = Object.keys(pack.results).length;
        Object.keys(pack.results).forEach(function (k) {
          var r = pack.results[k];
          if (r && typeof r.row_count === "number") nRows += r.row_count;
        });
      }
      metaEl.textContent =
        "filters=" + nFilters + " sources=" + nResults + " rows=" + nRows;
    }
    var pre = document.getElementById("dash-interaction-pre");
    if (pre) {
      try {
        if (isVerify) {
          pre.textContent =
            "ETO VERIFY — NE DANNYE DLYA SVERKI.\n" +
            "Zhmi zelenuyu SVERKA ili otkroy /api/compare\n\n" +
            "ok=" +
            (pack && pack.ok) +
            "\nissues=" +
            JSON.stringify((pack && pack.issues) || []);
        } else {
          pre.textContent = JSON.stringify(pack, null, 2);
        }
      } catch (e) {
        pre.textContent = String(pack);
      }
    }
    window.__llmPack = pack;
  }

  function fetchJson(url, onOk) {
    fetch(url, { cache: "no-store" })
      .then(function (r) {
        return r.text().then(function (text) {
          return { ok: r.ok, status: r.status, text: text };
        });
      })
      .then(function (res) {
        var pack;
        try {
          pack = JSON.parse(res.text);
        } catch (e) {
          showPack({
            error: url + " is not JSON",
            http_status: res.status,
            parse_error: String(e && e.message ? e.message : e),
            body_preview: String(res.text || "").slice(0, 400),
          });
          return;
        }
        onOk(pack);
      })
      .catch(function (e) {
        if (window.console && console.error) console.error(e);
        showPack({ error: String(e) });
      });
  }

  function refreshCompare(delayMs) {
    if (llmPackTimer) clearTimeout(llmPackTimer);
    llmPackTimer = setTimeout(function () {
      fetch("/api/compare", { cache: "no-store" })
        .then(function (r) {
          return r.text();
        })
        .then(function (text) {
          showText(text, "SVERKA");
          if (window.console && console.log) console.log("[compare]", text);
        })
        .catch(function (e) {
          showText(String(e), "ERROR");
        });
    }, typeof delayMs === "number" ? delayMs : 0);
  }

  function refreshLlmPack(delayMs) {
    if (llmPackTimer) clearTimeout(llmPackTimer);
    llmPackTimer = setTimeout(function () {
      fetchJson("/api/llm-pack", function (pack) {
        showPack(pack, "pack");
        if (window.console && console.log) console.log("[llm-pack]", pack);
      });
    }, typeof delayMs === "number" ? delayMs : 600);
  }

  var lastInteractionDump = null;

  /* ========== Stimulsoft table model (viewer.js DataGrid.showData) ==========
   * data[0]=headers {labelCorrect,label,key,path,showTotalSummary,...}
   * data[1..]=body {value,text} ; optional last totals row
   * hiddenData merges by row index: header.concat / cells.concat
   * value = cell.value != null ? cell.value : cell.text
   * HTML = 3 tables (header / body-without-header / footer) — fallback only
   * See docs/superpowers/specs/2026-11-17-stimulsoft-table-render.md
   */

  function stiCellValue(cell) {
    if (cell == null) return null;
    if (typeof cell !== "object") return cell;
    // Stimulsoft: prefer value, but "" is useless — fall through to text
    // (amounts often painted only in .text while .value is "")
    if (cell.value !== undefined && cell.value !== null && cell.value !== "")
      return cell.value;
    if (cell.text !== undefined && cell.text !== null && cell.text !== "")
      return cell.text;
    if (cell.value !== undefined && cell.value !== null) return cell.value;
    if (cell.text !== undefined && cell.text !== null) return cell.text;
    if (cell.image !== undefined && cell.image !== null) return cell.image;
    return null;
  }

  function stiCountNumericFields(parsed) {
    if (!parsed || !parsed.rows || !parsed.rows.length) return 0;
    var n = 0;
    var sample = parsed.rows[0];
    Object.keys(sample).forEach(function (k) {
      var v = sample[k];
      if (typeof v === "number") {
        n++;
        return;
      }
      if (v === null || v === undefined || v === "") return;
      var s = String(v).replace(/\s/g, "").replace(",", ".");
      // 1500.5 or 1 500,50-style already stripped spaces
      if (/^-?\d+(\.\d+)?$/.test(s)) n++;
    });
    return n;
  }

  function stiGridScore(parsed) {
    if (!parsed) return -1;
    return (
      (parsed.columns ? parsed.columns.length : 0) * 1000 +
      stiCountNumericFields(parsed) * 5000 +
      (parsed.row_count || 0)
    );
  }

  function stiNormStr(v) {
    if (v === null || v === undefined) return v;
    if (typeof v === "number" || typeof v === "boolean") return v;
    return String(v).replace(/\s+/g, " ").trim();
  }

  function stiUniqueNames(names) {
    var seen = {};
    var out = [];
    for (var i = 0; i < names.length; i++) {
      var base = stiNormStr(names[i]) || "c" + i;
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

  function stiHeaderName(col, index) {
    if (!col || typeof col !== "object") return "c" + index;
    // labelCorrect is what Stimulsoft uses in {row.X} replacements
    return (
      stiNormStr(
        col.labelCorrect ||
          col.label ||
          col.text ||
          col.name ||
          col.column ||
          col.key
      ) || "c" + index
    );
  }

  function stiMergeVisibleHidden(visible, hidden) {
    if (!Array.isArray(visible) || visible.length < 1) {
      return Array.isArray(hidden) && hidden.length ? hidden : null;
    }
    if (!Array.isArray(hidden) || hidden.length < 1) return visible;
    if (!Array.isArray(hidden[0]) || hidden[0].length < 1) return visible;
    var out = [];
    var n = Math.max(visible.length, hidden.length);
    for (var r = 0; r < n; r++) {
      var a = Array.isArray(visible[r]) ? visible[r] : [];
      var b = Array.isArray(hidden[r]) ? hidden[r] : [];
      out.push(a.concat(b));
    }
    return out;
  }

  function stiParseGrid(data, captureTag) {
    if (!Array.isArray(data) || data.length < 1) return null;
    var header = data[0];
    if (!Array.isArray(header) || header.length < 1) return null;

    var hasTotal = false;
    var columnMeta = [];
    var rawNames = [];
    for (var c = 0; c < header.length; c++) {
      var h = header[c] || {};
      if (h.showTotalSummary) hasTotal = true;
      var name = stiHeaderName(h, c);
      rawNames.push(name);
      columnMeta.push({
        name: name,
        key: h.key != null ? h.key : null,
        path: h.path != null ? h.path : null,
        dataType: h.dataType != null ? h.dataType : null,
        hidden: !!h.visibilityTrueAndHidden,
      });
    }
    var columns = stiUniqueNames(rawNames);
    for (var m = 0; m < columnMeta.length; m++) columnMeta[m].name = columns[m];

    var end = hasTotal && data.length > 1 ? data.length - 1 : data.length;
    var rows = [];
    for (var r = 1; r < end; r++) {
      var row = data[r];
      if (!Array.isArray(row)) continue;
      var obj = {};
      var any = false;
      for (var i = 0; i < columns.length; i++) {
        var v = stiNormStr(stiCellValue(row[i]));
        obj[columns[i]] = v;
        if (v !== null && v !== undefined && v !== "") any = true;
      }
      if (any) rows.push(obj);
    }

    var totals = null;
    if (hasTotal && data.length > 1) {
      var trow = data[data.length - 1];
      if (Array.isArray(trow)) {
        totals = {};
        for (var t = 0; t < columns.length; t++) {
          totals[columns[t]] = stiNormStr(stiCellValue(trow[t]));
        }
      }
    }

    return {
      columns: columns,
      column_meta: columnMeta,
      rows: rows,
      row_count: rows.length,
      totals: totals,
      capture: captureTag || "grid",
    };
  }

  function htmlCellText(cell) {
    if (!cell) return "";
    return String(cell.innerText || cell.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function looksLikeDigitHeader(name) {
    var s = String(name || "").replace(/\s/g, "");
    return s.length > 0 && /^[\d.,\-%]+$/.test(s);
  }

  function stiScrapeHtmlFallback(root) {
    // Last resort only. Stimulsoft: header table (1 row) + body table (data only).
    if (!root || !root.getElementsByTagName) return null;
    var tables = root.getElementsByTagName("table");
    var headerNames = null;
    var bodyTable = null;
    var bodyScore = -1;

    for (var t = 0; t < tables.length; t++) {
      var table = tables[t];
      var trs = table.rows;
      if (!trs || trs.length < 1) continue;
      var row0 = trs[0];
      if (!row0 || !row0.cells || row0.cells.length < 2) continue;

      if (trs.length === 1) {
        var names = [];
        var digitish = 0;
        for (var c = 0; c < row0.cells.length; c++) {
          var nm = htmlCellText(row0.cells[c]) || "c" + c;
          names.push(nm);
          if (looksLikeDigitHeader(nm)) digitish++;
        }
        if (digitish * 2 < names.length) headerNames = names;
        continue;
      }

      var sc = trs.length * row0.cells.length;
      if (sc > bodyScore) {
        bodyScore = sc;
        bodyTable = table;
      }
    }
    if (!bodyTable) return null;

    var columns;
    var startRow;
    if (headerNames && headerNames.length) {
      columns = stiUniqueNames(headerNames);
      startRow = 0;
    } else {
      var hc = bodyTable.rows[0].cells;
      var trial = [];
      var d = 0;
      for (var i = 0; i < hc.length; i++) {
        var tn = htmlCellText(hc[i]) || "c" + i;
        trial.push(tn);
        if (looksLikeDigitHeader(tn)) d++;
      }
      if (d * 2 >= trial.length) {
        columns = stiUniqueNames(
          trial.map(function (_x, idx) {
            return "c" + idx;
          })
        );
        startRow = 0;
      } else {
        columns = stiUniqueNames(trial);
        startRow = 1;
      }
    }

    var bodyWidth = bodyTable.rows[0].cells.length;
    if (bodyWidth > columns.length) {
      for (var p = columns.length; p < bodyWidth; p++) columns.push("c" + p);
      columns = stiUniqueNames(columns);
    }

    var rows = [];
    for (var r = startRow; r < bodyTable.rows.length; r++) {
      var cells = bodyTable.rows[r].cells;
      if (!cells || !cells.length) continue;
      var obj = {};
      var any = false;
      for (var j = 0; j < columns.length; j++) {
        var v = cells[j] ? htmlCellText(cells[j]) : "";
        obj[columns[j]] = v;
        if (v) any = true;
      }
      if (any) rows.push(obj);
    }
    if (!rows.length) return null;
    return {
      columns: columns,
      rows: rows,
      row_count: rows.length,
      capture: headerNames ? "html_sti" : "html",
    };
  }

  function stiResolveTitle(domEl, attrs) {
    // Painted title wins (already decoded)
    if (domEl && domEl.titlePanel) {
      var painted = htmlCellText(domEl.titlePanel);
      if (painted) return painted;
    }
    var ca = attrs && attrs.contentAttributes;
    if (ca && ca.title) {
      if (typeof ca.title === "string") return stiNormStr(ca.title);
      if (ca.title.visible === false) {
        /* fall through to name */
      } else if (ca.title.text != null) {
        return stiNormStr(ca.title.text);
      }
    }
    if (attrs && attrs.alias) return String(attrs.alias);
    if (attrs && attrs.name) return String(attrs.name);
    return null;
  }

  function captureTableElement(domEl, ca) {
    var attrs = domEl.elementAttributes || {};
    var dg = domEl.dataGrid || null;
    ca = ca || attrs.contentAttributes || {};

    // Try ALL pairings: amounts often only in contentAttributes.hiddenData
    // while names live on dataGrid.data (or the reverse).
    var visibles = [dg && dg.data, ca.data];
    var hiddens = [dg && dg.hiddenData, ca.hiddenData];
    var best = null;
    var bestScore = -1;
    for (var vi = 0; vi < visibles.length; vi++) {
      for (var hi = 0; hi < hiddens.length; hi++) {
        var v = visibles[vi];
        var h = hiddens[hi];
        if (!v && !h) continue;
        var merged = stiMergeVisibleHidden(v, h);
        var hasH =
          Array.isArray(h) &&
          h.length > 0 &&
          Array.isArray(h[0]) &&
          h[0].length > 0;
        var tag =
          (v === (dg && dg.data) ? "dg" : "ca") +
          "+" +
          (hasH ? (h === (dg && dg.hiddenData) ? "dgHidden" : "caHidden") : "noHidden");
        var parsed = stiParseGrid(merged, tag);
        if (!parsed || parsed.row_count < 1) continue;
        var sc = stiGridScore(parsed);
        if (sc > bestScore) {
          best = parsed;
          bestScore = sc;
        }
      }
    }

    // Never let HTML override a real grid — prevents amount-split-across-rows
    if (best && best.row_count > 0) {
      best.title = stiResolveTitle(domEl, attrs);
      return best;
    }

    var htmlParsed = stiScrapeHtmlFallback(domEl);
    if (htmlParsed && htmlParsed.row_count > 0) {
      htmlParsed.title = stiResolveTitle(domEl, attrs);
      return htmlParsed;
    }

    return {
      columns: best && best.columns ? best.columns : [],
      column_meta: best && best.column_meta ? best.column_meta : undefined,
      rows: [],
      row_count: 0,
      capture: best ? "grid_empty" : "empty",
      title: stiResolveTitle(domEl, attrs),
    };
  }

  function elementTitle(attrs) {
    return stiResolveTitle(null, attrs);
  }

  // keep old name used by chart path
  function parseGridData(data, tag) {
    return stiParseGrid(data, tag);
  }
  function scrapeHtmlTables(root) {
    return stiScrapeHtmlFallback(root);
  }

  function cloneFiltersList(list) {
    var arr = [];
    var n = collectionLength(list);
    if (n > 0) {
      for (var i = 0; i < n; i++) arr.push(cloneFilterRule(collectionItem(list, i)));
    } else if (Array.isArray(list)) {
      list.forEach(function (it) {
        arr.push(cloneFilterRule(it));
      });
    }
    return arr.filter(function (f) {
      return f && f.value !== undefined && f.value !== null && f.value !== "";
    });
  }

  function visibleText(el, maxLen) {
    try {
      var t = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
      if (!t) return null;
      return t.length > (maxLen || 400) ? t.slice(0, maxLen || 400) : t;
    } catch (e) {
      return null;
    }
  }

  function snapshotElement(domEl) {
    var attrs = domEl.elementAttributes;
    if (!attrs || !attrs.type) return null;
    var name = attrs.name || attrs.key || "element";
    var type = attrs.type;
    var out = { name: String(name), type: String(type), title: elementTitle(attrs) };
    var ca = attrs.contentAttributes || {};

    if (ca.filters) {
      var ef = cloneFiltersList(ca.filters);
      if (ef.length) out.filters = ef;
    }

    if (type === "StiTableElement" || type === "StiPivotTableElement") {
      var table = captureTableElement(domEl, ca);
      out.columns = table.columns;
      out.rows = table.rows;
      out.row_count = table.row_count;
      out.capture = table.capture;
      out.title = table.title || out.title || String(attrs.name || name);
      if (table.column_meta) out.column_meta = table.column_meta;
      if (table.totals) out.totals = table.totals;
      return out;
    }

    if (
      type === "StiIndicatorElement" ||
      type === "StiProgressElement" ||
      type === "StiGaugeElement" ||
      type === "StiChartElement" ||
      type === "StiRegionMapElement" ||
      type === "StiOnlineMapElement" ||
      type === "StiCardsElement" ||
      type === "StiListBoxElement" ||
      type === "StiComboBoxElement" ||
      type === "StiTreeViewElement" ||
      type === "StiTreeViewBoxElement" ||
      type === "StiTextElement" ||
      type.indexOf("Button") >= 0
    ) {
      if (ca.value !== undefined)
        out.value =
          stiCellValue(ca.value) != null ? stiCellValue(ca.value) : ca.value;
      if (ca.text !== undefined)
        out.text = stiCellValue(ca.text) != null ? stiCellValue(ca.text) : ca.text;
      if (ca.series !== undefined) out.series = safeClone(ca.series);
      if (attrs.isChecked !== undefined) out.checked = !!attrs.isChecked;
      if (ca.isChecked !== undefined) out.checked = !!ca.isChecked;
      // Short label only — not a full table dump
      var vt = visibleText(domEl, 160);
      if (vt && out.text == null && out.value == null) out.text = vt;
      if (type === "StiChartElement" && ca.data) {
        var chartGrid = parseGridData(ca.data);
        if (chartGrid && chartGrid.row_count > 0) {
          out.columns = chartGrid.columns;
          out.rows = chartGrid.rows;
          out.row_count = chartGrid.row_count;
          out.capture = chartGrid.capture;
        } else {
          var chartHtml = scrapeHtmlTables(domEl);
          if (chartHtml) {
            out.columns = chartHtml.columns;
            out.rows = chartHtml.rows;
            out.row_count = chartHtml.row_count;
            out.capture = chartHtml.capture;
          }
        }
      }
      return out;
    }

    // Unknown: short text only (avoid multi-kb table paste)
    out.text = visibleText(domEl, 160);
    // If it secretly contains a data table, capture structured
    var maybeTable = scrapeHtmlTables(domEl);
    if (maybeTable && maybeTable.row_count > 0) {
      out.columns = maybeTable.columns;
      out.rows = maybeTable.rows;
      out.row_count = maybeTable.row_count;
      out.capture = maybeTable.capture;
      delete out.text;
    }
    return out;
  }

  function collectDashboardFilters(elements, interaction) {
    var seen = {};
    var out = [];
    function add(rule) {
      if (!rule || rule.value === undefined || rule.value === null || rule.value === "")
        return;
      var key = String(rule.path || "map") + "|" + String(rule.value);
      if (seen[key]) return;
      seen[key] = true;
      out.push({
        path: rule.path || "map",
        value: rule.value,
        condition: rule.condition || "EqualTo",
      });
    }
    (elements || []).forEach(function (el) {
      (el.filters || []).forEach(add);
    });
    if (interaction) {
      ["filteringParameters", "drillDownParameters", "dashboardElementDrillDownParameters"].forEach(
        function (bagName) {
          var bag = interaction[bagName];
          if (!bag) return;
          if (bag.filters) cloneFiltersList(bag.filters).forEach(add);
        }
      );
      (interaction.dashboard_filters || []).forEach(add);
    }
    return out;
  }

  function snapshotViewport(interaction) {
    var elements = [];
    var seenNames = {};
    var nodes = document.getElementsByTagName("*");
    for (var i = 0; i < nodes.length; i++) {
      var domEl = nodes[i];
      if (!domEl.elementAttributes || !domEl.elementAttributes.type) continue;
      var snap = snapshotElement(domEl);
      if (!snap) continue;
      // prefer richer capture per name (rows >> value >> short text)
      if (seenNames[snap.name]) {
        var prev = elements[seenNames[snap.name]];
        function score(el) {
          return (
            (el.row_count || (el.rows ? el.rows.length : 0) || 0) * 1000 +
            (el.value != null ? 10 : 0) +
            (el.text && String(el.text).length < 200 ? 1 : 0) -
            (el.text && String(el.text).length >= 200 ? 50 : 0)
          );
        }
        if (score(snap) > score(prev)) elements[seenNames[snap.name]] = snap;
        continue;
      }
      seenNames[snap.name] = elements.length;
      elements.push(snap);
    }
    var panel = {};
    if (interaction) {
      var flat = flattenParams(interaction);
      Object.keys(flat).forEach(function (k) {
        panel[k] = flat[k];
      });
    }
    return {
      captured_at: new Date().toISOString(),
      interaction: interaction || lastInteractionDump || null,
      filters: {
        panel: panel,
        dashboard: collectDashboardFilters(elements, interaction || lastInteractionDump),
      },
      elements: elements,
    };
  }

  function postViewportAndCompare() {
    var vp = snapshotViewport(lastInteractionDump);
    if (window.console && console.log) {
      console.log("[viewport]", vp.elements.length, "elements", vp);
    }
    fetch("/api/viewport", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(vp),
      cache: "no-store",
    })
      .then(function () {
        return fetch("/api/compare", { cache: "no-store" });
      })
      .then(function (r) {
        return r.text();
      })
      .then(function (text) {
        showText(text, "SVERKA");
      })
      .catch(function (e) {
        showText(String(e), "ERROR");
      });
  }

  function refreshAfterInteraction(action) {
    // Tables often paint later than KPI/map — retry until rows appear.
    var delays = [800, 1800, 3200, 5000];
    if (
      action === "DashboardElementDrillDown" ||
      action === "DashboardElementDrillUp" ||
      action === "DashboardDrillDown" ||
      action === "DashboardFiltering" ||
      action === "DashboardButtonElementApplyEvents" ||
      action === "Variables"
    ) {
      delays = [700, 1500, 2800, 4500, 6500];
    }
    delays.forEach(function (ms) {
      setTimeout(postViewportAndCompare, ms);
    });
  }

  window.dashCaptureInteraction = function (args) {
    try {
      var dump = dumpArgs(args);
      lastInteractionDump = dump;
      var params = flattenParams(dump);
      ensurePanel();
      var actionEl = document.getElementById("dash-interaction-action");
      if (actionEl) {
        actionEl.textContent =
          dump.button || dump.action || dump.element || "(no action)";
      }
      if (window.console && console.log) {
        console.log("[dash interaction]", dump.action, dump);
      }
      fetch("/api/params", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ params: params, interaction: dump }),
        cache: "no-store",
      })
        .then(function () {
          refreshAfterInteraction(dump.action);
        })
        .catch(function () {
          refreshAfterInteraction(dump.action);
        });
    } catch (e) {
      if (window.console && console.error) console.error(e);
    }
  };

  window.dashRefreshLlmPack = refreshLlmPack;
  window.dashSnapshotViewport = snapshotViewport;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      ensurePanel();
      setTimeout(postViewportAndCompare, 1800);
    });
  } else {
    ensurePanel();
    setTimeout(postViewportAndCompare, 1800);
  }
})();
