/**
 * Flatten Stimulsoft pivot getViewerData cells → rows with amounts.
 * Run: node tests/test_pivot_viewer_data.js
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

// Minimal pivot: 1 row header col + 2 region cols, 1 header row + 2 data rows
// headerHeight=1, headerWidth=1
var viewerData = {
  headerHeight: 1,
  headerWidth: 1,
  cells: [
    [
      { text: "" },
      { text: "Брестская" },
      { text: "Минская" },
    ],
    [
      { text: "НДС" },
      { text: "1500.5" },
      { text: "300" },
    ],
    [
      { text: "Прибыль" },
      { text: "10" },
      { text: "20" },
    ],
  ],
};

var parsed = mod.parsePivotViewerData(viewerData);
ok(parsed, "parsed");
ok(parsed.capture === "pivot_viewer", "tag");
ok(parsed.row_count === 2, "2 data rows got " + parsed.row_count);
ok(parsed.columns.indexOf("Брестская") >= 0, "region col");
ok(parsed.rows[0]["Брестская"] === "1500.5" || parsed.rows[0]["Брестская"] === 1500.5, "amount");
ok(String(parsed.rows[0][parsed.columns[0]]).indexOf("НДС") >= 0, "row label");

// Reject Close-button pollution helper
ok(mod.isChromeLabel("Close") === true, "Close is chrome");
ok(mod.isChromeLabel("Брестская") === false, "region not chrome");

console.log("OK test_pivot_viewer_data.js", parsed.columns, parsed.rows);
