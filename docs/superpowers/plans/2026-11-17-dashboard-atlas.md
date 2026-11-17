# Dashboard Atlas Implementation Plan

> **For agentic workers:** Steps use TDD. Spec: `docs/superpowers/specs/2026-11-17-dashboard-atlas-design.md`.

## Files

| File | Role |
|------|------|
| `atlas_pack.py` | normalize/store/text/HTML for atlas |
| `view_dashboard.py` | `/atlas`, `/api/atlas`, `/api/atlas-text` |
| `dash_debug.js` | ATLAS button, page cycle, Add snapshot |
| `tests/test_atlas.py` | pack + routes |

## Tasks

1. RED/GREEN: `atlas_pack` append/replace + text
2. Routes + HTML page with checklist
3. Client: list/switch pages, auto snapshots, manual append
4. Wire ATLAS button; verify locally
