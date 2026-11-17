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
      '<button type="button" id="dash-interaction-structure" style="background:#1e3a8a;color:#dbeafe;border:1px solid #3b82f6;padding:3px 10px;cursor:pointer;font-weight:700">STRUKTURA</button>' +
      '<button type="button" id="dash-interaction-atlas" style="background:#854d0e;color:#fef9c3;border:1px solid #eab308;padding:3px 10px;cursor:pointer;font-weight:700">ATLAS</button>' +
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
    document.getElementById("dash-interaction-structure").onclick = function () {
      postViewportAndStructure();
    };
    document.getElementById("dash-interaction-atlas").onclick = function () {
      runAtlasAuto();
    };
    document.getElementById("dash-interaction-json").onclick = function () {
      refreshLlmPack(0);
    };
    return el;
  }

  function findViewerJsObject() {
    try {
      var nodes = document.getElementsByTagName("*");
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].jsObject && nodes[i].jsObject.reportParams) return nodes[i].jsObject;
      }
    } catch (e) {}
    return null;
  }

  function listReportPages() {
    var report = resolveStiReport();
    var out = [];
    if (!report || !report.pages) return out;
    var n = collectionLength(report.pages);
    if (n < 1 && report.pages.list && report.pages.list.length)
      n = report.pages.list.length;
    for (var i = 0; i < n; i++) {
      var p = collectionItem(report.pages, i);
      if (!p && report.pages.list) p = report.pages.list[i];
      var name =
        (p &&
          (p.name ||
            p.aliasName ||
            p.pageName ||
            (p.properties && p.properties.name))) ||
        "Page" + (i + 1);
      out.push({ index: i, name: String(name) });
    }
    if (!out.length) out.push({ index: 0, name: "Page1" });
    return out;
  }

  var lastAtlasHit = null;
  var lastAtlasNav = null;

  function dashboardButtons() {
    var jo = findViewerJsObject();
    var panel = jo && jo.controls && jo.controls.dashboardsPanel;
    var buttons = panel && panel.buttons;
    if (!buttons || !buttons.length) return [];
    var out = [];
    for (var i = 0; i < buttons.length; i++) {
      if (!buttons[i].isNestedPage) out.push(buttons[i]);
    }
    return out;
  }

  function dashboardButtonForPage(index) {
    var buttons = dashboardButtons();
    for (var i = 0; i < buttons.length; i++) {
      var rp = buttons[i].reportParams || {};
      var n = rp.originalPageNumber != null ? rp.originalPageNumber : rp.pageNumber;
      if (n === index) return buttons[i];
    }
    return buttons[index] || null;
  }

  /** Cards + indicators. Page flips that do not change this key did not change the screen. */
  function atlasScreenKey() {
    var bits = [];
    var nodes = document.getElementsByTagName("*");
    for (var i = 0; i < nodes.length; i++) {
      var attrs = nodes[i].elementAttributes;
      if (!attrs || !attrs.type) continue;
      var type = String(attrs.type);
      if (type.indexOf("Cards") < 0 && type.indexOf("Indicator") < 0 && type.indexOf("Map") < 0)
        continue;
      var comp = nodes[i].element;
      var text = comp && comp.text ? String(comp.text) : "";
      if (!text && type.indexOf("Map") >= 0) {
        text = String(nodes[i].innerText || "").replace(/\s+/g, " ").trim().slice(0, 80);
      }
      if (text) bits.push(String(attrs.name || "") + "=" + text);
    }
    bits.sort();
    return bits.join("|");
  }

  function atlasWaitStable(ms) {
    var last = "\0";
    var stable = 0;
    var start = Date.now();
    return new Promise(function tick(resolve) {
      var key = atlasScreenKey();
      if (key && key === last) stable++;
      else stable = 0;
      last = key;
      if ((key && stable >= 2) || Date.now() - start >= ms) resolve(key);
      else setTimeout(function () { tick(resolve); }, 400);
    });
  }

  function atlasGeomList() {
    var all = [];
    var nodes = document.getElementsByTagName("*");
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!n.getAttribute) continue;
      var ident = n.getAttribute("elementident") || "";
      var arg = n.getAttribute("elementargument") || "";
      var value = n.getAttribute("elementvalue") || "";
      if (!ident && !arg && !value) continue;
      all.push({
        ident: ident.slice(0, 48),
        argument: arg.slice(0, 48),
        value: value.replace(/\s+/g, " ").trim().slice(0, 48),
        onclick: typeof n.onclick === "function",
      });
    }
    var interesting = [];
    var rest = [];
    for (var j = 0; j < all.length; j++) {
      var blob = all[j].ident + " " + all[j].argument + " " + all[j].value;
      if (/brest|брест|pinsk|пинск|област/i.test(blob)) interesting.push(all[j]);
      else rest.push(all[j]);
    }
    return interesting.slice(0, 8).concat(rest.slice(0, 6));
  }

  function atlasProbe() {
    var jo = findViewerJsObject();
    var panel = jo && jo.controls && jo.controls.dashboardsPanel;
    var selected = panel && panel.selectedButton;
    var buttons = dashboardButtons().map(function (b, i) {
      var rp = b.reportParams || {};
      return {
        i: i,
        text: String(b.innerText || b.textContent || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 40),
        page: rp.originalPageNumber != null ? rp.originalPageNumber : rp.pageNumber,
        selected: b === selected,
      };
    });
    var guid = jo && jo.reportParams && jo.reportParams.dashboardDrillDownGuid;
    return {
      buttons: buttons,
      geoms: atlasGeomList(),
      drill_guid: guid ? String(guid).slice(0, 12) : "net",
    };
  }

  function atlasNoteHit(el, via) {
    lastAtlasHit = {
      via: via || "none",
      ident: el && el.getAttribute ? el.getAttribute("elementident") || "" : "",
      argument: el && el.getAttribute ? el.getAttribute("elementargument") || "" : "",
      value:
        el && el.getAttribute
          ? String(el.getAttribute("elementvalue") || "")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 48)
          : "",
      onclick: !!(el && typeof el.onclick === "function"),
    };
  }

  function atlasTableNotes(vp) {
    var out = [];
    var els = (vp && vp.elements) || [];
    var reasons = {};
    ((vp && vp.export_debug) || []).forEach(function (row) {
      if (row && row.name) reasons[row.name] = row.reason || "";
    });
    for (var i = 0; i < els.length && out.length < 4; i++) {
      var el = els[i];
      if (!el) continue;
      var type = String(el.type || "");
      if (type.indexOf("Pivot") < 0 && type.indexOf("Table") < 0) continue;
      out.push({
        name: el.name,
        capture: el.capture || "",
        rows: el.row_count || 0,
        reason: reasons[el.name] || "",
      });
    }
    return out;
  }

  function gotoReportPage(index) {
    var before = atlasScreenKey();
    var via = "none";
    var text = "";
    try {
      var btn = dashboardButtonForPage(index);
      if (btn && typeof btn.action === "function") {
        text = String(btn.innerText || btn.textContent || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 40);
        via = "panel";
        btn.action();
      } else {
        var jo = findViewerJsObject();
        if (jo && jo.reportParams) {
          jo.reportParams.pageNumber = index;
          jo.reportParams.dashboardDrillDownGuid = null;
          if (typeof jo.postAction === "function") jo.postAction("Refresh");
          via = "refresh";
        }
      }
    } catch (e3) {
      via = "error";
    }
    return atlasWaitStable(5000).then(function (key) {
      var changed = !before || key !== before || index === 0;
      lastAtlasNav = { text: text, via: via, changed: changed, page: index };
      return { changed: changed };
    });
  }

  function buildAtlasPageRecord(label, kind, pageMeta, vp) {
    return {
      label: label,
      kind: kind || "manual",
      page_index: pageMeta && pageMeta.index,
      page_name: pageMeta && pageMeta.name,
      captured_at: (vp && vp.captured_at) || new Date().toISOString(),
      filters: (vp && vp.filters) || { panel: {}, dashboard: [] },
      interaction: (vp && vp.interaction) || lastInteractionDump,
      viewport: vp,
      diag: {
        nav: lastAtlasNav,
        click: lastAtlasHit,
        tables: atlasTableNotes(vp),
      },
    };
  }

  function captureAtlasPage(label, kind, pageMeta) {
    var vp = snapshotViewport(lastInteractionDump);
    return enrichViewportTables(vp).then(function (enriched) {
      return buildAtlasPageRecord(label, kind, pageMeta, enriched);
    });
  }

  function atlasWait(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function atlasClick(el) {
    if (!el) return false;
    try {
      el.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window })
      );
      el.dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window })
      );
      el.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, view: window })
      );
    } catch (e) {}
    try {
      el.click();
    } catch (e2) {}
    return true;
  }

  function atlasWaitUntil(pred, ms) {
    var start = Date.now();
    return new Promise(function tick(resolve) {
      var ok = false;
      try {
        ok = !!pred();
      } catch (e) {
        ok = false;
      }
      if (ok || Date.now() - start >= ms) resolve(ok);
      else setTimeout(function () { tick(resolve); }, 250);
    });
  }

  function atlasCurrentPage() {
    var pages = listReportPages();
    var jo = findViewerJsObject();
    var idx =
      jo && jo.reportParams && typeof jo.reportParams.pageNumber === "number"
        ? jo.reportParams.pageNumber
        : 0;
    return pages[idx] || { index: idx, name: "" };
  }

  /** Stimulsoft map drill is path.onclick, value taken from elementident. */
  function atlasClickGeom(re) {
    var nodes = document.getElementsByTagName("*");
    var best = null;
    var bestLen = 9999;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!n.getAttribute) continue;
      var blob = [
        n.getAttribute("elementident") || "",
        n.getAttribute("elementargument") || "",
        n.getAttribute("elementvalue") || "",
        n.getAttribute("interactiontooltip") || "",
      ].join(" ");
      if (!blob.trim() || !re.test(blob)) continue;
      if (blob.length < bestLen) {
        best = n;
        bestLen = blob.length;
      }
    }
    if (!best) best = atlasFindText(re);
    if (!best) {
      atlasNoteHit(null, "none");
      return false;
    }
    var ident = best.getAttribute && best.getAttribute("elementident");
    var arg = best.getAttribute && best.getAttribute("elementargument");
    if (!ident && arg) best.setAttribute("elementident", arg);
    var cur = best;
    for (var up = 0; up < 8 && cur; up++) {
      if (typeof cur.onclick === "function") {
        try {
          cur.onclick.call(cur);
          atlasNoteHit(cur, "onclick");
          return true;
        } catch (e1) {}
      }
      cur = cur.parentElement || cur.parentNode;
    }
    atlasNoteHit(best, "click");
    return atlasClick(best);
  }

  function atlasFindMap(re) {
    var nodes = document.getElementsByTagName("*");
    for (var i = 0; i < nodes.length; i++) {
      if (!nodes[i].getAttribute) continue;
      var arg = nodes[i].getAttribute("elementargument") || "";
      var ident = nodes[i].getAttribute("elementident") || "";
      if (re.test(arg) || re.test(ident)) return nodes[i];
    }
    return null;
  }

  function atlasFindText(re) {
    var nodes = document.querySelectorAll("text, tspan, td, span, div, a");
    var best = null;
    var bestLen = 999;
    for (var i = 0; i < nodes.length; i++) {
      var t = String(nodes[i].textContent || "").replace(/\s+/g, " ").trim();
      if (!t || t.length > 80 || !re.test(t)) continue;
      if (t.length < bestLen) {
        best = nodes[i];
        bestLen = t.length;
      }
    }
    return best;
  }

  /** Open collapsed pivot groups (Stimulsoft cell.changeTotal). */
  function atlasExpandTables() {
    var tds = document.getElementsByTagName("td");
    var n = 0;
    for (var i = 0; i < tds.length && n < 40; i++) {
      var cell = tds[i].cell;
      if (!cell || typeof cell.changeTotal !== "function" || cell.opened) continue;
      try {
        cell.changeTotal(true, true);
        n++;
      } catch (e) {}
    }
    return n;
  }

  function atlasClickLabeled(re) {
    var nodes = document.getElementsByTagName("*");
    var best = null;
    var bestLen = 999;
    var bestText = "";
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var text = "";
      try {
        if (el.element && el.element.text) text = String(el.element.text);
      } catch (e0) {}
      if (!text) {
        text = String(el.innerText || el.textContent || "");
      }
      text = text.replace(/\s+/g, " ").trim();
      if (!text || text.length > 60 || !re.test(text)) continue;
      if (text.length < bestLen) {
        best = el;
        bestLen = text.length;
        bestText = text;
      }
    }
    if (!best) return null;
    atlasClick(best);
    return bestText;
  }

  function atlasButtonShot(collected, label, re, pageMeta) {
    return atlasWait(300).then(function () {
      var hit = atlasClickLabeled(re);
      if (!hit) return null;
      return atlasWait(2500)
        .then(function () {
          atlasExpandTables();
          return atlasWait(1200);
        })
        .then(function () {
          return captureAtlasPage(label + " [" + hit + "]", "button", pageMeta);
        })
        .then(function (rec) {
          collected.push(rec);
        });
    });
  }

  function atlasDrillShot(collected, label, clicker) {
    var beforeKey = "";
    return atlasWait(500)
      .then(function () {
        beforeKey = atlasScreenKey();
        var hit = clicker();
        return atlasWaitUntil(function () {
          return hit && atlasScreenKey() !== beforeKey;
        }, 8000).then(function (drilled) {
          return { hit: hit, drilled: drilled };
        });
      })
      .then(function (res) {
        atlasExpandTables();
        return atlasWaitStable(4000).then(function () {
          return res;
        });
      })
      .then(function (res) {
        var tag = label;
        if (!res.hit) tag = label + " (net klikaemyj oblasti)";
        else if (!res.drilled) tag = label + " (klik ne otkryl proval)";
        return captureAtlasPage(tag, "drill", atlasCurrentPage());
      })
      .then(function (rec) {
        collected.push(rec);
      });
  }

  function runAtlasAuto() {
    showText("ATLAS: pages, potom proval Brest i Pinsk, potom knopki...", "ATLAS");
    var pages = listReportPages();
    var chain = Promise.resolve();
    var collected = [];
    var probeBox = null;
    pages.forEach(function (meta) {
      chain = chain.then(function () {
        return gotoReportPage(meta.index).then(function (nav) {
          var label = "page" + meta.index + " " + meta.name;
          if (nav && nav.changed === false) label += " (ekran ne smenilsya)";
          return captureAtlasPage(label, "auto_page", meta).then(function (rec) {
            collected.push(rec);
          });
        });
      });
    });
    var page0 = pages[0] || { index: 0, name: "P6" };
    var dyn = pages[1] || page0;
    for (var di = 0; di < pages.length; di++) {
      if (/динам/i.test(pages[di].name || "")) {
        dyn = pages[di];
        break;
      }
    }
    chain = chain.then(function () {
      return gotoReportPage(page0.index);
    });
    chain = chain.then(function () {
      probeBox = atlasProbe();
    });
    chain = chain.then(function () {
      return atlasDrillShot(collected, "drill Brest", function () {
        return atlasClickGeom(/brest|брест|brestska/i);
      });
    });
    chain = chain.then(function () {
      return atlasDrillShot(collected, "drill Pinsk", function () {
        return atlasClickGeom(/pinsk|пинск|пинскому/i);
      });
    });
    chain = chain.then(function () {
      return gotoReportPage(page0.index);
    });
    chain = chain.then(function () {
      return atlasButtonShot(
        collected,
        "obshchie vypolnenie",
        /выполнен/i,
        page0
      );
    });
    chain = chain.then(function () {
      return atlasButtonShot(collected, "obshchie detalizaciya", /детализ/i, page0);
    });
    chain = chain.then(function () {
      return gotoReportPage(dyn.index);
    });
    chain = chain.then(function () {
      return atlasButtonShot(
        collected,
        "dinamika otklonenie v %",
        /отклонени[ея]\s+в\s*%/i,
        dyn
      );
    });
    chain = chain.then(function () {
      return atlasButtonShot(collected, "dinamika otklonenie", /^отклонение$/i, dyn);
    });
    chain = chain.then(function () {
      return atlasButtonShot(collected, "dinamika procent", /процент/i, dyn);
    });
    return chain
      .then(function () {
        return fetch("/api/atlas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
            replace: true,
            captured_at: new Date().toISOString(),
            probe: probeBox || atlasProbe(),
            pages: collected,
          }),
          cache: "no-store",
        });
      })
      .then(function () {
        return fetch("/api/atlas-text", { cache: "no-store" });
      })
      .then(function (r) {
        return r.text();
      })
      .then(function (text) {
        showText(text, "ATLAS");
        try {
          window.open("/atlas", "_blank");
        } catch (e) {}
      })
      .catch(function (e) {
        showText(String(e), "ATLAS ERROR");
      });
  }

  function dashAtlasAddSnapshot(label) {
    var pages = listReportPages();
    var jo = findViewerJsObject();
    var idx =
      jo && jo.reportParams && typeof jo.reportParams.pageNumber === "number"
        ? jo.reportParams.pageNumber
        : 0;
    var meta = pages[idx] || pages[0] || { index: idx, name: "Page" };
    return captureAtlasPage(label || "manual", "manual", meta).then(function (rec) {
      return fetch("/api/atlas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page: rec }),
        cache: "no-store",
      }).then(function () {
        return fetch("/api/atlas-text", { cache: "no-store" });
      }).then(function (r) {
        return r.text();
      }).then(function (text) {
        showText(text, "ATLAS +" + (label || "manual"));
        return text;
      });
    });
  }

  function postViewportAndStructure() {
    var vp = snapshotViewport(lastInteractionDump);
    enrichViewportTables(vp)
      .then(function (enriched) {
        return fetch("/api/viewport", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(enriched),
          cache: "no-store",
        });
      })
      .then(function () {
        return fetch("/api/structure-text", { cache: "no-store" });
      })
      .then(function (r) {
        return r.text();
      })
      .then(function (text) {
        showText(text, "STRUKTURA");
        try {
          window.open("/structure", "_blank");
        } catch (e) {}
      })
      .catch(function (e) {
        showText(String(e), "ERROR");
      });
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

  function isChromeHeaderName(name) {
    if (window.dashExportJson && window.dashExportJson.isChromeLabel) {
      return window.dashExportJson.isChromeLabel(name);
    }
    var s = String(name || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    return s === "close" || s === "закрыть" || s === "save" || s === "сохранить";
  }

  function stiScrapeHtmlFallback(root) {
    // Last resort only. Stimulsoft: header table (1 row) + body table (data only).
    // Never treat element chrome (Close/Save) as column headers.
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
        var chromeHits = 0;
        for (var c = 0; c < row0.cells.length; c++) {
          var nm = htmlCellText(row0.cells[c]) || "c" + c;
          names.push(nm);
          if (looksLikeDigitHeader(nm)) digitish++;
          if (isChromeHeaderName(nm)) chromeHits++;
        }
        // Skip toolbar/title chrome mistaken for a header row
        if (chromeHits > 0) continue;
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

  function captureTableElementGrid(domEl, ca) {
    var attrs = domEl.elementAttributes || {};
    var dg = domEl.dataGrid || null;
    ca = ca || attrs.contentAttributes || {};

    // Fallback when Stimulsoft exportAsync(Json) is unavailable.
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

  function capturePivotFromViewerData(viewerData, title) {
    var api = window.dashExportJson;
    if (!api || typeof api.parsePivotViewerData !== "function") return null;
    var parsed = api.parsePivotViewerData(viewerData);
    if (!parsed || !parsed.row_count) return null;
    parsed.title = title || parsed.title;
    return parsed;
  }

  /** Sync: contentAttributes.cells from Stimulsoft pivot paint, if present. */
  function capturePivotElementSync(domEl, ca) {
    var attrs = (domEl && domEl.elementAttributes) || {};
    ca = ca || attrs.contentAttributes || {};
    var title = stiResolveTitle(domEl, attrs);
    if (ca.cells && Array.isArray(ca.cells)) {
      var fromCa = capturePivotFromViewerData(
        {
          cells: ca.cells,
          headerHeight: ca.headerHeight,
          headerWidth: ca.headerWidth,
        },
        title
      );
      if (fromCa) return fromCa;
    }
    return null;
  }

  // sync path used inside snapshotElement; enrich fills pivot/table async later
  function captureTableElement(domEl, ca) {
    var attrs = (domEl && domEl.elementAttributes) || {};
    var type = attrs.type || "";
    if (type === "StiPivotTableElement") {
      var pivotSync = capturePivotElementSync(domEl, ca);
      if (pivotSync && pivotSync.row_count) return pivotSync;
      // Do NOT fall through to html_sti for pivots — Close button pollutes columns.
      // Async getViewerData will fill; return empty placeholder.
      return {
        columns: [],
        rows: [],
        row_count: 0,
        capture: "pivot_pending",
        title: stiResolveTitle(domEl, attrs),
      };
    }
    return captureTableElementGrid(domEl, ca);
  }

  function loadPivotViewerData(component) {
    return new Promise(function (resolve) {
      try {
        var Helper =
          Stimulsoft &&
          Stimulsoft.Dashboard &&
          Stimulsoft.Dashboard.Helpers &&
          Stimulsoft.Dashboard.Helpers.StiPivotTableHelper;
        if (!Helper || typeof Helper.getViewerData !== "function") {
          resolve({ parsed: null, reason: "no_StiPivotTableHelper" });
          return;
        }
        Promise.resolve(Helper.getViewerData(component))
          .then(function (vd) {
            var parsed = capturePivotFromViewerData(vd, null);
            if (parsed && parsed.row_count)
              resolve({ parsed: parsed, reason: "ok_pivot_viewer" });
            else
              resolve({
                parsed: null,
                reason:
                  "pivot_viewer_empty cells=" +
                  (vd && vd.cells ? vd.cells.length : 0),
              });
          })
          .catch(function (e) {
            resolve({ parsed: null, reason: "pivot_viewer_err:" + String(e) });
          });
      } catch (e2) {
        resolve({ parsed: null, reason: "pivot_viewer_throw:" + String(e2) });
      }
    });
  }

  function rememberStiReport(report) {
    if (report && typeof report === "object" && report !== "[StiReport]") {
      try {
        window.__stiReport = report;
      } catch (e) {}
    }
  }

  function resolveStiReport() {
    if (window.__stiReport) return window.__stiReport;
    try {
      if (
        typeof Stimulsoft !== "undefined" &&
        Stimulsoft.Viewer &&
        Stimulsoft.Viewer.StiViewer
      ) {
        // last resort: any viewer that already has a report
        var nodes = document.getElementsByTagName("*");
        for (var i = 0; i < nodes.length; i++) {
          var el = nodes[i];
          if (el.jsObject && el.jsObject.report) {
            rememberStiReport(el.jsObject.report);
            return el.jsObject.report;
          }
          if (el.report && typeof el.report.getComponentByName === "function") {
            rememberStiReport(el.report);
            return el.report;
          }
        }
      }
    } catch (e2) {}
    return window.__stiReport || null;
  }

  function stiListToArray(list) {
    if (!list) return [];
    if (Array.isArray(list)) return list;
    if (Array.isArray(list.list)) return list.list;
    var n = collectionLength(list);
    var out = [];
    if (n > 0) {
      for (var i = 0; i < n; i++) out.push(collectionItem(list, i));
      return out;
    }
    if (typeof list.length === "number" && list.length > 0) {
      for (var j = 0; j < list.length; j++) out.push(list[j]);
    }
    return out;
  }

  function findDomByName(name) {
    try {
      var nodes = document.getElementsByTagName("*");
      for (var i = 0; i < nodes.length; i++) {
        var attrs = nodes[i].elementAttributes;
        if (attrs && String(attrs.name) === String(name)) return nodes[i];
      }
    } catch (e) {}
    return null;
  }

  function tableToMatrix(table) {
    var rows = [];
    if (!table || !table.rows) return rows;
    for (var r = 0; r < table.rows.length; r++) {
      var cells = table.rows[r].cells;
      if (!cells || !cells.length) continue;
      var row = [];
      for (var c = 0; c < cells.length; c++) {
        row.push({
          text: htmlCellText(cells[c]),
          colspan: cells[c].colSpan || 1,
        });
      }
      rows.push(row);
    }
    return rows;
  }

  /** Painted pivot tables. Used when getViewerData is only Total/Итог = 0,0. */
  function capturePivotHtml(domEl) {
    var api = window.dashExportJson;
    if (!domEl || !api) return null;
    var tables = domEl.getElementsByTagName("table");
    var chunks = [];
    for (var i = 0; i < tables.length; i++) {
      if (tables[i].getElementsByTagName("table").length > 0) continue;
      var matrix = tableToMatrix(tables[i]);
      if (!matrix.length) continue;
      chunks.push(matrix);
    }
    if (!chunks.length) return null;
    var parsed =
      typeof api.joinPivotHtmlChunks === "function"
        ? api.joinPivotHtmlChunks(chunks)
        : api.parseHtmlGrid
          ? api.parseHtmlGrid([].concat.apply([], chunks))
          : null;
    if (!parsed || !parsed.row_count) return null;
    if (typeof api.pruneSparsePivotRows === "function") {
      parsed = api.pruneSparsePivotRows(parsed);
    }
    if (!parsed || !parsed.row_count) return null;
    parsed.capture = "html_grid";
    return parsed;
  }

  function resolveTableComponent(name) {
    // 1) painted DOM often keeps live .element
    try {
      var nodes = document.getElementsByTagName("*");
      for (var i = 0; i < nodes.length; i++) {
        var domEl = nodes[i];
        var attrs = domEl.elementAttributes;
        if (!attrs || String(attrs.name) !== String(name)) continue;
        if (domEl.element && typeof domEl.element === "object") {
          if (domEl.element.report) rememberStiReport(domEl.element.report);
          return domEl.element;
        }
      }
    } catch (e0) {}
    var report = resolveStiReport();
    if (!report || typeof report.getComponentByName !== "function") return null;
    try {
      return report.getComponentByName(name);
    } catch (e) {
      return null;
    }
  }

  function meterLabel(meter, index) {
    if (!meter || typeof meter !== "object") return "c" + index;
    return (
      stiNormStr(
        meter.labelCorrect ||
          meter.label ||
          meter.displayName ||
          meter.name ||
          meter.key ||
          meter.expression ||
          meter.path
      ) || "c" + index
    );
  }

  function unwrapCell(v) {
    if (v == null) return null;
    if (typeof v !== "object") return v;
    if (v.value !== undefined && v.value !== null && v.value !== "") return v.value;
    if (v.text !== undefined && v.text !== null && v.text !== "") return v.text;
    if (v.Value !== undefined) return v.Value;
    return v;
  }

  /** Stimulsoft.Report.Dashboard.StiElementDataCache — same filtered rows as the table widget. */
  function parseStiDataTable(dt) {
    if (!dt) return null;
    var meters = stiListToArray(dt.meters);
    var rowsRaw = stiListToArray(dt.rows);
    if (!meters.length || !rowsRaw.length) return null;
    var rawNames = [];
    for (var m = 0; m < meters.length; m++) rawNames.push(meterLabel(meters[m], m));
    var columns = stiUniqueNames(rawNames);
    var rows = [];
    for (var r = 0; r < rowsRaw.length; r++) {
      var row = rowsRaw[r];
      var cells = stiListToArray(row);
      if (!cells.length && row && typeof row.length === "number") {
        cells = [];
        for (var k = 0; k < row.length; k++) cells.push(row[k]);
      }
      var obj = {};
      var any = false;
      for (var c = 0; c < columns.length; c++) {
        var val = stiNormStr(unwrapCell(cells[c]));
        obj[columns[c]] = val;
        if (val !== null && val !== undefined && val !== "") any = true;
      }
      if (any) rows.push(obj);
    }
    if (!rows.length) return null;
    return {
      columns: columns,
      rows: rows,
      row_count: rows.length,
      capture: "data_cache",
    };
  }

  function loadTableFromDataCache(component) {
    return new Promise(function (resolve) {
      try {
        var cache =
          Stimulsoft &&
          Stimulsoft.Report &&
          Stimulsoft.Report.Dashboard &&
          Stimulsoft.Report.Dashboard.StiElementDataCache;
        if (!cache || typeof cache.tryToGetOrCreate !== "function") {
          resolve({ parsed: null, reason: "no_StiElementDataCache" });
          return;
        }
        Promise.resolve(cache.tryToGetOrCreate(component))
          .then(function (dt) {
            var parsed = parseStiDataTable(dt);
            if (parsed) resolve({ parsed: parsed, reason: "ok_data_cache" });
            else
              resolve({
                parsed: null,
                reason:
                  "data_cache_empty meters=" +
                  stiListToArray(dt && dt.meters).length +
                  " rows=" +
                  stiListToArray(dt && dt.rows).length,
              });
          })
          .catch(function (e) {
            resolve({ parsed: null, reason: "data_cache_err:" + String(e) });
          });
      } catch (e2) {
        resolve({ parsed: null, reason: "data_cache_throw:" + String(e2) });
      }
    });
  }

  function stiExportFormatJson() {
    try {
      return Stimulsoft.Report.StiExportFormat.Json;
    } catch (e) {
      return null;
    }
  }

  function stiExportTools() {
    try {
      return Stimulsoft.Dashboard.Export.StiDashboardExportTools;
    } catch (e) {
      return null;
    }
  }

  /**
   * Official Table→JSON export (2024.2.x).
   * https://www.stimulsoft.com/en/samples/dashboards-js/javascript/exporting-a-dashboard-from-code
   */
  function exportTableJsonAsync(component) {
    return new Promise(function (resolve) {
      var tools = stiExportTools();
      var fmt = stiExportFormatJson();
      var parseApi = window.dashExportJson;
      if (!tools || typeof tools.exportAsync !== "function" || fmt == null) {
        resolve({ parsed: null, reason: "no_exportAsync_or_Json" });
        return;
      }
      if (!parseApi || typeof parseApi.parseExportJson !== "function") {
        resolve({ parsed: null, reason: "no_parseExportJson" });
        return;
      }
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        resolve({ parsed: null, reason: "export_json_timeout" });
      }, 12000);
      try {
        tools.exportAsync(
          function (data) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try {
              var textPreview = "";
              try {
                textPreview = String(
                  (window.dashExportJson &&
                    window.dashExportJson.decodeExportData(data)) ||
                    ""
                ).slice(0, 120);
              } catch (e0) {}
              var parsed = parseApi.parseExportJson(data);
              if (parsed)
                resolve({ parsed: parsed, reason: "ok_export_json" });
              else
                resolve({
                  parsed: null,
                  reason: "export_json_unparsed preview=" + textPreview,
                });
            } catch (e) {
              resolve({ parsed: null, reason: "export_json_err:" + String(e) });
            }
          },
          component,
          fmt
        );
      } catch (e2) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ parsed: null, reason: "export_json_throw:" + String(e2) });
      }
    });
  }

  /** Table: data_cache → JSON export. Pivot: getViewerData → JSON export. */
  function exportTableElementAsync(name, elType) {
    return new Promise(function (resolve) {
      var component = resolveTableComponent(name);
      if (!component) {
        var htmlFallback =
          elType === "StiPivotTableElement"
            ? capturePivotHtml(findDomByName(name))
            : null;
        if (htmlFallback && htmlFallback.row_count) {
          resolve({ parsed: htmlFallback, reason: "pick=html_grid no_component" });
          return;
        }
        resolve({
          parsed: null,
          reason:
            "no_component report=" +
            (resolveStiReport() ? "yes" : "no") +
            " name=" +
            name,
        });
        return;
      }
      var isPivot = elType === "StiPivotTableElement";
      if (isPivot) {
        loadPivotViewerData(component).then(function (viewer) {
          var api = window.dashExportJson;
          var viewerScore =
            api && api.pivotDataScore ? api.pivotDataScore(viewer && viewer.parsed) : 0;
          function finish(more) {
            // Re-read painted DOM here — early capture is often empty right after drill.
            var htmlNow = capturePivotHtml(findDomByName(name));
            var list = [].concat(more || []);
            if (viewerScore >= 10) list.push(viewer && viewer.parsed);
            if (htmlNow) list.push(htmlNow);
            var best =
              api && api.pickPivotSource
                ? api.pickPivotSource(list)
                : htmlNow || (viewerScore >= 10 ? viewer && viewer.parsed : null);
            if (!best || !best.row_count) {
              resolve({
                parsed: null,
                reason:
                  (viewer && viewer.reason) ||
                  "pivot_empty html=" + (htmlNow ? htmlNow.row_count : 0),
              });
              return;
            }
            var score = api && api.pivotDataScore ? api.pivotDataScore(best) : 0;
            resolve({
              parsed: best,
              reason:
                "pick=" +
                (best.capture || "?") +
                " score=" +
                score +
                " viewer=" +
                ((viewer && viewer.reason) || "-"),
            });
          }
          if (viewerScore >= 20) {
            finish([]);
            return;
          }
          loadTableFromDataCache(component).then(function (cache) {
            var cacheScore =
              api && api.pivotDataScore ? api.pivotDataScore(cache && cache.parsed) : 0;
            if (cacheScore >= 20) {
              finish([cache && cache.parsed]);
              return;
            }
            exportTableJsonAsync(component).then(function (json) {
              finish([cache && cache.parsed, json && json.parsed]);
            });
          });
        });
        return;
      }
      var first = loadTableFromDataCache(component);
      first.then(function (fromFirst) {
        if (fromFirst.parsed && fromFirst.parsed.row_count) {
          resolve(fromFirst);
          return;
        }
        var second = Promise.resolve({ parsed: null, reason: "skip" });
        second.then(function (fromSecond) {
          if (fromSecond.parsed && fromSecond.parsed.row_count) {
            resolve(fromSecond);
            return;
          }
          exportTableJsonAsync(component).then(function (fromJson) {
            if (fromJson.parsed && fromJson.parsed.row_count) {
              resolve(fromJson);
              return;
            }
            resolve({
              parsed: null,
              reason:
                (fromFirst.reason || "first_fail") +
                " | " +
                (fromSecond.reason || "second_fail") +
                " | " +
                (fromJson.reason || "json_fail"),
            });
          });
        });
      });
    });
  }

  function regionsFromCache(parsed) {
    if (!parsed || !parsed.rows || !parsed.rows.length) return [];
    var cols = parsed.columns || [];
    var ru = window.dashExportJson && window.dashExportJson.mapKeyToRu;
    return parsed.rows
      .map(function (row) {
        var name = null;
        var keyName = null;
        var amount = null;
        var percent = null;
        cols.forEach(function (c) {
          var v = row[c];
          if (v == null || v === "") return;
          var s = String(v).replace(/\s+/g, " ").trim();
          if (s === "[object Object]") return;
          var ck = String(c).toLowerCase();
          var isNum = /^-?\d[\d\s.,]*%?$/.test(s.replace(/\s/g, " ").trim()) ||
            /^-?\d[\d\s]*([.,]\d+)?$/.test(s.replace(/\s/g, ""));
          if (/%/.test(s) || /%|дол|share|percent/.test(ck)) {
            if (!percent) percent = s;
            return;
          }
          if (isNum || /value|факт|сумм|amount|знач|sum/.test(ck)) {
            if (isNum && !amount) amount = s;
            return;
          }
          if (/[A-Za-zА-Яа-яЁё]/.test(s)) {
            var named = ru ? ru(s) : s;
            if (/[А-Яа-яЁё]/.test(named)) name = named;
            else if (!keyName) keyName = named;
          }
        });
        var finalName = name || (ru && keyName ? ru(keyName) : keyName);
        if (!finalName) return null;
        return {
          name: finalName,
          amount: amount,
          percent: percent,
          value: amount || percent,
        };
      })
      .filter(function (r) {
        return r && r.name;
      });
  }

  function mergeMapRegions(painted, cached) {
    // data_cache has ALL oblast numbers even when the map paints only Brest.
    // Never merge cache amounts — painted SVG/labels are the only truth.
    void cached;
    return painted || [];
  }

  function enrichViewportTables(vp) {
    if (!vp || !Array.isArray(vp.elements)) {
      return Promise.resolve(vp);
    }
    vp.export_debug = [];
    var jobs = [];
    vp.elements.forEach(function (el, idx) {
      if (!el) return;
      if (el.type === "StiRegionMapElement" || el.type === "StiOnlineMapElement") {
        jobs.push(
          (function (mapEl) {
            var component = resolveTableComponent(mapEl.name);
            if (!component) {
              vp.export_debug.push({
                name: mapEl.name,
                ok: !!(mapEl.regions && mapEl.regions.length),
                capture: mapEl.capture || "map_labels",
                rows: mapEl.row_count || 0,
                reason: mapEl.regions && mapEl.regions.length ? "ok_map_labels" : "no_component",
                type: mapEl.type,
              });
              return Promise.resolve();
            }
            return loadTableFromDataCache(component).then(function (fromCache) {
              var cached = regionsFromCache(fromCache && fromCache.parsed);
              var merged = mergeMapRegions(mapEl.regions || [], cached);
              var reason =
                (mapEl.regions && mapEl.regions.length ? "map_labels" : "no_labels") +
                "+" +
                ((fromCache && fromCache.reason) || "no_cache");
              if (merged.length) {
                mapEl.regions = merged;
                mapEl.columns = ["name", "amount", "percent", "value"];
                mapEl.rows = merged;
                mapEl.row_count = merged.length;
                mapEl.capture =
                  mapEl.regions.some(function (r) {
                    return r.percent;
                  })
                    ? "map_labels"
                    : "map_cache";
                vp.elements[idx] = mapEl;
              }
              vp.export_debug.push({
                name: mapEl.name,
                ok: merged.length > 0,
                capture: mapEl.capture,
                rows: merged.length,
                reason: reason,
                type: mapEl.type,
              });
            });
          })(el)
        );
        return;
      }
      if (
        el.type !== "StiTableElement" &&
        el.type !== "StiPivotTableElement"
      ) {
        return;
      }
      jobs.push(
        exportTableElementAsync(el.name, el.type).then(function (result) {
          var exported = result && result.parsed;
          var reason = (result && result.reason) || "unknown";
          vp.export_debug.push({
            name: el.name,
            ok: !!(exported && exported.row_count),
            capture: exported && exported.capture,
            rows: exported && exported.row_count,
            reason: reason,
            prev_capture: el.capture,
            type: el.type,
          });
          if (!exported || !exported.row_count) return;
          el.columns = exported.columns;
          el.rows = exported.rows;
          el.row_count = exported.row_count;
          el.capture = exported.capture || "data_cache";
          if (exported.totals) el.totals = exported.totals;
          vp.elements[idx] = el;
        })
      );
    });
    if (!jobs.length) return Promise.resolve(vp);
    return Promise.all(jobs).then(function () {
      return vp;
    });
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

  function captureMapRegions(domEl) {
    var api = window.dashExportJson;
    if (!domEl || !api || typeof api.pairRegionLabels !== "function") return [];
    var lines = [];
    var seen = {};
    function pushLine(t) {
      t = String(t || "").replace(/\s+/g, " ").trim();
      if (!t || t.length > 160 || seen[t]) return;
      seen[t] = true;
      lines.push(t);
    }
    var fromAttrs = [];
    function walkRoot(root) {
      if (!root || !root.getElementsByTagName) return;
      // Do not dump the whole map as one line — it hides the other regions.
      var nodes = root.getElementsByTagName("*");
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        var tag = (node.tagName || "").toLowerCase();
        if (tag === "iframe") {
          try {
            var doc = node.contentDocument;
            if (doc && doc.body) walkRoot(doc.body);
          } catch (e1) {}
          continue;
        }
        if (node.getAttribute) {
          var arg =
            node.getAttribute("elementargument") ||
            node.getAttribute("elementident");
          var val = node.getAttribute("elementvalue");
          if (arg && api.regionFromAttrs) {
            // ONLY private elementvalue — parent group text copies Brest 31% onto all paths.
            var hit = api.regionFromAttrs(arg, val || "");
            if (hit) {
              hit.fromValueAttr = !!(val && String(val).replace(/\s/g, ""));
              fromAttrs.push(hit);
            }
          }
        }
        // Only leaf text nodes — div/span textContent concatenates the whole map
        // into one mega-line (Брестская…Гомельская…) and invents fake regions.
        if (tag !== "text" && tag !== "tspan" && tag !== "title") continue;
        if (node.getElementsByTagName && node.getElementsByTagName("tspan").length)
          continue;
        pushLine(node.textContent);
        if (node.getAttribute && node.getAttribute("text"))
          pushLine(node.getAttribute("text"));
      }
    }
    walkRoot(domEl);
    var labeled = api.pairRegionLabels(lines);
    if (typeof api.sanitizeMapRegions === "function") {
      return api.sanitizeMapRegions(fromAttrs, labeled, {
        labelsMustBePainted: true,
      });
    }
    if (typeof api.mergeRegionLists === "function") {
      return api.mergeRegionLists(fromAttrs, labeled, {
        allowNew: !fromAttrs.length,
      });
    }
    return fromAttrs.length ? fromAttrs : labeled;
  }

  function buttonLeafText(el) {
    if (!el || !el.querySelectorAll) return null;
    var nodes = el.querySelectorAll("div, span, text, tspan");
    var best = "";
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].children && nodes[i].children.length) continue;
      var t = String(nodes[i].textContent || "").replace(/\s+/g, " ").trim();
      if (!t || t.length > 40) continue;
      if (!best || t.length < best.length) best = t;
    }
    return best || null;
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
      var comp = domEl.element;
      if (comp && typeof comp === "object") {
        if (comp.text && out.text == null) out.text = String(comp.text);
        if (comp.checked !== undefined) out.checked = !!comp.checked;
        if (comp.group) out.group = String(comp.group);
      }
      if (type.indexOf("Button") >= 0 && (out.text == null || out.text === "")) {
        var leaf = buttonLeafText(domEl);
        if (leaf) out.text = leaf;
      }
      if (attrs.group && !out.group) out.group = String(attrs.group);
      if (ca.group && !out.group) out.group = String(ca.group);
      // Short label only — not a full table dump
      var vt = visibleText(domEl, 160);
      if (vt && out.text == null && out.value == null) out.text = vt;
      if (type === "StiRegionMapElement" || type === "StiOnlineMapElement") {
        var regions = captureMapRegions(domEl);
        if (regions.length) {
          out.regions = regions;
          out.columns = ["name", "amount", "percent", "value"];
          out.rows = regions;
          out.row_count = regions.length;
          out.capture = "map_labels";
          out.text =
            regions
              .filter(function (r) {
                return r && (r.amount || r.percent);
              })
              .map(function (r) {
                return (
                  r.name +
                  (r.amount ? " " + r.amount : "") +
                  (r.percent ? " " + r.percent : "")
                );
              })
              .join("; ")
              .slice(0, 500);
        }
      }
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
    var dashboard = collectDashboardFilters(
      elements,
      interaction || lastInteractionDump
    );
    // Breadcrumb after DashboardDrillDown: "Брестская область", "ИМНС по Пинскому р-ну"
    elements.forEach(function (el) {
      if (!el || String(el.type).indexOf("Text") < 0) return;
      var t = String(el.text || "")
        .replace(/\s+/g, " ")
        .trim();
      if (!t || t === "/" || t.length > 80) return;
      if (!/област|р-н|р-ну|район|ИМНС/i.test(t)) return;
      dashboard.push({ path: "drill", value: t, condition: "EqualTo" });
    });
    return {
      captured_at: new Date().toISOString(),
      interaction: interaction || lastInteractionDump || null,
      filters: {
        panel: panel,
        dashboard: dashboard,
      },
      elements: elements,
    };
  }

  function postViewportAndCompare() {
    var vp = snapshotViewport(lastInteractionDump);
    enrichViewportTables(vp)
      .then(function (enriched) {
        if (window.console && console.log) {
          console.log(
            "[viewport]",
            enriched.elements.length,
            "elements",
            enriched
          );
        }
        return fetch("/api/viewport", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(enriched),
          cache: "no-store",
        });
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
      if (args && args.report) rememberStiReport(args.report);
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
  window.dashEnrichViewportTables = enrichViewportTables;
  window.dashExportTableElementAsync = exportTableElementAsync;
  window.dashShowStructure = postViewportAndStructure;
  window.dashRunAtlasAuto = runAtlasAuto;
  window.dashAtlasAddSnapshot = dashAtlasAddSnapshot;

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
