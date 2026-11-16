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
) -> dict[str, Any]:
    return json_safe(
        {
            "filters": dict(filters or {}),
            "interaction": interaction,
            "results": dict(results or {}),
        }
    )
