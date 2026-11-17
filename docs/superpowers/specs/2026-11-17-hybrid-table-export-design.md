# Hybrid table export + viewport (design)

## Goal

SVERKA / LLM pack must show:

1. **Buttons / KPI / map / filters** — as painted on the dashboard (viewport scrape).
2. **Table rows + amounts** — from official Stimulsoft Table→JSON export (not fragile DOM/grid merge).

## Non-goals

- Export whole dashboard to PDF/Excel.
- Replace viewport for non-table widgets.
- Server-side re-filter of SQL.

## Design

```
onInteraction / SVERKA click
  → snapshotViewport()           # sync: buttons, KPI, map, filters, table fallback
  → enrichTablesViaExport()      # async: StiDashboardExportTools.exportAsync(Json)
  → POST /api/viewport           # same pack shape; capture="export_json" for tables
```

### Table path (primary)

Official JS sample ([Exporting a Dashboard from Code](https://www.stimulsoft.com/en/samples/dashboards-js/javascript/exporting-a-dashboard-from-code)):

```js
var table = report.getComponentByName(name);
Stimulsoft.Dashboard.Export.StiDashboardExportTools.exportAsync(
  function (data) { /* Uint8Array / string JSON */ },
  table,
  Stimulsoft.Report.StiExportFormat.Json
);
```

`StiExportFormat.Json` → `StiDataDashboardExportSettings(StiDataType.Json)` (2024.2.x dashboards.js).

- Keep live `args.report` on `window.__stiReport` from `onInteraction` (clone drops it today).
- Resolve component: `report.getComponentByName(el.name)`.
- Decode bytes → parse JSON → `{ columns, rows, row_count, capture: "export_json" }`.
- On failure / missing Stimulsoft API → keep existing grid/HTML capture.

### Non-table path (unchanged)

`snapshotElement` for Indicator / Button / Map / Chart / filters stays as-is.

### Pack / compare

No schema change. `capture=export_json` is visible in SVERKA text so humans can see the source.

## Risks

| Risk | Mitigation |
|------|------------|
| Export slow after filter | Keep debounce retries; export only `StiTableElement` / Pivot |
| JSON shape varies | Normalize array / `{Name:[...]}` / first array value |
| No report ref yet | Fall back to grid; store report on first interaction |
| Export ignores viewer filter | Docs: element export expands filtered element data; if wrong, fall back |

## Success

After Year/Month + budget button + map drill, SVERKA shows button labels **and** table rows with numeric amount columns (`capture=export_json`).
