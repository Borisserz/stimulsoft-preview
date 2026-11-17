/**
 * Node smoke: Stimulsoft table model (merge hiddenData, value||text, grid>html).
 * Run: node tests/test_grid_hidden_merge.js
 * Spec: docs/superpowers/specs/2026-11-17-stimulsoft-table-render.md
 */

function stiCellValue(cell) {
  if (cell == null) return null;
  if (typeof cell !== "object") return cell;
  if (cell.value !== undefined && cell.value !== null && cell.value !== "")
    return cell.value;
  if (cell.text !== undefined && cell.text !== null && cell.text !== "")
    return cell.text;
  if (cell.value !== undefined && cell.value !== null) return cell.value;
  if (cell.text !== undefined && cell.text !== null) return cell.text;
  return null;
}

function stiNormStr(v) {
  if (v === null || v === undefined) return v;
  if (typeof v === "number" || typeof v === "boolean") return v;
  return String(v).replace(/\s+/g, " ").trim();
}

function stiHeaderName(col, index) {
  if (!col || typeof col !== "object") return "c" + index;
  return (
    stiNormStr(
      col.labelCorrect || col.label || col.text || col.name || col.key
    ) || "c" + index
  );
}

function stiUniqueNames(names) {
  var seen = {};
  var out = [];
  for (var i = 0; i < names.length; i++) {
    var base = stiNormStr(names[i]) || "c" + i;
    var name = base;
    var n = 2;
    while (seen[name]) {
      name = base + "_" + n;
      n++;
    }
    seen[name] = true;
    out.push(name);
  }
  return out;
}

function stiMergeVisibleHidden(visible, hidden) {
  if (!Array.isArray(visible) || visible.length < 1) {
    return Array.isArray(hidden) && hidden.length ? hidden : null;
  }
  if (!Array.isArray(hidden) || hidden.length < 1) return visible;
  if (!Array.isArray(hidden[0]) || hidden[0].length < 1) return visible;
  var out = [];
  var n = Math.max(visible.length, hidden.length);
  for (var r = 0; r < n; r++) {
    var a = Array.isArray(visible[r]) ? visible[r] : [];
    var b = Array.isArray(hidden[r]) ? hidden[r] : [];
    out.push(a.concat(b));
  }
  return out;
}

function stiParseGrid(data, captureTag) {
  var header = data[0];
  var hasTotal = header.some(function (h) {
    return h && h.showTotalSummary;
  });
  var columns = stiUniqueNames(
    header.map(function (c, i) {
      return stiHeaderName(c, i);
    })
  );
  var end = hasTotal && data.length > 1 ? data.length - 1 : data.length;
  var rows = [];
  for (var r = 1; r < end; r++) {
    var row = data[r];
    var obj = {};
    for (var i = 0; i < columns.length; i++) {
      obj[columns[i]] = stiNormStr(stiCellValue(row[i]));
    }
    rows.push(obj);
  }
  return { columns: columns, rows: rows, row_count: rows.length, capture: captureTag };
}

function pickCapture(gridParsed, htmlParsed) {
  if (gridParsed && gridParsed.row_count > 0) return gridParsed;
  return htmlParsed;
}

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL", msg);
    process.exit(1);
  }
}

var visible = [
  [{ label: "Наименование платежа" }, { label: "Регион" }],
  [{ text: "Налог на прибыль" }, { text: "Брестская" }],
  [{ text: "НДС" }, { text: "Минская" }],
];

var hidden = [
  [
    { labelCorrect: "Сумма", label: "Сумма" },
    { labelCorrect: "План", label: "План" },
  ],
  [{ value: 1500.5, text: "1 500.50" }, { value: 2000, text: "2 000" }],
  [{ value: 300, text: "300" }, { value: 400, text: "400" }],
];

var merged = stiMergeVisibleHidden(visible, hidden);
var parsed = stiParseGrid(merged, "grid+hidden");

assert(parsed.columns.length === 4, "4 columns");
assert(parsed.columns.indexOf("Сумма") >= 0, "has Сумма");
assert(parsed.rows.length === 2, "2 body rows");
assert(parsed.rows[0]["Наименование платежа"] === "Налог на прибыль", "name");
assert(parsed.rows[0]["Регион"] === "Брестская", "region");
assert(parsed.rows[0]["Сумма"] === 1500.5, "amount value preferred");
assert(parsed.rows[1]["Сумма"] === 300, "row2 amount");

var htmlBroken = {
  columns: ["c0"],
  rows: [{ c0: "1" }, { c0: "5" }, { c0: "0" }],
  row_count: 3,
  capture: "html",
};
var picked = pickCapture(parsed, htmlBroken);
assert(picked.capture === "grid+hidden", "grid wins over html");
assert(picked.rows[0]["Сумма"] === 1500.5, "amount kept");

// totals row excluded from body
var withTotal = stiMergeVisibleHidden(
  [
    [
      { label: "A", showTotalSummary: true },
      { label: "B", showTotalSummary: true },
    ],
    [{ text: "x" }, { value: 1 }],
    [{ text: "Total" }, { value: 99 }],
  ],
  null
);
var p2 = stiParseGrid(withTotal, "grid");
assert(p2.row_count === 1, "totals not in body");
assert(p2.rows[0].A === "x", "body row kept");

// empty value must not hide painted text amounts
assert(stiCellValue({ value: "", text: "1 500.50" }) === "1 500.50", "empty value→text");
assert(stiCellValue({ value: 0, text: "x" }) === 0, "zero value kept");

// Prefer pairing that brings numeric columns (simulate dg names + ca hidden amounts)
function stiGridScore(p) {
  if (!p) return -1;
  var nums = 0;
  if (p.rows && p.rows[0]) {
    Object.keys(p.rows[0]).forEach(function (k) {
      var v = p.rows[0][k];
      if (typeof v === "number") nums++;
      else if (v != null && /^-?\d+(\.\d+)?$/.test(String(v).replace(/\s/g, "").replace(",", ".")))
        nums++;
    });
  }
  return (p.columns.length || 0) * 1000 + nums * 5000 + (p.row_count || 0);
}
var onlyNames = stiParseGrid(visible, "names");
var withAmounts = parsed;
assert(stiGridScore(withAmounts) > stiGridScore(onlyNames), "amounts score higher");

console.log("OK stimulsoft table model", parsed.columns, parsed.rows);
