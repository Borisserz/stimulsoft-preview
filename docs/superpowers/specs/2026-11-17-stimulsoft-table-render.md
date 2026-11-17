# Stimulsoft dashboard table render model (from viewer.js 2024.2.x)

## Where data lives

After paint, a `StiTableElement` DOM node has:

| Field | Meaning |
|-------|---------|
| `elementAttributes.name` | Element id/name |
| `elementAttributes.contentAttributes.data` | Visible columns grid |
| `elementAttributes.contentAttributes.hiddenData` | Hidden / TrueAndHidden columns |
| `elementAttributes.contentAttributes.title` | `{ visible, text, font, ... }` (text may be encoded) |
| `elementAttributes.contentAttributes.settings.rowsPerPage` | UI paging only |
| `dataGrid` | Live grid widget |
| `dataGrid.data` / `dataGrid.hiddenData` | Same grids after `showData` |
| `titlePanel` | Painted title DOM (already decoded) |

Prefer **`dataGrid.*`** when present (post-`showData`); else `contentAttributes.*`.

## Grid shape

```
data[0]     = header cells
data[1..N]  = body rows
data[N+1]?  = totals row if any header has showTotalSummary
```

Header cell fields (from engine): `key`, `label`, `labelCorrect`, `path`, `columnIndex`, `dataType`, `align`, `showTotalSummary`, `sortLabel`, `visibilityTrueAndHidden`, …

Body cell fields: `text` (painted), `value` (raw; used in export/filter), optional `image`, colors, `textFontStyle`.

## Merge rule (viewer `replaceRowValues`)

For row index `o`:

```
header = data[0].concat(hiddenData[0])
cells  = data[o].concat(hiddenData[o])
name   = header[i].labelCorrect
value  = cells[i].value != null ? cells[i].value : cells[i].text
```

Amounts often sit only in `hiddenData`.

## HTML is not the source of truth

`showData` builds **three** HTML tables inside the grid:

1. Header table — 1 label row  
2. Body table — **only data rows** (row 0 is first data row, not headers)  
3. Optional footer totals  

Paging / `hideRows` (rows after 50 when not paged) only affect DOM. Full rows stay in `dataGrid.data`.

**Parser rule:** if `dataGrid.data` (merged with hidden) has rows → use it; HTML only as last-resort fallback with header-table + body-table layout.

## Title

`PaintDashboardElementTitle`: if `title.visible`, paints `titlePanel` with decoded `title.text`.  
Read `titlePanel` inner text first; else `contentAttributes.title.text`; else element `name`.

## Column order

`changeColumnsOrder` reorders a **local** copy for painting; `be.data` is assigned **before** reorder. Reading `dataGrid.data` is the stored order aligned with `hiddenData` indices.
