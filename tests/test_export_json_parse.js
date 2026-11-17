/**
 * Stimulsoft Table→JSON export → viewport rows.
 * Run: node tests/test_export_json_parse.js
 * Spec: docs/superpowers/specs/2026-11-17-hybrid-table-export-design.md
 * Source: StiDashboardExportTools.exportAsync(..., StiExportFormat.Json)
 */

var assert = require("assert");
var path = require("path");
var mod = require(path.join(__dirname, "..", "export_json_parse.js"));

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

function ok(cond, msg) {
  if (!cond) fail(msg);
}

// --- decodeExportData ---
ok(mod.decodeExportData('[{"a":1}]') === '[{"a":1}]', "string passthrough");
ok(
  mod.decodeExportData(new Uint8Array([91, 93])) === "[]",
  "Uint8Array utf-8"
);

// --- array of objects ---
var p1 = mod.parseExportJson('[{"region":"Брест","sum":1500.5},{"region":"Гродно","sum":42}]');
ok(p1, "array parse");
ok(p1.capture === "export_json", "capture tag");
ok(p1.row_count === 2, "2 rows");
ok(p1.columns.indexOf("region") >= 0 && p1.columns.indexOf("sum") >= 0, "cols");
ok(p1.rows[0].sum === 1500.5, "numeric sum kept");
ok(p1.rows[0].region === "Брест", "cyrillic");

// --- wrapped { TableName: [...] } ---
var p2 = mod.parseExportJson(
  JSON.stringify({ Payments: [{ name: "a", amount: 10 }, { name: "b", amount: 20 }] })
);
ok(p2 && p2.row_count === 2, "wrapped table");
ok(p2.rows[1].amount === 20, "wrapped amount");

// --- empty / invalid ---
ok(mod.parseExportJson(null) === null, "null");
ok(mod.parseExportJson("") === null, "empty");
ok(mod.parseExportJson("not-json") === null, "bad json");
ok(mod.parseExportJson("[]") === null || mod.parseExportJson("[]").row_count === 0, "empty arr");

// --- unique column names from union of keys ---
var p3 = mod.parseExportJson(
  '[{"a":1},{"a":2,"b":3}]'
);
ok(p3.columns.indexOf("a") >= 0 && p3.columns.indexOf("b") >= 0, "union cols");
ok(p3.rows[0].b === null || p3.rows[0].b === undefined || p3.rows[0].b === "", "missing key ok");

console.log("OK test_export_json_parse.js");
