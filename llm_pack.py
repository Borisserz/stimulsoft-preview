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
    # UTF-8 JSON with real Cyrillic (payment names). Caller MUST send charset=utf-8.
    return json.dumps(json_safe(pack), ensure_ascii=False, indent=2)


def build_results_digest(
    results: dict[str, Any] | None, *, max_rows_per_source: int = 5
) -> str:
    """Human-readable preview so you see names/numbers without scrolling the full pack."""
    results = dict(results or {})
    if not results:
        return "NO RESULTS YET — wait for dashboard queries, then press refresh (not verify)."
    lines: list[str] = ["RESULTS DIGEST (names + numbers from SQL adapters):"]
    for name in sorted(results.keys()):
        payload = results.get(name) or {}
        rows = list(payload.get("rows") or [])
        row_count = payload.get("row_count", len(rows))
        lines.append(f"- {name}: row_count={row_count}")
        for i, row in enumerate(rows[: max(0, max_rows_per_source)]):
            lines.append(f"    [{i}] {json.dumps(json_safe(row), ensure_ascii=False)}")
        if len(rows) > max_rows_per_source:
            lines.append(f"    ... +{len(rows) - max_rows_per_source} more rows")
    return "\n".join(lines)


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


# Interaction / widget metadata — not report variables (Year/Month/…).
_BLOCKED_FILTER_KEYS = {
    "elementName",
    "isChecked",
    "ComponentName",
    "componentName",
    "name",
    "text",
    "sender",
    "event",
    "action",
    "preventDefault",
    "async",
    "data",
    "report",
    "page",
    "pages",
    "value",
    "values",
    "checked",
    "enabled",
    "visible",
}


def is_real_filter_key(key: Any) -> bool:
    """Drop UI junk from interaction flatten: '0','1', '__action', button meta."""
    name = str(key or "").strip()
    if not name or name.startswith("__"):
        return False
    if name.isdigit():
        return False
    if name in _BLOCKED_FILTER_KEYS:
        return False
    # allow year/month/vtypevd/trendtype/... — must start with a letter
    first = name[0]
    return first.isalpha() or first == "_"


def sanitize_filters(filters: dict[str, Any] | None) -> dict[str, Any]:
    return {str(k): v for k, v in dict(filters or {}).items() if is_real_filter_key(k)}


def build_verify_report(
    *,
    filters: dict[str, Any] | None,
    results: dict[str, Any] | None,
    filters_updated_at: str | None,
    applied_log: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    """Compare store filters vs last applied query params vs captured results freshness."""
    filters = sanitize_filters(filters)
    results = dict(results or {})
    applied_log = list(applied_log or [])
    issues: list[str] = []

    filter_keys = set(filters.keys())
    # latest apply per datasource
    latest: dict[str, dict[str, Any]] = {}
    for item in applied_log:
        ds = str(item.get("dataSource") or "")
        if ds:
            latest[ds] = item

    for ds, item in latest.items():
        applied = sanitize_filters(dict(item.get("applied_params") or {}))
        for key in filter_keys:
            if key not in applied:
                continue
            if _norm(applied.get(key)) != _norm(filters.get(key)):
                issues.append(
                    f"mismatch:{ds}:{key}:filter={filters.get(key)!r}:applied={applied.get(key)!r}"
                )

        snap = sanitize_filters(dict(item.get("filters_snapshot") or {}))
        snap_ok = True
        for key in filter_keys:
            if key not in snap:
                continue
            if _norm(snap.get(key)) != _norm(filters.get(key)):
                snap_ok = False
                issues.append(
                    f"snapshot_mismatch:{ds}:{key}:filter={filters.get(key)!r}:snapshot={snap.get(key)!r}"
                )

        captured_at = str(item.get("captured_at") or "")
        # Many dashboard SQL adapters have empty applied_params (vars go via PrepareVariables).
        # Treat as fresh when filters_snapshot already matches current filters.
        if (
            filters_updated_at
            and captured_at
            and captured_at < str(filters_updated_at)
            and not snap_ok
        ):
            issues.append(
                f"stale:{ds}:captured_at={captured_at}:filters_updated_at={filters_updated_at}"
            )

    if not results:
        issues.append("empty_results")
    if filter_keys and not latest and not results:
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
                    "applied_params": sanitize_filters(
                        (payload or {}).get("applied_params") or {}
                    ),
                }
                for name, payload in results.items()
            },
        }
    )
