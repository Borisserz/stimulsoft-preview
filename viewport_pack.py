"""Viewport pack: visible Stimulsoft dashboard state → LLM / SVERKA."""

from __future__ import annotations

import json
from typing import Any

from llm_pack import dumps_llm_pack, json_safe


def normalize_viewport(raw: Any) -> dict[str, Any]:
    """Validate and normalize a client viewport snapshot."""
    if not isinstance(raw, dict):
        return {
            "captured_at": None,
            "filters": {"panel": {}, "dashboard": []},
            "interaction": None,
            "elements": [],
        }
    filters = raw.get("filters") if isinstance(raw.get("filters"), dict) else {}
    panel = filters.get("panel") if isinstance(filters.get("panel"), dict) else {}
    dashboard = filters.get("dashboard") if isinstance(filters.get("dashboard"), list) else []
    dash_rules: list[dict[str, Any]] = []
    for item in dashboard:
        if not isinstance(item, dict):
            continue
        if item.get("value") in (None, "") and item.get("values") in (None, ""):
            continue
        dash_rules.append(
            {
                "path": item.get("path") or item.get("name") or "map",
                "value": item.get("value") if "value" in item else item.get("values"),
                "condition": item.get("condition") or "EqualTo",
            }
        )

    elements_in = raw.get("elements") if isinstance(raw.get("elements"), list) else []
    elements: list[dict[str, Any]] = []
    for el in elements_in:
        if not isinstance(el, dict):
            continue
        name = str(el.get("name") or "").strip() or "element"
        etype = str(el.get("type") or "Unknown")
        out: dict[str, Any] = {
            "name": name,
            "type": etype,
            "title": el.get("title"),
        }
        if el.get("columns") is not None:
            out["columns"] = list(el.get("columns") or [])
        if el.get("rows") is not None:
            rows = list(el.get("rows") or [])
            out["rows"] = rows
            out["row_count"] = int(el.get("row_count") or len(rows))
        elif el.get("row_count") is not None:
            out["row_count"] = int(el.get("row_count") or 0)
        if "value" in el:
            out["value"] = el.get("value")
        if "text" in el:
            out["text"] = el.get("text")
        if "checked" in el:
            out["checked"] = bool(el.get("checked"))
        if el.get("series") is not None:
            out["series"] = el.get("series")
        if el.get("filters") is not None:
            out["filters"] = el.get("filters")
        # keep small extras for unknown widgets
        extras = {
            k: v
            for k, v in el.items()
            if k
            not in {
                "name",
                "type",
                "title",
                "columns",
                "rows",
                "row_count",
                "value",
                "text",
                "checked",
                "series",
                "filters",
            }
            and v is not None
        }
        if extras and etype in {"Unknown", ""}:
            out["extra"] = extras
        elements.append(out)

    interaction = raw.get("interaction")
    if interaction is not None and not isinstance(interaction, dict):
        interaction = {"raw": interaction}

    return {
        "captured_at": raw.get("captured_at"),
        "filters": {"panel": dict(panel), "dashboard": dash_rules},
        "interaction": interaction,
        "elements": elements,
    }


def build_viewport_pack(viewport: dict[str, Any] | None) -> dict[str, Any]:
    """Build LLM pack from a normalized viewport (never from SQL snapshot)."""
    vp = normalize_viewport(viewport or {})
    results: dict[str, Any] = {}
    for el in vp["elements"]:
        rows = el.get("rows")
        if rows is None and el.get("row_count") is None:
            continue
        # tables and any element that carried row grid
        if rows is not None or el.get("type") == "StiTableElement":
            row_list = list(rows or [])
            results[el["name"]] = {
                "columns": list(el.get("columns") or []),
                "rows": row_list,
                "row_count": int(el.get("row_count") or len(row_list)),
                "title": el.get("title"),
                "type": el.get("type"),
            }

    pack: dict[str, Any] = {
        "results_source": "viewport",
        "captured_at": vp.get("captured_at"),
        "filters": dict(vp["filters"].get("panel") or {}),
        "dashboard_filters": list(vp["filters"].get("dashboard") or []),
        "interaction": vp.get("interaction"),
        "elements": list(vp["elements"]),
        "results": results,
    }
    return json_safe(pack)


