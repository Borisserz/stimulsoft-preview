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
  ];

  var PARAM_BAGS = [
    "variables",
    "filteringParameters",
    "sortingParameters",
    "collapsingParameters",
    "drillDownParameters",
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
      "filteringParameters",
      "data",
    ].forEach(function (k) {
      if (!(k in out) && args[k] !== undefined) {
        out[k] = k === "report" ? "[StiReport]" : safeClone(args[k]);
        out.__keys.push(k);
      }
    });
    return out;
  }

  function isRealFilterKey(name) {
    if (name == null || name === "") return false;
    var s = String(name);
    if (s.indexOf("__") === 0) return false;
    if (/^\d+$/.test(s)) return false;
    return /^[A-Za-z_]/.test(s);
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
    PARAM_BAGS.forEach(function (bag) {
      walk(args[bag]);
    });
    // also top-level variables map if present
    if (args && args.variables) walk(args.variables);
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
      "Click map / top buttons / filters.\n" +
      "Panel: llm-pack JSON.\n" +
      "Press verify: filters vs applied query params vs freshness.\n" +
      "Header sources/rows must change after Year/Month change.";
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

  function showPack(pack) {
    var el = ensurePanel();
    el.style.display = "flex";
    var actionEl = document.getElementById("dash-interaction-action");
    var metaEl = document.getElementById("dash-interaction-meta");
    var inter = pack && pack.interaction;
    if (actionEl) {
      actionEl.textContent =
        (inter && (inter.action || inter.event)) || "(no interaction)";
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
        // /api/verify payload
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
        pre.textContent = JSON.stringify(pack, null, 2);
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
        showPack(pack);
        if (window.console && console.log) console.log("[llm-pack]", pack);
      });
    }, typeof delayMs === "number" ? delayMs : 600);
  }

  function refreshVerify(delayMs) {
    if (llmPackTimer) clearTimeout(llmPackTimer);
    llmPackTimer = setTimeout(function () {
      fetchJson("/api/verify", function (rep) {
        showPack(rep);
        var actionEl = document.getElementById("dash-interaction-action");
        if (actionEl) actionEl.textContent = rep.ok ? "VERIFY OK" : "VERIFY FAIL";
        if (window.console && console.log) console.log("[verify]", rep);
      });
    }, typeof delayMs === "number" ? delayMs : 0);
  }

  window.dashCaptureInteraction = function (args) {
    try {
      var dump = dumpArgs(args);
      var params = flattenParams(args);
      ensurePanel();
      var actionEl = document.getElementById("dash-interaction-action");
      if (actionEl) actionEl.textContent = dump.action || "(no action)";
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
          refreshLlmPack(800);
        })
        .catch(function () {
          refreshLlmPack(800);
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
