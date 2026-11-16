/* Отладка viewer: блоки и кнопки на странице + stub для onInteraction. */
(function () {
  "use strict";

  function textOf(el) {
    return (el.innerText || el.textContent || el.value || el.title || el.getAttribute("aria-label") || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
  }

  function collect() {
    var root =
      document.querySelector(".stiJsViewerMainPanel") ||
      document.querySelector(".stiDashboardPanel") ||
      document.querySelector("#stiViewer") ||
      document.body;

    var blocks = [];
    root.querySelectorAll(
      "[data-sti-component], .stiDashboardElement, .stiJsViewerDashboardElement, .stiElement, .stiBlock"
    ).forEach(function (el, i) {
      blocks.push({
        i: i,
        tag: el.tagName,
        id: el.id || "",
        className: String(el.className || "").slice(0, 160),
        name: el.getAttribute("data-sti-component") || el.getAttribute("name") || "",
        text: textOf(el),
      });
    });

    var buttons = [];
    root.querySelectorAll(
      "button, [role='button'], input[type='button'], input[type='submit'], .stiButton, .stiToolButton"
    ).forEach(function (el, i) {
      buttons.push({
        i: i,
        tag: el.tagName,
        id: el.id || "",
        className: String(el.className || "").slice(0, 160),
        type: el.getAttribute("type") || "",
        text: textOf(el),
      });
    });

    return { blocks: blocks, buttons: buttons, blocks_count: blocks.length, buttons_count: buttons.length };
  }

  function paint(data) {
    var id = "dash-debug-panel";
    var panel = document.getElementById(id);
    if (!panel) {
      panel = document.createElement("div");
      panel.id = id;
      panel.style.cssText =
        "position:fixed;z-index:999999;right:8px;bottom:8px;max-width:420px;max-height:45vh;overflow:auto;" +
        "background:#111c;color:#e8ffe8;font:12px/1.35 ui-monospace,Menlo,monospace;padding:10px 12px;" +
        "border:1px solid #3a5;border-radius:8px;backdrop-filter:blur(4px);";
      document.documentElement.appendChild(panel);
    }
    var lines = ["blocks=" + data.blocks_count + " buttons=" + data.buttons_count, "", "— blocks —"];
    data.blocks.slice(0, 80).forEach(function (b) {
      lines.push("#" + b.i + " " + (b.name || b.id || b.className) + (b.text ? " | " + b.text : ""));
    });
    lines.push("", "— buttons —");
    data.buttons.slice(0, 80).forEach(function (b) {
      lines.push("#" + b.i + " " + (b.text || b.id || b.className));
    });
    panel.textContent = lines.join("\n");
  }

  function run() {
    var data = collect();
    window.__dashDebug = data;
    paint(data);
    console.log("[dash-debug]", data);
  }

  window.dashDumpBlocksAndButtons = run;
  window.dashCaptureInteraction = function (args) {
    try {
      var dump = args && typeof args === "object" ? Object.assign({ __keys: Object.keys(args) }, args) : { raw: args };
      fetch("/api/params", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interaction: dump }),
      }).catch(function () {});
    } catch (e) {}
    setTimeout(run, 300);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      setTimeout(run, 800);
      setTimeout(run, 2500);
    });
  } else {
    setTimeout(run, 800);
    setTimeout(run, 2500);
  }
})();
