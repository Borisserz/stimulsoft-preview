(async function () {
  const bar = document.getElementById("bar");
  const status = await fetch("/api/status").then((response) => response.json());

  const notes = [];
  if (status.nodeWarning) notes.push(status.nodeWarning);
  if (!status.hasLicense) notes.push("Нет local/license.key — это триал, не ваша лицензия 2024.");
  if (!status.hasReport) notes.push("Нет отчёта. Положи .mrt в local/dashboard.mrt и перезапусти.");
  if (status.versionWarning) notes.push(status.versionWarning);
  if (!notes.length) {
    notes.push("Stimulsoft 2024.2.6. Кнопка просмотра шлёт запросы в адаптер на порту 9615.");
  }
  bar.textContent = notes.join(" ");
  if (status.versionWarning || status.nodeWarning) bar.className = "bad";
  else if (!status.hasReport || !status.hasLicense) bar.className = "warn";

  if (status.hasLicense) {
    const key = await fetch("/api/license").then((response) => response.text());
    Stimulsoft.Base.StiLicense.key = key.trim();
  }

  Stimulsoft.StiOptions.WebServer.url = status.adapterUrl;
  Stimulsoft.StiOptions.WebServer.checkDataAdaptersVersion = true;

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
})().catch((err) => {
  const bar = document.getElementById("bar");
  bar.className = "bad";
  bar.textContent = "Дизайнер не поднялся: " + (err && err.message ? err.message : err);
  console.error(err);
});
