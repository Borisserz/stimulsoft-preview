# Viewport Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or implement task-by-task with TDD. Steps use checkbox syntax.

**Goal:** LLM pack / SVERKA read only a full visible-dashboard viewport snapshot; remove SQL re-filter as primary path.

**Architecture:** Client `snapshotViewport()` walks Stimulsoft elements → `POST /api/viewport` replaces `_VIEWPORT` → `/api/llm-pack` and `/api/compare` serve only that. SQL `_RESULTS` demoted to optional debug.

**Tech Stack:** Flask viewer, `dash_debug.js`, `llm_pack.py`, unittest

**Spec:** `docs/superpowers/specs/2026-11-16-viewport-capture-design.md`

## Global Constraints

- Visible Stimulsoft state is source of truth
- Delete dual sql/visible primary path from pack/compare
- UTF-8 ASCII-safe panel strings where needed
- TDD for server; smoke without DB

---

### Task 1: Server viewport store + pack/compare

**Files:** `viewport_pack.py` (new), `view_dashboard.py`, `llm_pack.py`, `tests/test_viewport.py`

- [x] Failing tests: POST viewport → llm-pack has elements row_count=10; SQL 50 ignored
- [x] Implement `_VIEWPORT`, `POST /api/viewport`, pack from viewport only
- [x] Rewrite compare for viewport (`viewport_pack.py`)
- [x] Clear viewport on DELETE /api/params
- [x] Demote: llm_pack_snapshot does not use `_RESULTS` as primary

### Task 2: Client full snapshot

**Files:** `dash_debug.js`

- [x] `snapshotViewport()` all elementAttributes types
- [x] Collect filters from interaction + contentAttributes.filters
- [x] POST /api/viewport after delays; SVERKA button same
- [x] Remove reliance on visible_results-only half path

### Task 3: Cleanup + smoke

**Files:** `scripts/smoke_map_no_db.py`, tests, remove dead primary paths

- [x] Smoke posts viewport, asserts compare
- [x] Keep `/api/debug/sql-snapshot` optional
- [x] Full unittest + HTTP smoke on 8041
- [ ] Commit + push

---
