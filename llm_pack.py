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
        return (
            "NO DATA for current filters.\n"
            "Click map/region/button, wait, press refresh.\n"
            "Pack contains only rows matching active filters."
        )
    lines: list[str] = ["RESULTS (current filters only — nothing else):"]
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


def _looks_like_column_path(name: Any) -> bool:
    text = str(name or "").strip()
    if not text:
        return False
    # FilterRule.key is often a GUID — never treat as a data column
    compact = text.replace("-", "")
    if len(text) >= 32 and all(c in "0123456789abcdefABCDEF" for c in compact):
        return False
    if text.isdigit():
        return False
    return True


def _rules_from_filter_list(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    rules: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        # Prefer real column path; never fall back to GUID key
        path = (
            item.get("path")
            or item.get("column")
            or item.get("columnName")
            or item.get("name")
        )
        if path is None or path == "":
            key = item.get("key")
            path = key if _looks_like_column_path(key) else None
        if path is None or path == "" or not _looks_like_column_path(path):
            continue
        if "value" not in item and "values" not in item:
            continue
        value = item.get("value") if "value" in item else item.get("values")
        # Skip empty filter values — they match everything / nothing useful
        if value is None or value == "":
            continue
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
    """Backward-compatible wrapper around update_filter_state."""
    _apply, new_stack, combined = update_filter_state([], stack, interaction)
    return new_stack, combined


def update_filter_state(
    apply_filters: list[dict[str, Any]] | None,
    drill_stack: list[list[dict[str, Any]]] | None,
    interaction: dict[str, Any] | None,
) -> tuple[list[dict[str, Any]], list[list[dict[str, Any]]], list[dict[str, Any]]]:
    """Track Apply-Filter + element drill-in levels across all dashboard elements.

    Returns (apply_filters, drill_stack, combined_rules).
    """
    apply_filters = list(apply_filters or [])
    drill_stack = [list(level) for level in list(drill_stack or [])]
    if not interaction or not isinstance(interaction, dict):
        return apply_filters, drill_stack, _dedupe_rules(apply_filters + _flatten_stack(drill_stack))

    action = str(interaction.get("action") or "")
    rules = extract_dashboard_filter_rules(interaction)

    if action == "DashboardFiltering":
        # Merge by path: second element click must not wipe the first filter
        if not rules:
            # empty filter list from Stimulsoft ≈ clear apply-filters
            apply_filters = []
        else:
            by_path = {str(r.get("path")): r for r in apply_filters}
            for rule in rules:
                by_path[str(rule.get("path"))] = rule
            apply_filters = list(by_path.values())
    elif action == "DashboardElementDrillDown" and rules:
        drill_stack.append(rules)
    elif action == "DashboardElementDrillUp":
        if drill_stack:
            drill_stack.pop()
    elif action in {"DashboardResetAllFilters", "InitVars"}:
        apply_filters = []
        drill_stack.clear()
    elif action == "DashboardDrillDown" and rules:
        # Opening nested dashboard with parameters — treat as apply filters
        apply_filters = _dedupe_rules(apply_filters + rules)

    combined = _dedupe_rules(apply_filters + _flatten_stack(drill_stack))
    return apply_filters, drill_stack, combined


def _flatten_stack(stack: list[list[dict[str, Any]]]) -> list[dict[str, Any]]:
    return [rule for level in stack for rule in level]


def _dedupe_rules(rules: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[tuple[str, str]] = set()
    out: list[dict[str, Any]] = []
    for rule in rules:
        key = (str(rule.get("path")), _norm(rule.get("value")))
        if key in seen:
            continue
        seen.add(key)
        out.append(rule)
    return out


def _column_tail(name: Any) -> str:
    text = str(name or "")
    if "." in text:
        text = text.rsplit(".", 1)[-1]
    return text.strip().lower()


def _row_matches_rule(row: dict[str, Any], rule: dict[str, Any]) -> bool:
    """Strict: only match the filter path against a real column — never any-cell."""
    want = _norm(rule.get("value"))
    path = str(rule.get("path") or "")
    tail = _column_tail(path)
    condition = str(rule.get("condition") or "EqualTo")
    for key, cell in row.items():
        key_s = str(key)
        if key_s.lower() != path.lower() and _column_tail(key_s) != tail:
            continue
        got = _norm(cell)
        if condition in {"equalTo", "EqualTo", "="}:
            return got == want
        if condition in {"notEqualTo", "NotEqualTo", "<>"}:
            return got != want
        # unknown condition → equalTo
        return got == want
    return False


def _source_has_rule_columns(
    dict_rows: list[dict[str, Any]], rules: list[dict[str, Any]]
) -> bool:
    if not dict_rows or not rules:
        return False
    paths = {_column_tail(r.get("path")) for r in rules}
    paths |= {str(r.get("path") or "").lower() for r in rules}
    for row in dict_rows:
        for key in row.keys():
            key_s = str(key)
            if key_s.lower() in paths or _column_tail(key_s) in paths:
                return True
    return False


def _lean_result_payload(
    payload: dict[str, Any], *, rows: list[Any], rules: list[dict[str, Any]]
) -> dict[str, Any]:
    """Only fields the LLM needs — no capture/apply noise."""
    columns = payload.get("columns")
    if not columns and rows and isinstance(rows[0], dict):
        columns = list(rows[0].keys())
    return {
        "columns": list(columns or []),
        "row_count": len(rows),
        "rows": rows,
        "filtered_by": rules,
    }


def _applicable_rules_for_source(
    dict_rows: list[dict[str, Any]], rules: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Only rules whose path exists as a column on this source.

    After drill (region + imns), a map source with only `region` must still
    filter by region — not be wiped because it lacks `imns`.
    """
    return [rule for rule in rules if _source_has_rule_columns(dict_rows, [rule])]


def apply_rules_to_results(
    results: dict[str, Any] | None,
    rules: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    """Keep ONLY real rows matching active filters — nothing else.

    - Strict column path match (no 'any cell equals value').
    - Per source: apply only rules that have a matching column.
    - Sources with no applicable rules → dropped (not leaked unfiltered).
    - Sources with zero matching rows → dropped.
    """
    results = {k: dict(v or {}) for k, v in dict(results or {}).items()}
    rules = list(rules or [])
    if not rules:
        # no active filter — still lean the payloads
        out: dict[str, Any] = {}
        for name, payload in results.items():
            rows = list(payload.get("rows") or [])
            if not rows:
                continue
            out[name] = _lean_result_payload(payload, rows=rows, rules=[])
        return out
    out = {}
    for name, payload in results.items():
        rows = list(payload.get("rows") or [])
        dict_rows = [r for r in rows if isinstance(r, dict)]
        if not dict_rows:
            continue
        applicable = _applicable_rules_for_source(dict_rows, rules)
        if not applicable:
            continue
        kept = [
            r
            for r in rows
            if isinstance(r, dict)
            and all(_row_matches_rule(r, rule) for rule in applicable)
        ]
        if not kept:
            continue
        out[name] = _lean_result_payload(payload, rows=kept, rules=applicable)
    return out


def _slim_interaction(interaction: dict[str, Any] | None) -> dict[str, Any] | None:
    """Drop bulky Stimulsoft dumps; keep what the LLM needs about the click."""
    if not interaction or not isinstance(interaction, dict):
        return interaction
    keep_keys = (
        "action",
        "event",
        "element",
        "button",
        "button_checked",
        "drill_down",
        "drill_up",
        "drill_level",
        "dashboard_filters",
        "apply_filter_count",
    )
    slim = {k: interaction[k] for k in keep_keys if k in interaction}
    return slim or {"action": interaction.get("action")}


def build_llm_pack(
    *,
    filters: dict[str, Any] | None,
    interaction: dict[str, Any] | None,
    results: dict[str, Any] | None,
    meta: dict[str, Any] | None = None,
    apply_dashboard_filters: bool = True,
    drill_stack: list[list[dict[str, Any]]] | None = None,
    apply_filters: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    interaction = enrich_interaction(interaction)
    event_rules = extract_dashboard_filter_rules(interaction)
    stacked = _flatten_stack(list(drill_stack or []))
    applied = list(apply_filters or [])
    # Combine Apply-Filter + all drill levels; fall back to this event only
    rules = _dedupe_rules(applied + stacked) or event_rules
    raw_results = dict(results or {})
    if apply_dashboard_filters:
        view_results = apply_rules_to_results(raw_results, rules)
    else:
        view_results = apply_rules_to_results(raw_results, [])
    pack: dict[str, Any] = {
        "filters": dict(filters or {}),
        "interaction": _slim_interaction(interaction),
        "results": view_results,
        "dashboard_filters": rules,
    }
    if drill_stack:
        pack["drill_level"] = len(drill_stack)
    if meta is not None:
        # keep meta small
        pack["meta"] = {
            k: meta[k]
            for k in (
                "filters_updated_at",
                "drill_level",
                "apply_filter_count",
            )
            if k in meta
        }
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
