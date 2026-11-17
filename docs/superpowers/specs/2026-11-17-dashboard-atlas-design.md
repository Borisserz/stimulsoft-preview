# Dashboard Atlas (option B)

## Goal

One photographable / downloadable inventory of **all 6 MRT pages** plus **manual interaction snapshots** (Общие данные / Динамика, drill Брест / Пинск, buttons), so the agent can parse any state without guessing element names.

## User flow

1. Open viewer → SVERKA → button **ATLAS**.
2. Auto-pass: cycle Stimulsoft pages 1…N, wait for paint, snapshot structure (+ light viewport meta).
3. Manual pass: checklist on `/atlas`:
   - Page X + Общие данные
   - Page X + Динамика
   - Drill Брест / Пинск (where map exists)
   - Key buttons (С/Без выполнения плана, Детализация)
4. User clicks **Add snapshot** after each manual step → appends labeled block.
5. Result: `/atlas` text + `GET /api/atlas` JSON + **Download** `.txt` to send/photo.

## Data shape

```json
{
  "captured_at": "...",
  "pages": [
    {
      "page_index": 0,
      "page_name": "...",
      "kind": "auto_page" | "manual",
      "label": "page0" | "p0 Dynamics" | "p0 drill Pinsk",
      "filters": { "panel": {}, "dashboard": [] },
      "interaction": {},
      "structure": { "element_count": N, "elements": [ /* same as /structure */ ] },
      "highlights": {
        "map_regions_sample": [],
        "pivot_names": [],
        "button_texts": []
      }
    }
  ]
}
```

No full pivot row dumps in atlas (use SVERKA for numbers). Atlas = names/types/texts/checked + map region **names** present + which pivots exist.

## Client

- Discover pages via `report.pages` / viewer page API; fallback: click Stimulsoft page tabs in DOM.
- `dashRunAtlasAuto()` → POST `/api/atlas` replace.
- `dashAtlasAddSnapshot(label)` → POST append.
- Panel button ATLAS opens `/atlas`.

## Server

- In-memory atlas store (like viewport).
- `GET /atlas` HTML (dark monospace, checklist, refresh).
- `GET /api/atlas`, `GET /api/atlas-text`, `POST /api/atlas` (`{replace:true, pages:[...]}` or `{append: page}`).

## Out of scope

Auto-clicking every region/button; SQL; replacing SVERKA number capture.

## Success

User sends one atlas dump (file or photos of `/atlas`). Agent knows every page’s buttons/KPI/map/pivots and how labels change after drill/toggle.
