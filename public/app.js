(async function () {
  const bar = document.getElementById("bar");
  const status = await fetch("/api/status").then((response) => response.json());

  const notes = [];
  if (!status.hasLicense) notes.push("Нет ключа. Положи оба ключа в local/license.key и перезапусти.");
  else if (status.licenseKind === "dashboards") notes.push("Сборка 7. Подставлен ключ Dashboards.");
  else if (status.licenseKind === "reports") notes.push("В файле только ключ Reports. Для дашборда нужен ещё STIMULSOFT_DASHBOARDS_LICENSE_KEY.");
  if (!status.hasReport) notes.push("Нет отчёта. Положи .mrt в local/dashboard.mrt и перезапусти.");
  if (status.versionWarning) notes.push(status.versionWarning);
  if (!notes.length) {
    notes.push("Stimulsoft 2024.2.6. Вложенные {переменные} внутри формулы читаются как имя переменной.");
  }
  bar.textContent = notes.join(" ");
  if (status.versionWarning) bar.className = "bad";
  else if (!status.hasReport || !status.hasLicense || status.licenseKind === "reports") bar.className = "warn";

  if (status.hasLicense) {
    const key = await fetch("/api/license").then((response) => response.text());
    Stimulsoft.Base.StiLicense.key = key.trim();
  }

  Stimulsoft.StiOptions.WebServer.url = status.adapterUrl;
  Stimulsoft.StiOptions.WebServer.checkDataAdaptersVersion = true;
  rememberParserErrors();

  let report;
  if (status.hasReport) {
    const text = await fetch("/report.mrt").then((response) => response.text());
    report = new Stimulsoft.Report.StiReport();
    report.load(text);
  } else {
    report = Stimulsoft.Report.StiReport.createNewDashboard();
  }

  const options = new Stimulsoft.Designer.StiDesignerOptions();
  const designer = new Stimulsoft.Designer.StiDesigner(options, "StiDesigner", false);
  const designerProto = designer.jsObject && Object.getPrototypeOf(designer.jsObject);
  if (designerProto && designerProto.GetCustomFontsCssText) {
    const fontCss = designerProto.GetCustomFontsCssText;
    designerProto.GetCustomFontsCssText = function (url, family) {
      if (url == null || url === "null" || url === "") return "";
      return fontCss.apply(this, arguments);
    };
  }
  designer.report = report;
  designer.renderHtml("designer");
  const viewer = designer.jsObject && designer.jsObject.options && designer.jsObject.options.viewer;
  const viewerJs = viewer && viewer.jsObject;
  const viewerProto = viewerJs && Object.getPrototypeOf(viewerJs);
  if (viewerProto && viewerProto.AddDashboardElementToPage && !viewerProto.__paintGuarded) {
    viewerProto.__paintGuarded = true;
    const paintHtml = viewerProto.InsertHTMLContentToDashboardElement;
    if (paintHtml) {
      viewerProto.InsertHTMLContentToDashboardElement = function (el, html, url, done) {
        const result = paintHtml.apply(this, arguments);
        if (el && el.frame && html && !url) {
          try {
            el.frame.srcdoc = html;
          } catch (err) {
            console.error(err);
          }
        }
        return result;
      };
    }
    const paintElement = viewerProto.AddDashboardElementToPage;
    viewerProto.AddDashboardElementToPage = function (host, attrs) {
      try {
        if (attrs) {
          if (typeof attrs.margin !== "string") attrs.margin = "0,0,0,0";
          if (typeof attrs.padding !== "string") attrs.padding = "0,0,0,0";
          if (!attrs.contentAttributes) attrs.contentAttributes = { interaction: {}, userViewStates: [] };
        }
        return paintElement.apply(this, arguments);
      } catch (err) {
        const name = attrs && (attrs.name || attrs.type) ? attrs.name || attrs.type : "блок";
        const message = err && err.message ? err.message : String(err);
        console.error(name + " не нарисован: " + message);
        const bar = document.getElementById("bar");
        bar.className = "bad";
        bar.textContent = "Сборка 7. " + name + " не нарисован: " + message;
      }
    };
  }
  function matchingBrace(text, open) {
    let depth = 0;
    let quote = false;
    for (let i = open; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === "\\") {
          i++;
          continue;
        }
        if (c === '"') quote = false;
        continue;
      }
      if (c === '"') {
        quote = true;
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  function replaceNestedNames(inner) {
    let out = "";
    let quote = false;
    for (let i = 0; i < inner.length; i++) {
      const c = inner[i];
      if (quote) {
        out += c;
        if (c === "\\") {
          out += inner[++i] || "";
          continue;
        }
        if (c === '"') quote = false;
        continue;
      }
      if (c === '"') {
        quote = true;
        out += c;
        continue;
      }
      if (c === "{") {
        const end = matchingBrace(inner, i);
        const name = end > i ? inner.slice(i + 1, end) : "";
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
          out += name;
          i = end;
          continue;
        }
      }
      out += c;
    }
    return out;
  }

  function unwrapNestedVariableBraces(text) {
    if (!text || text.indexOf("{") < 0) return text;
    let out = "";
    for (let i = 0; i < text.length; ) {
      const open = text.indexOf("{", i);
      if (open < 0) {
        out += text.slice(i);
        break;
      }
      out += text.slice(i, open);
      const end = matchingBrace(text, open);
      if (end < 0) {
        out += text.slice(open);
        break;
      }
      const inner = text.slice(open + 1, end);
      out += "{" + (inner.indexOf("{") >= 0 ? replaceNestedNames(inner) : inner) + "}";
      i = end + 1;
    }
    return out;
  }

  function rememberParserErrors() {
    const seen = new Set();
    const lines = [];
    const show = (line) => {
      line = "Сборка 7. " + line;
      if (seen.has(line)) return;
      seen.add(line);
      lines.push(line);
      console.error(line);
      bar.className = "bad";
      bar.textContent = lines.slice(0, 3).join("  ·  ");
    };

    const blankGif = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
    if (src && src.set && src.get) {
      Object.defineProperty(HTMLImageElement.prototype, "src", {
        configurable: true,
        enumerable: src.enumerable,
        get: src.get,
        set(value) {
          if (value == null || value === "null") {
            show("Картинка без адреса. Подставлена пустая, страница собирается дальше.");
            value = blankGif;
          }
          return src.set.call(this, value);
        },
      });
    }

    const Parser = Stimulsoft.Report.Engine.StiParser.StiParser;
    const parseTextValue2 = Parser.parseTextValue2;
    Parser.parseTextValue2 = function (text, component, sender, parameters) {
      if (typeof text === "string") text = unwrapNestedVariableBraces(text);
      return parseTextValue2.call(this, text, component, sender, parameters);
    };

    const Check = Stimulsoft.Report.Engine.StiParser.StiParser_Check;
    const throwError = Check.prototype.throwError;
    Check.prototype.throwError = function (code, token) {
      const expr = String(this.inputExpression || "");
      const bad = token && token.value != null && String(token.value) !== ""
        ? String(token.value)
        : token && token.valueObject != null
          ? String(token.valueObject)
          : "";
      const at = token && typeof token.position === "number" ? token.position : -1;
      const slice = at >= 0 ? expr.slice(Math.max(0, at - 60), at + 60) : expr.slice(0, 180);
      const component = this.component;
      const name = component && (component.name || component.alias) ? component.name || component.alias : "";
      show("Формула не разобралась" + (name ? " в " + name : "") + ". Место: " + (bad || "?") + ". Текст: " + slice);
      return throwError.apply(this, arguments);
    };

    function blockNote(name, message) {
      const safe = String(message).replace(/[&<>"]/g, (ch) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
      }[ch]));
      return {
        name: name,
        type: "StiTextElement",
        key: name,
        left: 8,
        top: 8,
        width: 420,
        height: 48,
        margin: "0,0,0,0",
        padding: "4,4,4,4",
        backColor: "#fff3cd",
        foreColor: "#3d3208",
        cornerRadius: "0,0,0,0",
        contentAttributes: {
          text: message,
          svgContent: `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="48"><text x="6" y="28" font-size="14" fill="#3d3208">${safe}</text></svg>`,
          interaction: {},
          userViewStates: [],
        },
      };
    }

    const Helper = Stimulsoft.Viewer.StiReportHelper;
    const getDashboardPageAsync = Helper.getDashboardPageAsync;
    Helper.getDashboardPageAsync = function (report, pageIndex, request) {
      if (request) {
        if (!(Number(request.dashboardWidth) > 80)) request.dashboardWidth = 1200;
        if (!(Number(request.dashboardHeight) > 80)) request.dashboardHeight = 760;
      }
      console.log("dashboard request", request && request.dashboardWidth, request && request.dashboardHeight);
      const result = getDashboardPageAsync.apply(this, arguments);
      if (result && typeof result.try === "function") {
        result.try((page) => {
          try {
            const list = page && page.elements ? page.elements : [];
            const first = list[0];
            const content = first && first.contentAttributes ? first.contentAttributes : {};
            const picture = first
              ? (first.name || first.type)
                + (content.htmlContent ? " html " + content.htmlContent.length : "")
                + (content.svgContent ? " svg " + content.svgContent.length : "")
                + (!content.htmlContent && !content.svgContent ? " без картинки" : "")
              : "";
            const line = "Страница " + (page && page.width) + "×" + (page && page.height)
              + ", блоков " + list.length
              + (picture ? ". " + picture : "");
            const pictures = list.map((item) => {
              const content = item.contentAttributes || {};
              return {
                left: item.left,
                top: item.top,
                width: item.width,
                height: item.height,
                backColor: item.backColor,
                html: content.htmlContent || "",
                svg: content.svgContent || "",
              };
            });
            console.log(line);
            if (bar.className !== "bad") {
              bar.className = list.length ? "" : "bad";
              bar.textContent = "Сборка 7. " + line;
            }
            setTimeout(() => {
              const node = [...document.querySelectorAll(".stiJsViewerPage")].find((item) => item.offsetWidth > 0);
              const htmls = pictures.filter((item) => item.html);
              if (node && !node.querySelector("iframe, svg") && pictures.length) {
                pictures.forEach((item) => {
                  if (!(item.width > 0) || !(item.height > 0)) return;
                  const el = document.createElement("div");
                  el.style.cssText = "position:absolute;overflow:hidden;box-sizing:border-box;left:"
                    + item.left + "px;top:" + item.top + "px;width:" + item.width + "px;height:" + item.height + "px;"
                    + (item.backColor ? "background:" + item.backColor + ";" : "");
                  if (item.html) {
                    const frame = document.createElement("iframe");
                    frame.style.cssText = "border:0;width:100%;height:100%";
                    frame.srcdoc = item.html;
                    el.appendChild(frame);
                  } else if (item.svg) {
                    el.innerHTML = item.svg;
                  }
                  node.appendChild(el);
                });
              } else if (node) {
                [...node.querySelectorAll("iframe")].forEach((frame, index) => {
                  if (frame.getAttribute("srcdoc") || !htmls[index]) return;
                  let filled = false;
                  try {
                    const body = frame.contentDocument && frame.contentDocument.body;
                    filled = !!(body && body.childElementCount > 1);
                  } catch (err) {
                    filled = false;
                  }
                  if (!filled) frame.srcdoc = htmls[index].html;
                });
              }
              const frames = node ? node.querySelectorAll("iframe").length : 0;
              const svgs = node ? node.querySelectorAll("svg").length : 0;
              const seen = "На экране iframe " + frames + ", svg " + svgs;
              console.log(seen);
              if (bar.className !== "bad") bar.textContent += ". " + seen;
            }, 300);
          } catch (err) {
            show(err && err.message ? err.message : String(err));
          }
        });
        return result;
      }
      show("Страница вернулась без ожидания результата.");
      return result;
    };

    const getElementAttributesAsync = Helper.getElementAttributesAsync;
    Helper.getElementAttributesAsync = function (page, element, single, request) {
      const name = element && (element.name || element.alias) ? element.name || element.alias : "блок";
      console.log("блок", name);
      let pending;
      try {
        pending = getElementAttributesAsync.apply(this, arguments);
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        show(name + ": " + message);
        return blockNote(name, name + ": " + message);
      }
      let timer;
      const timeout = new Promise((resolve) => {
        timer = setTimeout(() => {
          const message = name + ": не собрался за 25 с";
          show(message);
          resolve(blockNote(name, message));
        }, 25000);
      });
      const run = Promise.resolve(pending).then(
        (value) => {
          clearTimeout(timer);
          return value;
        },
        (err) => {
          clearTimeout(timer);
          const message = err && err.message ? err.message : String(err);
          show(name + ": " + message);
          return blockNote(name, name + ": " + message);
        }
      );
      return Promise.race([run, timeout]);
    };

    window.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason;
      const message = reason && reason.message ? reason.message : String(reason);
      show(message);
    });

    const showError = Stimulsoft.System.StiError.showError;
    Stimulsoft.System.StiError.showError = function (error) {
      const message = error && error.message ? String(error.message) : String(error || "");
      if (message && message.indexOf("Parser error") !== 0) show(message);
      return showError.apply(this, arguments);
    };
  }
})().catch((err) => {
  const bar = document.getElementById("bar");
  bar.className = "bad";
  bar.textContent = "Дизайнер не поднялся: " + (err && err.message ? err.message : err);
  console.error(err);
});
