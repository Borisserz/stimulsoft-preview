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

// Drilled pivot: getViewerData is only Total/Итог zeros.
// Painted table has the payment rows (Brest 722 087,2 / Pinsk 7 220,9).
var stub = mod.parsePivotViewerData({
  headerHeight: 2,
  headerWidth: 2,
  cells: [
    [{ text: "Сводная таблица" }, { text: "Наименование платежа" }, { text: "" }, { text: "Итог" }],
    [{ text: "Сводная таблица" }, { text: "ИМНС" }, { text: "Total" }, { text: "Итог" }],
    [{ text: "Вид бюджета" }, { text: "Факт (руб.)" }, { text: "0,0" }, { text: "0,0" }],
    [{ text: "Вид бюджета" }, { text: "План (руб.)" }, { text: "0,0" }, { text: "0,0" }],
  ],
});
ok(stub && stub.row_count === 2, "stub still parses");
ok(mod.pivotDataScore(stub) === 0, "zero totals score 0, got " + mod.pivotDataScore(stub));

var painted = [
  [
    { text: "Сводная таблица", colspan: 2 },
    { text: "Консолидированный", colspan: 2 },
    { text: "Close", colspan: 1 },
  ],
  ["Наименование платежа", "ИМНС", "Факт (руб.)", "План (руб.)", "Close"],
  ["Единый налог с ИП", "", "29 370,1", "168", ""],
  ["Акцизы на спирт", "", "142 218,4", "56", ""],
  ["Итог", "", "722 087,2", "979", ""],
];
var html = mod.parseHtmlGrid(painted);
ok(html && html.capture === "html_grid", "html tag");
ok(html.row_count === 3, "3 painted rows " + (html && html.row_count));
ok(html.columns.indexOf("Close") < 0, "no Close column " + (html && html.columns));
var factKey = html.columns.filter(function (c) {
  return c.indexOf("Факт") >= 0;
})[0];
ok(factKey, "fact column " + html.columns);
ok(html.rows[0][factKey] === "29 370,1", "brest first fact " + JSON.stringify(html.rows[0]));
ok(html.rows[2][factKey] === "722 087,2", "brest total " + html.rows[2][factKey]);
ok(mod.pivotDataScore(html) > 20, "painted score " + mod.pivotDataScore(html));

var pinsk = mod.parseHtmlGrid([
  ["Наименование платежа", "Управление/отдел", "Факт (руб.)", "План (руб.)"],
  ["Земельный налог", "", "1 027,2", "2 881,7"],
  ["Итог", "", "7 220,9", "9 787,2"],
]);
ok(pinsk && pinsk.row_count === 2, "pinsk rows " + (pinsk && pinsk.row_count));
ok(pinsk.rows[0]["Факт (руб.)"] === "1 027,2", "pinsk fact");
ok(pinsk.rows[1]["Факт (руб.)"] === "7 220,9", "pinsk total fact");

var picked = mod.pickPivotSource([stub, html]);
ok(picked && picked.capture === "html_grid", "painted beats zero stub");
ok(picked.rows[2][factKey] === "722 087,2", "picked keeps 722 087,2");

var merged = mod.mergeRegionLists(
  [
    { name: "Брестская", amount: "7 099,31 руб.", percent: "31,0 %", value: "7 099,31 руб." },
    { name: "Гомельская", amount: null, percent: null, value: null },
    { name: "Витебская", amount: null, percent: null, value: null },
  ],
  [
    { name: "Гомельская", amount: "12 000 руб.", percent: "18,2%", value: "12 000 руб." },
    { name: "Витебская", amount: null, percent: "9,1%", value: "9,1%" },
    { name: "Минск", amount: "23 414,38 руб.", percent: "33,3%", value: "23 414,38 руб." },
  ]
);
function regionNamed(list, name) {
  for (var i = 0; i < list.length; i++) if (list[i].name === name) return list[i];
  return null;
}
ok(regionNamed(merged, "Брестская").percent === "31,0 %", "brest kept");
ok(regionNamed(merged, "Гомельская").percent === "18,2%", "gomel from labels " + JSON.stringify(merged));
ok(regionNamed(merged, "Витебская").percent === "9,1%", "vitebsk from labels");
ok(regionNamed(merged, "Минск").percent === "33,3%", "minsk from labels");

// After drill the map paints only Brest; cache still has all oblasts — do not invent them.
var drilledMap = mod.mergeRegionLists(
  [{ name: "Брестская", amount: "7 099,31 руб.", percent: "31,0 %", value: "7 099,31 руб." }],
  [
    { name: "Гомельская", amount: "12 000 руб.", percent: "18,2%", value: "12 000 руб." },
    { name: "Витебская", amount: null, percent: "9,1%", value: "9,1%" },
    { name: "Минск", amount: "23 414,38 руб.", percent: "33,3%", value: "23 414,38 руб." },
  ],
  { allowNew: false }
);
ok(drilledMap.length === 1, "drilled map only Brest " + drilledMap.length);
ok(drilledMap[0].name === "Брестская", "drilled name");

