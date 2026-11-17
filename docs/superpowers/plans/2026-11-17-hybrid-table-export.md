# Hybrid table export — implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or implement inline with TDD).

**Goal:** Tables via Stimulsoft `exportAsync(Json)`; buttons/KPI/map stay on viewport.

**Tech:** Stimulsoft Dashboards.JS 2024.2.2 — `StiDashboardExportTools.exportAsync(cb, element, StiExportFormat.Json)`.

## File map

| File | Role |
|------|------|
| `tests/test_export_json_parse.js` | Pure parser for export JSON → rows |
| `dash_debug.js` | `parseExportJson`, `enrichTablesViaExport`, async SVERKA |
| `docs/superpowers/specs/2026-11-17-hybrid-table-export-design.md` | Design |

## Tasks

### Task 1: Parser tests (RED → GREEN)

- [ ] `parseExportJson` handles `[{a:1}]`, `{T:[{a:1}]}`, string/bytes-like via helper
- [ ] Unique columns, `capture: export_json`

### Task 2: Wire async export in `dash_debug.js`

- [ ] Store `window.__stiReport` from interaction
- [ ] `exportTableElement(name) → Promise<tableSnap|null>`
- [ ] `postViewportAndCompare` awaits enrich; fallback to grid

### Task 3: Verify

- [ ] Node parser tests + existing py/js tests
- [ ] Manual: SVERKA shows `capture=export_json` + button values
