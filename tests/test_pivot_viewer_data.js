/**
 * Stimulsoft pivot getViewerData: cells[column][row] (viewer.js headerRows loop).
 * Run: node tests/test_pivot_viewer_data.js
 */

var path = require("path");
var mod = require(path.join(__dirname, "..", "export_json_parse.js"));

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}
function ok(cond, msg) {
  if (!cond) fail(msg);
}

// Visual table:
//   Наименование | Регион    | Факт
//   НДС          | Брестская | 7 090,57
//   НДС          | Минская   | 300
// headerHeight=1 headerWidth=2, cells[col][row]
var viewerData = {
  headerHeight: 1,
  headerWidth: 2,
  cells: [
    [{ text: "Наименование платежа" }, { text: "НДС" }, { text: "НДС" }],
    [{ text: "Регион" }, { text: "Брестская" }, { text: "Минская" }],
    [{ text: "Факт (руб.)" }, { text: "7 090,57" }, { text: "300" }],
    [{ text: "Доля" }, { text: "31,0%" }, { text: "33,3%" }],
  ],
};

var parsed = mod.parsePivotViewerData(viewerData);
ok(parsed, "parsed");
ok(parsed.capture === "pivot_viewer", "tag");
ok(parsed.row_count === 2, "2 data rows got " + parsed.row_count);
ok(parsed.columns.indexOf("Регион") >= 0, "region column " + parsed.columns);
ok(parsed.columns.indexOf("Доля") >= 0, "share column");
ok(parsed.rows[0]["Регион"] === "Брестская", "brest row " + JSON.stringify(parsed.rows[0]));
ok(parsed.rows[0]["Факт (руб.)"] === "7 090,57", "brest amount");
ok(parsed.rows[0]["Доля"] === "31,0%", "brest percent");
// Must NOT smash a data row into a column name
parsed.columns.forEach(function (c) {
  if (String(c).indexOf("7 090") >= 0) fail("amount leaked into column name: " + c);
});

var labels = mod.pairRegionLabels([
  "Минск",
  "23 414,38 руб.",
  "33,3%",
  "Брестская",
  "7 090,57 руб.",
  "31,0%",
  "Витебская",
]);
ok(labels.length === 3, "3 regions " + labels.length);
var brest = null;
labels.forEach(function (r) {
  if (r.name === "Брестская") brest = r;
});
ok(brest, "brest label");
ok(brest.percent === "31,0%", "brest 31 " + JSON.stringify(brest));
ok(brest.amount === "7 090,57 руб.", "brest money");

var blob = mod.regionFromBlob("Брестская 7 090,57 руб. 31,0%");
ok(blob && blob.name === "Брестская", "blob name " + JSON.stringify(blob));
ok(blob.percent === "31,0%", "blob percent");
var brestSvg = mod.regionFromAttrs(
  "BrestskaiaVoblasts",
  "7\u00a0099,31 руб. 31,0 %"
);
ok(brestSvg && brestSvg.name === "Брестская", "svg name " + JSON.stringify(brestSvg));
ok(brestSvg.percent === "31,0 %", "svg percent " + brestSvg.percent);
ok(brestSvg.amount && brestSvg.amount.indexOf("099,31") >= 0, "svg amount");

// headerHeight too large must not drop the data rows (only Total left)
var swollen = {
  headerHeight: 4,
  headerWidth: 1,
  cells: [
    [
      { text: "Наименование" },
      { text: "НДС" },
      { text: "Прибыль" },
      { text: "Итого" },
    ],
    [
      { text: "Факт (руб.)" },
      { text: "7090,57" },
      { text: "300" },
      { text: "7390,57" },
    ],
    [
      { text: "План (руб.)" },
      { text: "8000" },
      { text: "400" },
      { text: "8400" },
    ],
  ],
};
var wide = mod.parsePivotViewerData(swollen);
ok(wide && wide.row_count === 3, "kept data rows " + (wide && wide.row_count));
ok(wide.rows[0]["Наименование"] === "НДС", "first data is НДС");

ok(mod.mapKeyToRu("BY-BR") === "Брестская", "BY-BR");
ok(mod.mapKeyToRu("GomelskayaVoblasts") === "Гомельская", "gomel");

ok(mod.isChromeLabel("Close") === true, "Close is chrome");
ok(mod.isChromeLabel("Брестская") === false, "region not chrome");

console.log("OK test_pivot_viewer_data.js", parsed.columns, parsed.rows, labels);
