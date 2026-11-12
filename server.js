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
const dbEnvPath = path.join(localDir, "db.env");

const scripts = {
  "/scripts/stimulsoft.reports.js": path.join(
    root,
    "node_modules/stimulsoft-reports-js/Scripts/stimulsoft.reports.js"
  ),
  "/scripts/stimulsoft.reports.maps.js": path.join(
    root,
    "node_modules/stimulsoft-reports-js/Scripts/stimulsoft.reports.maps.js"
  ),
  "/scripts/stimulsoft.reports.chart.js": path.join(
    root,
    "node_modules/stimulsoft-reports-js/Scripts/stimulsoft.reports.chart.js"
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

const EMPTY_GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

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
  if (url.pathname === "/null") {
    console.log("[http] empty image " + req.method + " /null");
    send(res, 200, EMPTY_GIF, "image/gif");
    return;
  }
  console.log("[http] 404 " + req.method + " " + url.pathname);
  send(res, 404, "not found", "text/plain; charset=utf-8");
});

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim().toLowerCase();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function readDbEnv() {
  let text = "";
  try {
    text = fs.readFileSync(dbEnvPath, "utf8");
  } catch {
    return null;
  }
  const env = parseEnv(text);
  let host = env.host || env.server || "";
  let port = env.port || "5432";
  let database = env.database || env.db || "";
  const url = env.url || "";
  const jdbc = url.match(/postgres(?:ql)?:\/\/([^/:]+)(?::(\d+))?\/([^?]+)/i);
  if (jdbc) {
    host = host || jdbc[1];
    port = env.port || jdbc[2] || port;
    database = database || decodeURIComponent(jdbc[3]);
  }
  const user = env.user || env.username || env.uid || "";
  const password = env.password || env.pwd || "";
  const ssl = (env.ssl || env.sslmode || "disable").toLowerCase();
  if (!host || !database || !user) {
    return { error: "в local/db.env нужны HOST, DATABASE и USER, как на вкладке Main в DBeaver" };
  }
  return { host, port, database, user, password, ssl };
}

function postgresUrl(db) {
  const sslmode = db.ssl === "require" || db.ssl === "true" || db.ssl === "1" ? "no-verify" : db.ssl === "prefer" ? "prefer" : "disable";
  return `postgres://${encodeURIComponent(db.user)}:${encodeURIComponent(db.password)}@${db.host}:${db.port}/${encodeURIComponent(db.database)}?sslmode=${sslmode}`;
}

function applyDbEnv(command) {
  if (!command || command.database !== "PostgreSQL") return "";
  const db = readDbEnv();
  if (!db) return "нет local/db.env, строка подключения берётся из mrt";
  if (db.error) return db.error;
  command.connectionString = postgresUrl(db);
  return `Postgres ${db.host}:${db.port} / ${db.database} user=${db.user}`;
}

function adapterLine(command, result) {
  const info = (command && command.connectionStringInfo) || {};
  const where = [
    info.host || "без host",
    info.port ? ":" + info.port : "",
    info.database ? " / " + info.database : "",
    info.user ? " user=" + info.user : "",
  ].join("");
  let detail = "fail";
  if (result && result.success) detail = "ok";
  else if (result && result.notice) {
    detail = String(result.notice).split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "fail";
  } else if (result) {
    const copy = { ...result };
    delete copy.rows;
    delete copy.columns;
    detail = JSON.stringify(copy);
  }
  if (detail.length > 300) detail = detail.slice(0, 300);
  return `[adapter] ${command.command || "?"} ${command.database || ""} ${where} ${detail}`;
}

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
      console.log("[adapter] 404 " + req.method + " " + (req.url || "/"));
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      const command = adapter.getCommand(data);
      const dbNote = applyDbEnv(command);
      if (dbNote && !dbNote.startsWith("Postgres")) console.log("[db] " + dbNote);
      adapter.process(command, (result) => {
        console.log(adapterLine(command, result));
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
    const db = readDbEnv();
    if (!db) console.log(`База      ${dbEnvPath}  (файла нет, Postgres берётся из mrt)`);
    else if (db.error) console.log(`База      ${db.error}`);
    else console.log(`База      ${db.host}:${db.port} / ${db.database} user=${db.user}`);
    if (info.versionWarning) console.log(info.versionWarning);
  });
});
