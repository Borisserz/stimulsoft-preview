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

  function cellValue(cell) {
    if (cell == null) return null;
    if (typeof cell !== "object") return cell;
    // Stimulsoft table body cells use .text (see DataGrid.showData)
    if (cell.text !== undefined && cell.text !== null) return cell.text;
    if (cell.value !== undefined && cell.value !== null) return cell.value;
    if (cell.label !== undefined && cell.label !== null) return cell.label;
    if (cell.displayValue !== undefined && cell.displayValue !== null)
      return cell.displayValue;
    if (cell.caption !== undefined && cell.caption !== null) return cell.caption;
    if (cell.image !== undefined && cell.image !== null) return cell.image;
    return null;
  }

  function uniqueColumns(names) {
    var seen = {};
    var out = [];
    for (var i = 0; i < names.length; i++) {
      var base = String(names[i] || "").trim() || "c" + i;
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

  function parseGridData(data) {
    // Stimulsoft: data[0] = header cells ({label, key, ...}), data[1..] = row cells ({text})
    if (!Array.isArray(data) || data.length < 1) return null;
    var header = data[0];
    if (!Array.isArray(header) || header.length < 1) return null;
    var hasTotal = false;
    for (var h = 0; h < header.length; h++) {
      if (header[h] && header[h].showTotalSummary) hasTotal = true;
    }
    var end = hasTotal && data.length > 1 ? data.length - 1 : data.length;
    var rawNames = [];
    for (var c = 0; c < header.length; c++) {
      var col = header[c] || {};
      // label is what the UI shows (owningColumnName in viewer)
      rawNames.push(
        col.label || col.key || col.text || col.name || col.column || "c" + c
      );
    }
    var columns = uniqueColumns(rawNames);
    var rows = [];
    for (var r = 1; r < end; r++) {
      var row = data[r];
      if (!Array.isArray(row)) continue;
      var obj = {};
      var any = false;
      for (var i = 0; i < columns.length; i++) {
        var v = cellValue(row[i]);
        obj[columns[i]] = v;
        if (v !== null && v !== undefined && v !== "") any = true;
      }
      // keep empty rows too if they exist in grid (rare); prefer non-empty
      if (any || row.length > 0) rows.push(obj);
    }
    return {
      columns: columns,
      rows: rows,
      row_count: rows.length,
      capture: "grid",
    };
  }

  function scrapeHtmlTables(root) {
    // Structured fallback: never smash the whole table into one string.
    if (!root) return null;
    var tables = root.getElementsByTagName
      ? root.getElementsByTagName("table")
      : [];
    var best = null;
    for (var t = 0; t < tables.length; t++) {
      var table = tables[t];
      var trs = table.rows;
      if (!trs || trs.length < 2) continue;
      // skip tiny chrome (1-col nav / icon) tables
      var headerCells = trs[0].cells;
      if (!headerCells || headerCells.length < 1) continue;
      var rawNames = [];
      for (var c = 0; c < headerCells.length; c++) {
        rawNames.push(
          String(headerCells[c].innerText || headerCells[c].textContent || "")
            .replace(/\s+/g, " ")
            .trim() || "c" + c
        );
      }
      var columns = uniqueColumns(rawNames);
      var rows = [];
      for (var r = 1; r < trs.length; r++) {
        var cells = trs[r].cells;
        if (!cells || cells.length < 1) continue;
        var obj = {};
        var any = false;
        for (var i = 0; i < columns.length; i++) {
          var cell = cells[i];
          var v = cell
            ? String(cell.innerText || cell.textContent || "")
                .replace(/\s+/g, " ")
                .trim()
            : "";
          obj[columns[i]] = v;
          if (v) any = true;
        }
        if (any) rows.push(obj);
      }
      if (rows.length < 1) continue;
      if (!best || rows.length > best.row_count) {
        best = {
          columns: columns,
          rows: rows,
          row_count: rows.length,
          capture: "html",
        };
      }
    }
    return best;
  }

  function captureTableElement(domEl, ca) {
    var gridData =
      (domEl.dataGrid && domEl.dataGrid.data) ||
      (ca && ca.data) ||
      null;
    var parsed = parseGridData(gridData);
    if (parsed && parsed.row_count > 0) return parsed;
    var htmlParsed = scrapeHtmlTables(domEl);
    if (htmlParsed && htmlParsed.row_count > 0) return htmlParsed;
    // header-only grid still useful (columns known)
    if (parsed && parsed.columns && parsed.columns.length) {
      return {
        columns: parsed.columns,
        rows: [],
        row_count: 0,
        capture: "grid_empty",
      };
    }
    return { columns: [], rows: [], row_count: 0, capture: "empty" };
  }

  function elementTitle(attrs) {
    var ca = attrs && attrs.contentAttributes;
    if (!ca) return null;
    if (ca.title != null && typeof ca.title !== "object") return String(ca.title);
    if (ca.title && ca.title.text != null) return String(ca.title.text);
    return null;
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
      // NEVER smash the whole table into one text string
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
      if (ca.value !== undefined) out.value = cellValue(ca.value) != null ? cellValue(ca.value) : ca.value;
      if (ca.text !== undefined) out.text = cellValue(ca.text) != null ? cellValue(ca.text) : ca.text;
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
