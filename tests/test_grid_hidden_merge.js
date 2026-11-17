/**
 * Node smoke: merge visible + hiddenData like Stimulsoft, keep amounts.
 * Run: node tests/test_grid_hidden_merge.js
 */

function cellValue(cell) {
  if (cell == null) return null;
  if (typeof cell !== "object") return cell;
  if (cell.value !== undefined && cell.value !== null && cell.value !== "")
    return cell.value;
  if (cell.text !== undefined && cell.text !== null) return cell.text;
  return null;
}

function headerColumnName(col, index) {
  if (!col || typeof col !== "object") return "c" + index;
  return (
    col.labelCorrect ||
    col.label ||
    col.text ||
    col.name ||
    col.key ||
    "c" + index
  );
}

function uniqueColumns(names) {
  var seen = {};
  var out = [];
  for (var i = 0; i < names.length; i++) {
    var base = String(names[i] || "").trim() || "c" + i;
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

function mergeVisibleAndHidden(data, hidden) {
  if (!Array.isArray(data) || data.length < 1) {
    return Array.isArray(hidden) && hidden.length ? hidden : null;
  }
  if (!Array.isArray(hidden) || hidden.length < 1) return data;
  if (!Array.isArray(hidden[0]) || hidden[0].length < 1) return data;
  var out = [];
  var n = Math.max(data.length, hidden.length);
  for (var r = 0; r < n; r++) {
    var a = Array.isArray(data[r]) ? data[r] : [];
    var b = Array.isArray(hidden[r]) ? hidden[r] : [];
    out.push(a.concat(b));
  }
  return out;
}

function parseGridData(data) {
  var header = data[0];
  var columns = uniqueColumns(
    header.map(function (c, i) {
      return headerColumnName(c, i);
    })
  );
  var rows = [];
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var obj = {};
    for (var i = 0; i < columns.length; i++) obj[columns[i]] = cellValue(row[i]);
    rows.push(obj);
  }
  return { columns: columns, rows: rows, row_count: rows.length };
}

var visible = [
  [
    { label: "Наименование платежа" },
    { label: "Регион" },
  ],
  [
    { text: "Налог на прибыль" },
    { text: "Брестская" },
  ],
];

var hidden = [
  [
    { labelCorrect: "Сумма", label: "Сумма" },
    { labelCorrect: "План", label: "План" },
  ],
  [{ value: 1500.5, text: "1 500.50" }, { value: 2000, text: "2 000" }],
];

var merged = mergeVisibleAndHidden(visible, hidden);
var parsed = parseGridData(merged);

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL", msg, parsed);
    process.exit(1);
  }
}

assert(parsed.columns.length === 4, "expected 4 columns");
assert(parsed.columns.indexOf("Сумма") >= 0, "missing Сумма");
assert(parsed.columns.indexOf("План") >= 0, "missing План");
assert(parsed.rows[0]["Сумма"] === 1500.5, "amount value");
assert(parsed.rows[0]["Наименование платежа"] === "Налог на прибыль", "name intact");
assert(parsed.rows[0]["Регион"] === "Брестская", "region intact");
console.log("OK grid hidden merge", parsed.columns, parsed.rows[0]);
