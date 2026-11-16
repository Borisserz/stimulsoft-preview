# Design: Viewport capture (visible dashboard = LLM truth)

Date: 2026-11-16  
Status: approved direction (approach 2) — awaiting spec OK to implement

## Goal

JSON for the LLM must contain **exactly what a human sees** on the Stimulsoft dashboard after all active filters (Year/Month, top buttons, map region, drill Brest→Pinsk, etc.).

Success check: click a region → table shows N rows / KPI shows X → pack shows the same N and X. Change region → numbers change.

## Non-goals

- Re-implementing Stimulsoft filter logic in Python against raw SQL snapshots
- Using `/api/verify` as human data check
- Keeping dual “maybe SQL / maybe filter” as the primary path

## Source of truth

**Client Stimulsoft in-memory state after paint**, not `onEndProcessData` SQL rows.

After `DashboardFiltering` / drill / variable submit, the viewer already has filtered content on each element (`elementAttributes`, `contentAttributes`, `dataGrid.data`, titles, chart/map payloads).

## Architecture

```
[User click]
    → Stimulsoft applies filters + repaints
    → dash_debug.js: snapshotViewport()
         - filters (panel + per-element contentAttributes.filters)
         - every visible element normalized
    → POST /api/viewport  { captured_at, filters, elements[] }
    → server stores _VIEWPORT (replace whole snapshot)
    → GET /api/llm-pack  and  GET /api/compare  read ONLY _VIEWPORT
```

### Endpoint

`POST /api/viewport`  
Body:

```json
{
  "captured_at": "ISO-8601",
  "interaction": { "action": "...", "element": "..." },
  "filters": {
    "panel": { "Year": "...", "Month": "..." },
    "dashboard": [ { "path": "map", "value": "Брестская", "condition": "MapEqualTo" } ]
  },
  "elements": [
    {
      "name": "Table1",
      "type": "StiTableElement",
      "title": "...",
      "row_count": 10,
      "columns": ["..."],
      "rows": [ { "...": "..." } ]
    },
    {
      "name": "KPI1",
      "type": "StiIndicatorElement",
      "title": "...",
      "value": "123",
      "text": "..."
    }
  ]
}
```

`GET /api/llm-pack` → `{ filters, interaction, elements, results_source: "viewport" }`  
`GET /api/compare` → human text from the same snapshot (counts must match `elements[].row_count`).

### Client snapshot (`snapshotViewport`)

Walk all DOM nodes with `elementAttributes` (dashboard elements):

| Type | Capture |
|------|---------|
| `StiTableElement` | `dataGrid.data` / `contentAttributes.data` → columns + all rows (not only current page) |
| Indicator / KPI / Progress | title + displayed value/text from contentAttributes / DOM text |
| Chart | series labels + values from contentAttributes when present; else title + summary |
| Region map | selected filters + title; geom values if cheap |
| Cards / text / list / tree | title + visible text / selected values |
| Buttons | name + checked state |

Also collect:

- Panel variables (Year/Month) from last known params / interaction variables
- Union of `contentAttributes.filters` and last interaction filter bags → `filters.dashboard`

Debounced after interaction (e.g. 600 / 1400 / 2600 ms) and on green **SVERKA** click. One POST replaces previous viewport entirely.

## Delete / demote (current mess)

Remove as **primary** data path:

1. Python re-filter of `_RESULTS` via `MapEqualTo` / drill stack for the LLM pack
2. Preferring SQL `onEndProcessData` snapshot in `/api/llm-pack` and `/api/compare`
3. Dual confusing sources (`sql_snapshot` vs half-working visible scrape without full coverage)

Keep only if useful for debug (optional, behind flag or separate route):

- `_RESULTS` capture in `onEndProcessData` → e.g. `GET /api/debug/sql-snapshot` (not used by LLM pack)
- Interaction log `/api/interactions`

`/api/smoke-seed` can seed `_VIEWPORT` instead of `_RESULTS` for no-DB tests.

## Compare panel

SVERKA must say:

- `istochnik=VIEWPORT`
- list filters
- per element: type, title, row_count / value
- sample rows for tables (cap print length, but **row_count = full**)

If viewport empty → loud error: “snapshot not captured — wait for repaint / click SVERKA”.

## Tests

1. POST viewport with table `row_count=10` while fake SQL has 50 → llm-pack/compare show 10, not 50  
2. Viewport replace on second POST  
3. Compare text contains `VIEWPORT` and element names  
4. Smoke script without DB posts viewport and asserts counts  

## Risks

- Element type shapes differ → normalize defensively; unknown types → `{name,type,title,raw_keys}` so nothing silent-drops  
- Pagination: table `dataGrid.data` is full filtered set; UI page size may show 10 of N — pack uses full filtered N (correct for LLM). If product wants “only current page”, change later.  
- Timing: multiple delayed snapshots; last wins.

## Out of scope for first slice

- Perfect chart geometry / map SVG parsing  
- Changing MRT / SQL queries  
- Windows encoding (already UTF-8 path)
