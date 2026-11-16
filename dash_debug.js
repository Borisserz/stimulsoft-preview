/* Viewer interaction dump: click → overlay + POST /api/params */
(function () {
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
    var out = {
      __keys: [],
      __knownActions: ACTIONS,
    };
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
    // на случай non-enumerable / пропущенных полей из доки
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

  function flattenParams(args) {
    var params = {};
    function put(name, value) {
      if (name == null || name === "") return;
      params[String(name)] = value;
    }
    function walk(src, prefix) {
      if (src == null) return;
      if (Array.isArray(src)) {
        src.forEach(function (item, idx) {
          if (item && typeof item === "object") {
            if (item.name != null) put(item.name, item.value);
            else if (prefix) put(prefix + "[" + idx + "]", item);
            else walk(item, prefix);
          } else if (prefix) {
            put(prefix + "[" + idx + "]", item);
          }
        });
        return;
      }
      if (typeof src !== "object") {
        if (prefix) put(prefix, src);
        return;
      }
      Object.keys(src).forEach(function (k) {
        var v = src[k];
        if (v && typeof v === "object" && "value" in v && !Array.isArray(v)) {
          put(prefix ? prefix + "." + k : k, v.value);
        } else if (v && typeof v === "object" && !Array.isArray(v)) {
          // плоские поля Stimulsoft (ComponentName, DataBand, …)
          var nestedKeys = Object.keys(v);
          var looksNested = nestedKeys.some(function (nk) {
            return v[nk] && typeof v[nk] === "object";
          });
          if (!looksNested && nestedKeys.length && nestedKeys.length <= 12) {
            nestedKeys.forEach(function (nk) {
              put((prefix ? prefix + "." : "") + k + "." + nk, v[nk]);
            });
          } else {
            put(prefix ? prefix + "." + k : k, v);
          }
        } else {
          put(prefix ? prefix + "." + k : k, v);
        }
      });
    }
    PARAM_BAGS.forEach(function (bag) {
      walk(args[bag], bag === "variables" ? "" : bag);
    });
    if (args.action) put("__action", args.action);
    return params;
  }

  var llmPackTimer = null;
  var lastInteractionDump = null;

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
      "display:flex;align-items:center;gap:8px;padding:8px 10px;background:#111827;border-bottom:1px solid #334155;cursor:move;user-select:none;flex-wrap:wrap;";
    head.innerHTML =
      '<strong style="color:#86efac">llm-pack</strong>' +
      '<span id="dash-interaction-action" style="color:#93c5fd"></span>' +
      '<span id="dash-interaction-meta" style="color:#94a3b8"></span>' +
      '<span style="margin-left:auto;color:#94a3b8">filters + results</span>' +
      '<button type="button" id="dash-interaction-refresh" style="background:#1f2937;color:#e2e8f0;border:1px solid #475569;padding:2px 8px;cursor:pointer">refresh</button>' +
      '<button type="button" id="dash-interaction-clear" style="background:#1f2937;color:#e2e8f0;border:1px solid #475569;padding:2px 8px;cursor:pointer">clear</button>' +
      '<button type="button" id="dash-interaction-hide" style="background:#1f2937;color:#e2e8f0;border:1px solid #475569;padding:2px 8px;cursor:pointer">hide</button>';
    var pre = document.createElement("pre");
    pre.id = "dash-interaction-pre";
    pre.style.cssText =
      "margin:0;padding:10px;overflow:auto;flex:1;white-space:pre-wrap;word-break:break-word;color:#bbf7d0;";
    pre.textContent =
      "Кликай карту / кнопки / фильтры — сюда придёт JSON для LLM:\n" +
      "{ filters, interaction, results }\n\n" +
      "results = данные всех датасорсов после Stimulsoft (без SQL).";
    el.appendChild(head);
    el.appendChild(pre);
    // не в body: Stimulsoft при start() может переписать body
    (document.documentElement || document.body).appendChild(el);
    document.getElementById("dash-interaction-hide").onclick = function () {
      el.style.display = "none";
    };
    document.getElementById("dash-interaction-clear").onclick = function () {
      pre.textContent = "";
      lastInteractionDump = null;
      fetch("/api/params", { method: "DELETE" })
        .then(function () {
          return refreshLlmPack(0);
        })
        .catch(function () {});
    };
    document.getElementById("dash-interaction-refresh").onclick = function () {
      refreshLlmPack(0);
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
      var nResults = pack && pack.results ? Object.keys(pack.results).length : 0;
      var nRows = 0;
      if (pack && pack.results) {
        Object.keys(pack.results).forEach(function (k) {
          var r = pack.results[k];
          if (r && typeof r.row_count === "number") nRows += r.row_count;
        });
      }
      metaEl.textContent =
        "filters=" + nFilters + " sources=" + nResults + " rows=" + nRows;
    }
    var pre = document.getElementById("dash-interaction-pre");
    if (pre) pre.textContent = JSON.stringify(pack, null, 2);
    window.__llmPack = pack;
  }

  function refreshLlmPack(delayMs) {
    if (llmPackTimer) clearTimeout(llmPackTimer);
    llmPackTimer = setTimeout(function () {
      fetch("/api/llm-pack")
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
              error: "llm-pack is not JSON",
              http_status: res.status,
              body_preview: String(res.text || "").slice(0, 500),
            });
            return;
          }
          showPack(pack);
          if (window.console && console.log) {
            console.log("[llm-pack]", pack);
          }
        })
        .catch(function (e) {
          if (window.console && console.error) console.error(e);
          showPack({ error: String(e) });
        });
    }, typeof delayMs === "number" ? delayMs : 600);
  }

  window.dashCaptureInteraction = function (args) {
    try {
      var dump = dumpArgs(args);
      var params = flattenParams(args);
      lastInteractionDump = dump;
      ensurePanel();
      var actionEl = document.getElementById("dash-interaction-action");
      if (actionEl) actionEl.textContent = dump.action || "(no action)";
      if (window.console && console.log) {
        console.log("[dash interaction]", dump.action, dump);
      }
      fetch("/api/params", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          params: params,
          interaction: dump,
        }),
      })
        .then(function () {
          // ждём пересчёт запросов после клика по карте/кнопкам
          refreshLlmPack(700);
        })
        .catch(function () {
          refreshLlmPack(700);
        });
    } catch (e) {
      if (window.console && console.error) console.error(e);
    }
  };

  window.dashRefreshLlmPack = refreshLlmPack;

  // панель сразу + первый pack после загрузки дашборда
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