// Stimulsoft: separate header / label-only / body tables. Blind concat smashes payments into columns.
var stiHeader = [
  [
    { text: "Cancel" },
    { text: "Сводная таблица", colspan: 3 },
  ],
  ["Наименование платежа", "ИМНС", "Факт (руб.)", "План (руб.)"],
];
var stiLabelsOnly = [
  ["Единый налог с ИП и иных физических лиц"],
  ["Акцизы на нефть"],
  ["Экологический налог, всего"],
];
var stiBody = [
  ["Единый налог с ИП и иных физических лиц", "", "29 370,1", "168"],
  ["Акцизы на спирт этиловый", "", "142 218,4", "56"],
  ["НДС по оборотам", "", "143 982,3", "111"],
  ["Итог", "", "722 087,2", "979"],
];
var recovered = mod.parseHtmlGrid(stiHeader.concat(stiLabelsOnly).concat(stiBody));
ok(recovered && recovered.row_count === 4, "recover rows " + (recovered && recovered.row_count));
ok(
  recovered.columns.every(function (c) {
    return c.indexOf("Акцизы на нефть") < 0 && c.indexOf("Единый налог") < 0;
  }),
  "recover drops payment headers " + (recovered && recovered.columns)
);
var joined = mod.joinPivotHtmlChunks([stiHeader, stiLabelsOnly, stiBody]);
ok(joined && joined.capture === "html_grid", "joined tag");
ok(joined.row_count === 4, "joined 4 rows " + (joined && joined.row_count));
ok(
  joined.columns.every(function (c) {
    return c.indexOf("Акцизы на нефть") < 0 && c.indexOf("Единый налог") < 0;
  }),
  "payments are rows not columns " + joined.columns
);
ok(joined.columns.join(" ").indexOf("Cancel") < 0, "no Cancel " + joined.columns);
var jFact = joined.columns.filter(function (c) {
  return c.indexOf("Факт") >= 0;
})[0];
ok(jFact, "fact col " + joined.columns);
ok(joined.rows[0][jFact] === "29 370,1", "brest first " + JSON.stringify(joined.rows[0]));
ok(joined.rows[3][jFact] === "722 087,2", "brest total " + JSON.stringify(joined.rows[3]));
ok(joined.rows[0][joined.columns[0]].indexOf("Единый налог") >= 0, "payment in row");

var pinskJoined = mod.joinPivotHtmlChunks([
  [
    ["Наименование платежа", "Управление/отдел", "Факт (руб.)", "План (руб.)"],
  ],
  [
    ["Земельный налог, всего", "", "1 027,2", "2 881,7"],
    ["Экологический налог, всего", "", "1 493,2", "1 428,0"],
    ["Итог", "", "7 220,9", "9 797,2"],
  ],
]);
ok(pinskJoined && pinskJoined.rows[2]["Факт (руб.)"] === "7 220,9", "pinsk 7220,9");

ok(mod.mapKeyToRu("BY-BR") === "Брестская", "BY-BR");
ok(mod.mapKeyToRu("Могилевская") === "Могилёвская", "cyrillic mogilev");
ok(mod.isChromeLabel("Cancel") === true, "Cancel chrome");
ok(mod.mapKeyToRu("MahiliouskaiaVoblasts") === "Могилёвская", "mogilev latin");
ok(mod.mapKeyToRu("VitsebskaiaVoblasts") === "Витебская", "vitebsk latin");

