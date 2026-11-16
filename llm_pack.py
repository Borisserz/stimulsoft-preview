"""Build LLM-facing packs from Stimulsoft data-adapter results (no SQL / no MRT logic)."""

from __future__ import annotations

import json
from datetime import date, datetime, time
from decimal import Decimal
from typing import Any
from uuid import UUID


def _clean_str(text: str) -> str:
    # drop NULs / unpaired surrogates / most controls that break JSON.parse on some browsers
    out: list[str] = []
    for ch in text:
        o = ord(ch)
        if o == 0:
            continue
        if o < 32 and ch not in "\t\n\r":
            continue
        if 0xD800 <= o <= 0xDFFF:
            continue
        out.append(ch)
    return "".join(out)


def json_safe(value: Any) -> Any:
    """Convert Postgres/adapter values into JSON-serializable forms."""
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return _clean_str(value)
    if isinstance(value, Decimal):
        # keep scale as string so LLM sees exact money/amounts
        return format(value, "f")
    if isinstance(value, datetime):
        return value.isoformat(sep=" ", timespec="seconds")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, time):
        return value.isoformat(timespec="seconds")
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, (bytes, bytearray, memoryview)):
        raw = bytes(value)
        try:
            return _clean_str(raw.decode("utf-8"))
        except UnicodeDecodeError:
            return raw.hex()
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(v) for v in value]
    return _clean_str(str(value))


def dumps_llm_pack(pack: Any) -> str:
    # ensure_ascii=True: pure ASCII JSON, no mojibake squares on Windows codepages
    return json.dumps(json_safe(pack), ensure_ascii=True, indent=2)


def rows_as_records(
    columns: list[Any] | None, rows: list[Any] | None
) -> list[Any]:
    cols = list(columns or [])
    raw = list(rows or [])
    if not cols:
        return json_safe(raw)
    out: list[dict[str, Any]] = []
    for row in raw:
        if isinstance(row, (list, tuple)):
            out.append(
                {
                    str(cols[i]): json_safe(row[i])
                    for i in range(min(len(cols), len(row)))
                }
            )
        elif isinstance(row, dict):
            out.append(json_safe(row))
        else:
            out.append({"value": json_safe(row)})
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
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    pack: dict[str, Any] = {
        "filters": dict(filters or {}),
        "interaction": interaction,
        "results": dict(results or {}),
    }
    if meta is not None:
        pack["meta"] = dict(meta)
    return json_safe(pack)


def _norm(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, float):
        if value.is_integer():
            return str(int(value))
        return str(value)
    text = str(value).strip()
    if text.endswith(".0"):
        try:
            float(text)
            return text[:-2]
        except ValueError:
            pass
    return text


def build_verify_report(
    *,
    filters: dict[str, Any] | None,
    results: dict[str, Any] | None,
    filters_updated_at: str | None,
    applied_log: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    """Compare store filters vs last applied query params vs captured results freshness."""
    filters = dict(filters or {})
    results = dict(results or {})
    applied_log = list(applied_log or [])
    issues: list[str] = []

    filter_keys = {k for k in filters.keys() if not str(k).startswith("__")}
    # latest apply per datasource
    latest: dict[str, dict[str, Any]] = {}
    for item in applied_log:
        ds = str(item.get("dataSource") or "")
        if ds:
            latest[ds] = item

    for ds, item in latest.items():
        applied = dict(item.get("applied_params") or {})
        for key in filter_keys:
            if key not in applied:
                continue
            if _norm(applied.get(key)) != _norm(filters.get(key)):
                issues.append(
                    f"mismatch:{ds}:{key}:filter={filters.get(key)!r}:applied={applied.get(key)!r}"
                )

        snap = dict(item.get("filters_snapshot") or {})
        for key in filter_keys:
            if key in snap and _norm(snap.get(key)) != _norm(filters.get(key)):
                issues.append(
                    f"snapshot_mismatch:{ds}:{key}:filter={filters.get(key)!r}:snapshot={snap.get(key)!r}"
                )

        captured_at = str(item.get("captured_at") or "")
        if filters_updated_at and captured_at and captured_at < str(filters_updated_at):
            issues.append(f"stale:{ds}:captured_at={captured_at}:filters_updated_at={filters_updated_at}")

    if not results:
        issues.append("empty_results")
    if filter_keys and not latest:
        issues.append("no_applied_queries_yet")

    return json_safe(
        {
            "ok": len(issues) == 0,
            "issues": issues,
            "filters": filters,
            "filters_updated_at": filters_updated_at,
            "sources": sorted(results.keys()),
            "applied_sources": sorted(latest.keys()),
            "applied_log_tail": applied_log[-20:],
            "result_meta": {
                name: {
                    "row_count": (payload or {}).get("row_count"),
                    "captured_at": (payload or {}).get("captured_at"),
                    "applied_params": (payload or {}).get("applied_params"),
                }
                for name, payload in results.items()
            },
        }
    )
