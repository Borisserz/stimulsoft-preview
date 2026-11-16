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


def _rules_from_filter_list(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    rules: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        path = (
            item.get("path")
            or item.get("column")
            or item.get("columnName")
            or item.get("name")
            or item.get("key")
        )
        if path is None or path == "":
            continue
        if "value" not in item and "values" not in item:
            continue
        value = item.get("value") if "value" in item else item.get("values")
        rules.append(
            {
                "path": str(path),
                "value": value,
                "condition": str(item.get("condition") or "EqualTo"),
            }
        )
    return rules


def _bags_with_filters(interaction: dict[str, Any]) -> list[dict[str, Any]]:
    """Stimulsoft puts Apply-Filter in filteringParameters, region drill-in in drillDownParameters."""
    bags: list[dict[str, Any]] = []
    for key in (
        "filteringParameters",
        "drillDownParameters",
        "dashboardElementDrillDownParameters",
    ):
        bag = interaction.get(key)
        if isinstance(bag, dict):
            bags.append(bag)
        elif isinstance(bag, list):
            # DashboardDrillDown / report DrillDown: list of param objects
            for item in bag:
                if isinstance(item, dict) and (
                    "filters" in item or "path" in item or "value" in item
                ):
                    bags.append(item)
    return bags


def extract_dashboard_filter_rules(
    interaction: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    """Pull FilterRule path/value from filter OR element-drill-down bags."""
    if not interaction or not isinstance(interaction, dict):
        return []
    rules: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for bag in _bags_with_filters(interaction):
        for rule in _rules_from_filter_list(bag.get("filters")):
            key = (rule["path"], _norm(rule.get("value")))
            if key in seen:
                continue
            seen.add(key)
            rules.append(rule)
        # single rule shaped object
        for rule in _rules_from_filter_list([bag]):
            key = (rule["path"], _norm(rule.get("value")))
            if key in seen:
                continue
            seen.add(key)
            rules.append(rule)
    return rules


def enrich_interaction(interaction: dict[str, Any] | None) -> dict[str, Any] | None:
    """Normalize button / map / drill-down interaction for the LLM pack."""
    if not interaction or not isinstance(interaction, dict):
        return interaction
    out = dict(interaction)
    action = str(out.get("action") or "")
    for bag_key in (
        "filteringParameters",
        "drillDownParameters",
        "dashboardElementDrillDownParameters",
    ):
        bag = out.get(bag_key)
        if not isinstance(bag, dict):
            continue
        name = bag.get("elementName")
        if name is not None and "element" not in out:
            out["element"] = str(name)
        if "isChecked" in bag:
            out["button_checked"] = bool(bag.get("isChecked"))
        if "Button" in action or (
            name is not None and str(name).startswith("Button")
        ):
            out["button"] = str(name)
    if "DrillDown" in action and "DrillUp" not in action:
        out["drill_down"] = True
    if "DrillUp" in action:
        out["drill_up"] = True
    rules = extract_dashboard_filter_rules(out)
    if rules:
        out["dashboard_filters"] = rules
    return out


def update_drill_stack(
    stack: list[list[dict[str, Any]]] | None,
    interaction: dict[str, Any] | None,
) -> tuple[list[list[dict[str, Any]]], list[dict[str, Any]]]:
    """Maintain region drill-in levels (DashboardElementDrillDown / DrillUp)."""
    stack = [list(level) for level in list(stack or [])]
    if not interaction or not isinstance(interaction, dict):
        flat = [rule for level in stack for rule in level]
        return stack, flat
    action = str(interaction.get("action") or "")
    rules = extract_dashboard_filter_rules(interaction)
    if action == "DashboardElementDrillDown" and rules:
        stack.append(rules)
    elif action == "DashboardElementDrillUp":
        if stack:
            stack.pop()
    elif action in {
        "DashboardResetAllFilters",
        "InitVars",
    }:
        stack.clear()
    flat = [rule for level in stack for rule in level]
    return stack, flat


def _column_tail(name: Any) -> str:
    text = str(name or "")
    if "." in text:
        text = text.rsplit(".", 1)[-1]
    return text.strip().lower()


def _row_matches_rule(row: dict[str, Any], rule: dict[str, Any]) -> bool:
    want = _norm(rule.get("value"))
    path = str(rule.get("path") or "")
    tail = _column_tail(path)
    matched_col = False
    for key, cell in row.items():
        key_s = str(key)
        if key_s.lower() == path.lower() or _column_tail(key_s) == tail:
            matched_col = True
            if _norm(cell) == want:
                return True
    if matched_col:
        return False
    # no matching column name — keep row only if any cell equals the filter value
    # (helps when path is internal meter id but region name is in another column)
    return any(_norm(cell) == want for cell in row.values())


def apply_rules_to_results(
    results: dict[str, Any] | None,
    rules: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    """Filter captured SQL rows to the active map/table dashboard filters."""
    results = {k: dict(v or {}) for k, v in dict(results or {}).items()}
    rules = list(rules or [])
    if not rules:
        return results
    out: dict[str, Any] = {}
    for name, payload in results.items():
        rows = list(payload.get("rows") or [])
        dict_rows = [r for r in rows if isinstance(r, dict)]
        if not dict_rows:
            out[name] = payload
            continue
        # If none of the columns relate to any rule path and no cell equals
        # values, leave source as-is (KPI without region column).
        paths = {_column_tail(r.get("path")) for r in rules}
        has_path_col = any(_column_tail(k) in paths for r in dict_rows for k in r.keys())
        has_value_hit = any(
            any(_norm(cell) == _norm(rule.get("value")) for cell in r.values())
            for r in dict_rows
            for rule in rules
        )
        if not has_path_col and not has_value_hit:
            out[name] = payload
            continue
        kept = [r for r in rows if isinstance(r, dict) and all(
            _row_matches_rule(r, rule) for rule in rules
        )]
        new_payload = dict(payload)
        new_payload["rows"] = kept
        new_payload["row_count"] = len(kept)
        new_payload["filtered_by"] = rules
        out[name] = new_payload
    return out


def build_llm_pack(
    *,
    filters: dict[str, Any] | None,
    interaction: dict[str, Any] | None,
    results: dict[str, Any] | None,
    meta: dict[str, Any] | None = None,
    apply_dashboard_filters: bool = True,
    drill_stack: list[list[dict[str, Any]]] | None = None,
) -> dict[str, Any]:
    interaction = enrich_interaction(interaction)
    event_rules = extract_dashboard_filter_rules(interaction)
    stacked = [rule for level in list(drill_stack or []) for rule in level]
    # Prefer full drill stack (all levels); fall back to this event's rules
    # (Apply Filter without element drill-down).
    rules = stacked or event_rules
    # de-dupe while preserving order
    seen: set[tuple[str, str]] = set()
    uniq: list[dict[str, Any]] = []
    for rule in rules:
        key = (str(rule.get("path")), _norm(rule.get("value")))
        if key in seen:
            continue
        seen.add(key)
        uniq.append(rule)
    rules = uniq
    raw_results = dict(results or {})
    view_results = (
        apply_rules_to_results(raw_results, rules)
        if apply_dashboard_filters and rules
        else raw_results
    )
    pack: dict[str, Any] = {
        "filters": dict(filters or {}),
        "interaction": interaction,
        "results": view_results,
    }
    if rules:
        pack["dashboard_filters"] = rules
    if drill_stack:
        pack["drill_level"] = len(drill_stack)
        pack["drill_stack"] = list(drill_stack)
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