// Bug: parent SVG group text has Brest 31% — must NOT copy onto every path.
var polluted = mod.mergeRegionLists(
  [
    mod.regionFromAttrs("BrestskaiaVoblasts", "7\u00a0099,31 руб. 31,0 %"),
    mod.regionFromAttrs(
      "GomelskayaVoblasts",
      "7 099,31 руб. 31,0 % Брестская Гомельская Гродненская"
    ),
    mod.regionFromAttrs("GrodnenskayaVoblasts", "7 099,31 руб. 31,0 %"),
  ],
  [],
  { allowNew: true }
);
// Without sanitize, all would share 31%. regionFromAttrs alone still returns amount;
// sanitizeMapRegions keeps values only when elementvalue is private to that region.
var cleaned = mod.sanitizeMapRegions(
  [
    {
      name: "Брестская",
      amount: "7 099,31 руб.",
      percent: "31,0 %",
      value: "7 099,31 руб.",
      fromValueAttr: true,
    },
    {
      name: "Гомельская",
      amount: "7 099,31 руб.",
      percent: "31,0 %",
      value: "7 099,31 руб.",
      fromValueAttr: false,
    },
    {
      name: "Гродненская",
      amount: "7 099,31 руб.",
      percent: "31,0 %",
      value: "7 099,31 руб.",
      fromValueAttr: false,
    },
    { name: "Минская", amount: null, percent: null, value: null, fromValueAttr: false },
  ],
  [
    { name: "Минск", amount: "23 414,38 руб.", percent: "33,3%", value: "23 414,38 руб." },
    { name: "Брестская", amount: "7 099,31 руб.", percent: "31,0%", value: "7 099,31 руб." },
  ]
);
ok(regionNamed(cleaned, "Брестская").percent.indexOf("31") >= 0, "brest keeps 31");
ok(!regionNamed(cleaned, "Гомельская").percent, "gomel no stolen 31 " + JSON.stringify(regionNamed(cleaned, "Гомельская")));
ok(!regionNamed(cleaned, "Гродненская").amount, "grodno no stolen amount");
ok(regionNamed(cleaned, "Минск").percent === "33,3%", "minsk from labels");

// Drill table: label table (left) + numeric tables (right) must zip by row.
var labelTbl = [
  ["Наименование платежа"],
  ["Единый налог с ИП"],
  ["Акцизы на спирт"],
  ["Итог"],
];
var numTbl = [
  ["Факт (руб.)", "План (руб.)"],
  ["29 370,1", "168"],
  ["142 218,4", "56"],
  ["722 087,2", "979"],
];
var zipped = mod.joinPivotHtmlChunks([labelTbl, numTbl]);
ok(zipped && zipped.row_count === 3, "zip rows " + (zipped && zipped.row_count));
ok(
  zipped.rows[0][zipped.columns[0]].indexOf("Единый налог") >= 0,
  "zip payment name not number " + JSON.stringify(zipped.rows[0])
);
var zFact = zipped.columns.filter(function (c) {
  return c.indexOf("Факт") >= 0;
})[0];
ok(zFact && zipped.rows[0][zFact] === "29 370,1", "zip fact " + zFact);
ok(zipped.rows[2][zFact] === "722 087,2", "zip total");
// Mis-join where payment col is numeric must lose to a better zip
var badNumericAsName = {
  columns: ["Наименование платежа", "ИМНС", "c2"],
  rows: [
    { "Наименование платежа": "29 370,1", ИМНС: "168 668,3", c2: "157 741,0" },
    { "Наименование платежа": "142 218,4", ИМНС: "56 832,4", c2: "1" },
  ],
  row_count: 2,
  capture: "html_grid",
};
ok(mod.pivotDataScore(badNumericAsName) < mod.pivotDataScore(zipped), "numeric-as-name loses");

// Drop staggered empty-label junk rows (Pinsk ghost rows)
var withJunk = {
  columns: ["Наименование платежа", "c1", "c2", "c3"],
  rows: [
    { "Наименование платежа": "Земельный налог", c1: "1 027,2", c2: "2 881,7", c3: "" },
    { "Наименование платежа": "", c1: "", c2: "", c3: "2 549,7" },
    { "Наименование платежа": "Итог", c1: "7 220,9", c2: "9 797,2", c3: "" },
  ],
  row_count: 3,
  capture: "html_grid",
};
var pruned = mod.pruneSparsePivotRows(withJunk);
ok(pruned.row_count === 2, "pruned junk " + pruned.row_count);
ok(pruned.rows[1]["Наименование платежа"] === "Итог", "kept total");
ok(polluted.length >= 1, "polluted fixture used");

// Screen paints only Brest+Minsk; cache/DOM must not invent Gomel numbers.
var screenOnly = mod.sanitizeMapRegions(
  [
    {
      name: "Брестская",
      amount: "7 099,31 руб.",
      percent: "31,0 %",
      value: "7 099,31 руб.",
      fromValueAttr: true,
    },
    { name: "Гомельская", amount: null, percent: null, value: null, fromValueAttr: false },
    { name: "Гродненская", amount: null, percent: null, value: null, fromValueAttr: false },
  ],
  [
    { name: "Гомельская", amount: "67 234,08 руб.", percent: "81,8 %", value: "67 234,08 руб." },
    { name: "Минск", amount: "23 414,38 руб.", percent: "33,3%", value: "23 414,38 руб." },
  ],
  { labelsMustBePainted: true }
);
ok(regionNamed(screenOnly, "Брестская").percent.indexOf("31") >= 0, "screen brest");
ok(!regionNamed(screenOnly, "Гомельская").amount, "no invented gomel amount");
ok(!regionNamed(screenOnly, "Гомельская").percent, "no invented gomel percent");
ok(regionNamed(screenOnly, "Минск").percent === "33,3%", "minsk label ok");

