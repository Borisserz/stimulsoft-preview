(async function () {
  const bar = document.getElementById("bar");
  const status = await fetch("/api/status").then((response) => response.json());

  const notes = [];
  if (!status.hasLicense) notes.push("Нет ключа. Положи оба ключа в local/license.key и перезапусти.");
  else if (status.licenseKind === "dashboards") notes.push("Подставлен ключ Dashboards.");
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
  designer.report = report;
  designer.renderHtml("designer");
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
      if (seen.has(line)) return;
      seen.add(line);
      lines.push(line);
      console.error(line);
      bar.className = "bad";
      bar.textContent = lines.slice(0, 3).join("  ·  ");
    };

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
