const http = require("http");
const fs = require("fs");
const path = require("path");
const adapter = require("stimulsoft-data-adapter");

const root = __dirname;
const localDir = path.join(root, "local");
const pagePort = Number(process.env.PORT || 8080);
const adapterPort = Number(process.env.ADAPTER_PORT || 9615);
const pageHost = "127.0.0.1";
const reportPath = process.env.REPORT_PATH || path.join(localDir, "dashboard.mrt");
const licensePath = process.env.LICENSE_PATH || path.join(localDir, "license.key");

const scripts = {
  "/scripts/stimulsoft.reports.js": path.join(
    root,
    "node_modules/stimulsoft-reports-js/Scripts/stimulsoft.reports.js"
  ),
  "/scripts/stimulsoft.reports.maps.js": path.join(
    root,
    "node_modules/stimulsoft-reports-js/Scripts/stimulsoft.reports.maps.js"
  ),
  "/scripts/stimulsoft.dashboards.js": path.join(
    root,
    "node_modules/stimulsoft-dashboards-js/Scripts/stimulsoft.dashboards.js"
  ),
  "/scripts/stimulsoft.viewer.js": path.join(
    root,
    "node_modules/stimulsoft-dashboards-js/Scripts/stimulsoft.viewer.js"
  ),
  "/scripts/stimulsoft.designer.js": path.join(
    root,
    "node_modules/stimulsoft-dashboards-js/Scripts/stimulsoft.designer.js"
  ),
};

fs.mkdirSync(localDir, { recursive: true });

function readLicenseFile() {
  try {
    return fs.readFileSync(licensePath, "utf8");
  } catch {
    return "";
  }
}

function parseLicense(text) {
  const keys = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^(?:STIMULSOFT_)?([A-Z0-9_]*LICENSE_KEY)\s*=\s*(.+)$/i);
    if (!match) continue;
    const name = match[1].toUpperCase().startsWith("STIMULSOFT_")
      ? match[1].toUpperCase()
      : "STIMULSOFT_" + match[1].toUpperCase();
    keys[name] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  if (Object.keys(keys).length) return keys;
  const raw = text.replace(/^\uFEFF/, "").trim();
  return raw ? { RAW: raw } : {};
}

function chosenLicense(keys) {
  if (keys.STIMULSOFT_DASHBOARDS_LICENSE_KEY) {
    return { kind: "dashboards", key: keys.STIMULSOFT_DASHBOARDS_LICENSE_KEY };
  }
  if (keys.STIMULSOFT_REPORTS_LICENSE_KEY) {
    return { kind: "reports", key: keys.STIMULSOFT_REPORTS_LICENSE_KEY };
  }
  if (keys.RAW) return { kind: "raw", key: keys.RAW };
  return { kind: "", key: "" };
}

function readVersion(file) {
  let text = "";
  try {
    text = fs.readFileSync(file).subarray(0, 12000).toString("utf8");
  } catch {
    return { reportVersion: "", engineVersion: "" };
  }
  const grab = (name) => {
    const patterns = [
      new RegExp(`"${name}"\\s*:\\s*"([^"]*)"`),
      new RegExp(`${name}="([^"]*)"`),
      new RegExp(`<${name}>([^<]*)</${name}>`),
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[1].trim();
    }
    return "";
  };
  return {
    reportVersion: grab("ReportVersion"),
    engineVersion: grab("EngineVersion"),
  };
}

function versionWarning(versions) {
  const blob = `${versions.reportVersion} ${versions.engineVersion}`;
  if (/202[5-9]/.test(blob)) {
    return `В файле версия ${versions.engineVersion || versions.reportVersion}. Движок этой страницы — 2024.2.6, шаблон новее он может открыть пустым. Нужна копия, которую прод ещё отдаёт на 2024, до сохранения в дизайнере 2026.`;
  }
  return "";
}

function status() {
  const hasReport = fs.existsSync(reportPath);
  const license = chosenLicense(parseLicense(readLicenseFile()));
  const versions = hasReport ? readVersion(reportPath) : { reportVersion: "", engineVersion: "" };
  return {
    node: process.versions.node,
    hasReport,
    hasLicense: Boolean(license.key),
    licenseKind: license.kind,
    reportFile: path.basename(reportPath),
    reportVersion: versions.reportVersion,
    engineVersion: versions.engineVersion,
    versionWarning: hasReport ? versionWarning(versions) : "",
    adapterUrl: `http://${pageHost}:${adapterPort}`,
    product: "2024.2.6",
  };
}

function send(res, code, body, type) {
  res.writeHead(code, {
    "Content-Type": type,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function serveFile(res, file, type) {
  fs.readFile(file, (err, data) => {
    if (err) {
      send(res, 404, "not found", "text/plain; charset=utf-8");
      return;
    }
    send(res, 200, data, type);
  });
}

const page = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${pageHost}`);
  if (url.pathname === "/api/status") {
    send(res, 200, JSON.stringify(status()), "application/json; charset=utf-8");
    return;
  }
  if (url.pathname === "/api/license") {
    const license = chosenLicense(parseLicense(readLicenseFile()));
    if (!license.key) {
      send(res, 404, "not found", "text/plain; charset=utf-8");
      return;
    }
    send(res, 200, license.key, "text/plain; charset=utf-8");
    return;
  }
  if (url.pathname === "/report.mrt") {
    serveFile(res, reportPath, "application/octet-stream");
    return;
  }
  if (scripts[url.pathname]) {
    serveFile(res, scripts[url.pathname], "application/javascript; charset=utf-8");
    return;
  }
  if (url.pathname === "/app.js") {
    serveFile(res, path.join(root, "public/app.js"), "application/javascript; charset=utf-8");
    return;
  }
  if (url.pathname === "/" || url.pathname === "/index.html") {
    serveFile(res, path.join(root, "public/index.html"), "text/html; charset=utf-8");
    return;
  }
  send(res, 404, "not found", "text/plain; charset=utf-8");
});

function acceptAdapter(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Cache-Control", "no-cache");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const data = Buffer.concat(chunks).toString("utf8");
    if (!data) {
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      const command = adapter.getCommand(data);
      adapter.process(command, (result) => {
        const notice = result && result.success ? "ok" : (result && result.notice) || "fail";
        console.log(`[adapter] ${command.command || "?"} ${command.database || ""} ${notice}`);
        res.end(adapter.getResponse(result));
      });
    } catch (err) {
      console.error("[adapter] запрос не разобран:", err.message);
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, notice: err.message }));
    }
  });
}

const adapterServer = http.createServer(acceptAdapter);

adapterServer.listen(adapterPort, pageHost, () => {
  page.listen(pagePort, pageHost, () => {
    const info = status();
    console.log(`Дизайнер  http://${pageHost}:${pagePort}`);
    console.log(`Адаптер   ${info.adapterUrl}`);
    console.log(`Node      ${info.node}`);
    console.log(`Отчёт     ${reportPath}${info.hasReport ? "" : "  (файла нет)"}`);
    console.log(
      `Лицензия  ${licensePath}${info.hasLicense ? "  (" + info.licenseKind + ")" : "  (файла нет, будет триал)"}`
    );
    if (info.versionWarning) console.log(info.versionWarning);
  });
});