var dirty = mod.normalizeRegionFields({
  name: "Витебская",
  amount: null,
  percent: "42 837,80 руб. 84,7 %",
  value: "42 837,80 руб. 84,7 %",
});
ok(dirty.amount && dirty.amount.indexOf("42 837") >= 0, "split amount " + dirty.amount);
ok(dirty.percent && dirty.percent.indexOf("84") >= 0 && dirty.percent.indexOf("руб") < 0, "split percent " + dirty.percent);

var mega = mod.normalizeRegionFields({
  name: "Брестская Брестская7 099,31 31,0 %ГомельскаяГомельская",
  amount: "7 099,31 руб.",
  percent: "31,0 %",
  value: "7 099,31 руб.",
});
ok(mega == null, "drop mega concat name");

// Pinsk: pivot_viewer only Total/Итог 0,0 must lose to painted html_grid.
var pinskStub = mod.parsePivotViewerData({
  headerHeight: 2,
  headerWidth: 2,
  cells: [
    [{ text: "Сводная таблица" }, { text: "Наименование платежа" }, { text: "" }, { text: "Итог" }],
    [{ text: "Сводная таблица" }, { text: "Управление/отдел" }, { text: "Total" }, { text: "Итог" }],
    [{ text: "Вид бюджета" }, { text: "Факт (руб.)" }, { text: "0,0" }, { text: "0,0" }],
    [{ text: "Вид бюджета" }, { text: "План (руб.)" }, { text: "0,0" }, { text: "0,0" }],
    [{ text: "Вид бюджета" }, { text: "Отклонение (руб.)" }, { text: "0,0" }, { text: "0,0" }],
  ],
});
var pinskHtml = mod.joinPivotHtmlChunks([
  [
    ["Наименование платежа"],
    ["Земельный налог, всего"],
    ["Экологический налог, всего"],
    ["Итог"],
  ],
  [
    ["Факт (руб.)", "План (руб.)"],
    ["1 027,2", "2 881,7"],
    ["1 493,2", "1 428,0"],
    ["7 220,9", "9 797,2"],
  ],
]);
ok(pinskHtml && pinskHtml.rows[0][pinskHtml.columns[0]].indexOf("Земельный") >= 0, "pinsk name");
ok(mod.pivotDataScore(pinskStub) < 10, "stub weak " + mod.pivotDataScore(pinskStub));
var pinskPick = mod.pickPivotSource([pinskStub, pinskHtml]);
ok(pinskPick && pinskPick.capture === "html_grid", "pinsk picks html not stub");
ok(
  String(JSON.stringify(pinskPick.rows)).indexOf("7 220,9") >= 0,
  "pinsk keeps 7220,9"
);
ok(mod.pickPivotSource([pinskStub]) == null, "stub alone rejected");

var shiftedHtml = {
  capture: "html_grid",
  columns: [
    "Консолидированный / Факт (руб.)",
    "Консолидированный / План (руб.)",
    "Местные / Факт (руб.)",
  ],
  rows: [
    {
      "Консолидированный / Факт (руб.)": "29 370,1",
      "Консолидированный / План (руб.)": "168 668,3",
      "Местные / Факт (руб.)": "",
    },
    {
      "Консолидированный / Факт (руб.)": "29 370,1",
      "Консолидированный / План (руб.)": "168 668,3",
      "Местные / Факт (руб.)": "",
    },
    {
      "Консолидированный / Факт (руб.)": "142 218,4",
      "Консолидированный / План (руб.)": "56 832,4",
      "Местные / Факт (руб.)": "",
    },
    {
      "Консолидированный / Факт (руб.)": "142 218,4",
      "Консолидированный / План (руб.)": "56 832,4",
      "Местные / Факт (руб.)": "",
    },
  ],
  row_count: 4,
};
var goodPivot = {
  capture: "pivot_viewer",
  columns: ["Наименование платежа", "Факт (руб.)"],
  rows: [{ "Наименование платежа": "НДС", "Факт (руб.)": "94 073,0" }],
  row_count: 1,
};
ok(mod.pickPivotSource([shiftedHtml]) == null, "shifted html rejected");
ok(
  mod.pickPivotSource([shiftedHtml, goodPivot]).capture === "pivot_viewer",
  "pivot beats shifted html"
);
ok(mod.mapKeyToRu("GomelskayaVoblasts") === "Гомельская", "gomel");

ok(mod.isChromeLabel("Close") === true, "Close is chrome");
ok(mod.isChromeLabel("Брестская") === false, "region not chrome");

console.log("OK test_pivot_viewer_data.js", parsed.columns, parsed.rows, labels);