def build_viewport_compare_text(pack: dict[str, Any] | None, *, max_rows: int = 15) -> str:
    """Human SVERKA text from viewport pack only."""
    pack = dict(pack or {})
    lines: list[str] = []
    lines.append("========== SVERKA S FRONTOM ==========")
    lines.append("Istochnik=VIEWPORT (to chto narisovano na dashborde).")
    lines.append("NE SQL-snyamka. NE verify-zhurnal.")
    lines.append("")

    if pack.get("results_source") != "viewport" or not pack.get("elements"):
        lines.append("VIEWPORT PUSTO.")
        lines.append("Podozhdi 1-2s posle klika ili nazhmi zelenuyu SVERKA snova.")
        lines.append("======================================")
        return "\n".join(lines)

    if pack.get("captured_at"):
        lines.append(f"captured_at = {pack.get('captured_at')}")
        lines.append("")

    panel = dict(pack.get("filters") or {})
    lines.append("1) FILTRY PANELI (Year/Month/knopki):")
    if panel:
        for k in sorted(panel.keys()):
            lines.append(f"   {k} = {panel[k]}")
    else:
        lines.append("   (pusto)")

    dash = list(pack.get("dashboard_filters") or [])
    lines.append("")
    lines.append("2) FILTRY KARTY / ELEMENTOV:")
    if dash:
        for rule in dash:
            lines.append(
                f"   {rule.get('path')} = {rule.get('value')}"
                f"  ({rule.get('condition') or 'EqualTo'})"
            )
    else:
        lines.append("   (net)")

    inter = dict(pack.get("interaction") or {})
    lines.append("")
    lines.append("3) POSLEDNIY KLIK:")
    lines.append(f"   action = {inter.get('action') or '-'}")
    if inter.get("element"):
        lines.append(f"   element = {inter.get('element')}")
    if inter.get("button"):
        lines.append(f"   button = {inter.get('button')}")

    elements = list(pack.get("elements") or [])
    lines.append("")
    lines.append("4) ELEMENTY DASHBORDA (kak na ekrane):")
    table_rows_total = 0
    for el in elements:
        name = el.get("name")
        etype = el.get("type")
        title = el.get("title") or ""
        lines.append("")
        lines.append(f"   [{name}] type={etype} title={title!r}")
        if el.get("rows") is not None:
            rows = list(el.get("rows") or [])
            rc = int(el.get("row_count") or len(rows))
            table_rows_total += rc
            shown = min(len(rows), max(0, max_rows))
            lines.append(f"      strok={rc}  pokazano_zdes={shown}")
            for i, row in enumerate(rows[: max(0, max_rows)]):
                lines.append(
                    f"      {i+1}) {json.dumps(json_safe(row), ensure_ascii=False)}"
                )
            if len(rows) > max_rows:
                lines.append(
                    f"      ... eshche {len(rows) - max_rows} iz {rc} "
                    f"(pechat max {max_rows})"
                )
        elif el.get("value") is not None or el.get("text") is not None:
            lines.append(f"      value={el.get('value')!r} text={el.get('text')!r}")
        elif el.get("checked") is not None:
            lines.append(f"      checked={el.get('checked')}")
        elif el.get("series") is not None:
            lines.append(
                f"      series={json.dumps(json_safe(el.get('series')), ensure_ascii=False)[:500]}"
            )
        else:
            lines.append("      (net chislennyh/strokevyh dannyh — tolko meta)")

    lines.append("")
    lines.append(
        f"ITOGO elementov={len(elements)} table_strok={table_rows_total}"
    )
    lines.append("")
    lines.append("======================================")
    lines.append("JSON: knopka JSON ili /api/llm-pack")
    lines.append("Tekst: /api/compare")
    return "\n".join(lines)


def dumps_viewport_pack(pack: Any) -> str:
    return dumps_llm_pack(pack)
