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
    notes.push("Stimulsoft 2024.2.6. Кнопка просмотра шлёт запросы в адаптер на порту 9615.");
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

    const Check = Stimulsoft.Report.Engine.StiParser.StiParser_Check;
    const throwError = Check.prototype.throwError;
    Check.prototype.throwError = function (code, token) {
      const expr = String(this.inputExpression || "");
      const bad = token && token.value != null ? String(token.value) : "";
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
