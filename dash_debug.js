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
    return {
      typeItem: item.typeItem != null ? item.typeItem : "FilterRule",
      key: item.key != null ? item.key : null,
      path: item.path != null ? item.path : item.columnName || item.column || null,
      condition: item.condition != null ? item.condition : "EqualTo",
      value: item.value !== undefined ? item.value : null,
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
      '<strong style="color:#86efac">llm-pack</strong>' +
      '<span id="dash-interaction-action" style="color:#93c5fd"></span>' +
      '<span id="dash-interaction-meta" style="color:#94a3b8"></span>' +
      '<span style="margin-left:auto;color:#94a3b8">filters + results</span>' +
      '<button type="button" id="dash-interaction-refresh" style="background:#1f2937;color:#e2e8f0;border:1px solid #475569;padding:2px 8px;cursor:pointer">refresh</button>' +
      '<button type="button" id="dash-interaction-verify" style="background:#1f2937;color:#e2e8f0;border:1px solid #475569;padding:2px 8px;cursor:pointer">verify</button>' +
      '<button type="button" id="dash-interaction-clear" style="background:#1f2937;color:#e2e8f0;border:1px solid #475569;padding:2px 8px;cursor:pointer">clear</button>' +
      '<button type="button" id="dash-interaction-hide" style="background:#1f2937;color:#e2e8f0;border:1px solid #475569;padding:2px 8px;cursor:pointer">hide</button>';
    var pre = document.createElement("pre");
    pre.id = "dash-interaction-pre";
    pre.style.cssText =
      "margin:0;padding:10px;overflow:auto;flex:1;white-space:pre-wrap;word-break:break-word;color:#bbf7d0;";
    pre.textContent =
      "1) Wait for dashboard load.\n" +
      "2) Press refresh — look for RESULTS DIGEST (names + numbers).\n" +
      "3) Click map/region/top buttons, wait 1s, refresh again.\n" +
      "verify = health check only (no table rows). Use refresh for data.";
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
          return refreshLlmPack(0);
        })
        .catch(function () {});
    };
    document.getElementById("dash-interaction-refresh").onclick = function () {
      refreshLlmPack(0);
    };
    document.getElementById("dash-interaction-verify").onclick = function () {
      refreshVerify(0);
    };
    return el;
  }

  function buildDigestText(pack) {
    if (!pack || !pack.results || typeof pack.results !== "object") {
      return "NO RESULTS in this payload.\nIf you pressed verify — press refresh instead.\n";
    }
    var keys = Object.keys(pack.results);
    if (!keys.length) {
      return "NO RESULTS YET — wait for queries, then refresh.\n";
    }
    var lines = ["=== RESULTS DIGEST (same numbers as SQL behind widgets) ==="];
    keys.sort().forEach(function (name) {
      var r = pack.results[name] || {};
      var rows = Array.isArray(r.rows) ? r.rows : [];
      var rc = typeof r.row_count === "number" ? r.row_count : rows.length;
      lines.push("- " + name + ": row_count=" + rc);
      rows.slice(0, 5).forEach(function (row, i) {
        try {
          lines.push("    [" + i + "] " + JSON.stringify(row));
        } catch (e) {
          lines.push("    [" + i + "] " + String(row));
        }
      });
      if (rows.length > 5) {
        lines.push("    ... +" + (rows.length - 5) + " more");
      }
    });
    lines.push("=== FULL PACK JSON below ===");
    return lines.join("\n") + "\n";
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
        actionEl.textContent = pack && pack.ok ? "VERIFY OK" : "VERIFY FAIL";
      } else {
        actionEl.textContent =
          (inter && (inter.action || inter.event)) || "(pack)";
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
      } else if (pack && Array.isArray(pack.sources)) {
        nResults = pack.sources.length;
        if (pack.result_meta) {
          Object.keys(pack.result_meta).forEach(function (k) {
            var r = pack.result_meta[k];
            if (r && typeof r.row_count === "number") nRows += r.row_count;
          });
        }
      }
      var okBit =
        pack && typeof pack.ok === "boolean" ? " ok=" + pack.ok : "";
      metaEl.textContent =
        "filters=" +
        nFilters +
        " sources=" +
        nResults +
        " rows=" +
        nRows +
        okBit;
    }
    var pre = document.getElementById("dash-interaction-pre");
    if (pre) {
      try {
        if (isVerify) {
          pre.textContent =
            "VERIFY has no table rows.\nPress refresh to see payment names/numbers.\n\n" +
            JSON.stringify(pack, null, 2);
        } else {
          pre.textContent =
            buildDigestText(pack) + JSON.stringify(pack, null, 2);
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

  function refreshLlmPack(delayMs) {
    if (llmPackTimer) clearTimeout(llmPackTimer);
    llmPackTimer = setTimeout(function () {
      fetchJson("/api/llm-pack", function (pack) {
        showPack(pack, "pack");
        if (window.console && console.log) console.log("[llm-pack]", pack);
      });
    }, typeof delayMs === "number" ? delayMs : 600);
  }

  function refreshVerify(delayMs) {
    if (llmPackTimer) clearTimeout(llmPackTimer);
    llmPackTimer = setTimeout(function () {
      fetchJson("/api/verify", function (rep) {
        showPack(rep, "verify");
        if (window.console && console.log) console.log("[verify]", rep);
      });
    }, typeof delayMs === "number" ? delayMs : 0);
  }

  function refreshAfterInteraction(action) {
    // Map filter / element drill-in are mostly client-side — poll for pack.
    // Buttons / dashboard drill-down often re-query SQL.
    var delays = [500, 1200, 2400];
    if (action === "DashboardButtonElementApplyEvents") {
      delays = [600, 1400, 2600];
    } else if (
      action === "DashboardElementDrillDown" ||
      action === "DashboardElementDrillUp" ||
      action === "DashboardDrillDown" ||
      action === "DrillDown"
    ) {
      delays = [400, 1000, 2000, 3200];
    } else if (action === "DashboardFiltering") {
      delays = [400, 1200, 2200];
    }
    delays.forEach(function (ms) {
      refreshLlmPack(ms);
    });
  }

  window.dashCaptureInteraction = function (args) {
    try {
      var dump = dumpArgs(args);
      // flatten from the cloned dump so FilterRule path/value survive
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      ensurePanel();
      refreshLlmPack(1500);
    });
  } else {
    ensurePanel();
    refreshLlmPack(1500);
  }
})();
