# Dashboard structure inventory page

## Goal

Human-photographable list of every Stimulsoft dashboard element (name, type, title, button/KPI hint) so we can map filters/buttons/pivots without guessing.

## Design

- `GET /structure` — standalone HTML, large monospace, auto-loads live snapshot from opener or fetches `/api/structure` after client POSTs viewport.
- Client: `snapshotStructure()` from same element walk as viewport (no table row dump).
- SVERKA button `STRUKTURA` posts + opens `/structure`.
- Pack field: `{ captured_at, elements: [{ name, type, title, checked?, value?, text?, has_rows?, row_count? }] }`.

## Out of scope

Row contents, SQL, LLM pack.
