"""Build LLM-facing packs from Stimulsoft data-adapter results (no SQL / no MRT logic)."""

from __future__ import annotations

from typing import Any


def rows_as_records(
    columns: list[Any] | None, rows: list[Any] | None
) -> list[Any]:
    cols = list(columns or [])
    raw = list(rows or [])
    if not cols:
        return raw
    out: list[dict[str, Any]] = []
    for row in raw:
        if isinstance(row, (list, tuple)):
            out.append({str(cols[i]): row[i] for i in range(min(len(cols), len(row)))})
        elif isinstance(row, dict):
            out.append(row)
        else:
            out.append({"value": row})
    return out


def snapshot_from_data_args(args: Any) -> tuple[str, dict[str, Any] | None]:
    """Extract (name, payload) from StiDataEventArgs-like object. Never includes SQL."""
    name = getattr(args, "dataSource", None) or getattr(args, "connection", None) or "unknown"
    name = str(name)
    result = getattr(args, "result", None)
    if result is None:
        return name, None
    columns = list(getattr(result, "columns", None) or [])
    rows = list(getattr(result, "rows", None) or [])
    records = rows_as_records(columns, rows)
    return name, {
        "columns": [str(c) for c in columns],
        "row_count": len(records),
        "rows": records,
    }


def build_llm_pack(
    *,
    filters: dict[str, Any] | None,
    interaction: dict[str, Any] | None,
    results: dict[str, Any] | None,
) -> dict[str, Any]:
    return {
        "filters": dict(filters or {}),
        "interaction": interaction,
        "results": dict(results or {}),
    }
