"""Real on-screen numbers only. No invented map amounts or empty pivots."""

from __future__ import annotations

import re
from typing import Any

_ICON = re.compile(r"[\ue000-\uf8ff]")
_WS = re.compile(r"\s+")
_DROP_COL = {
    "сводная таблица",
    "вид бюджета",
    "cancel",
    "отмена",
    "close",
    "закрыть",
}


def clean_text(value: Any) -> str:
    s = "" if value is None else str(value)
    s = _ICON.sub("", s).replace("\u00a0", " ").replace("&nbsp;", " ")
    return _WS.sub(" ", s).strip()


def short_column(name: Any) -> str:
    parts = [clean_text(p) for p in str(name or "").split("/")]
    kept = [p for p in parts if p and p.lower() not in _DROP_COL]
    return " / ".join(kept) if kept else clean_text(name)


def _norm_region(name: str) -> str:
    t = clean_text(name).lower().replace("ё", "е")
    if "брест" in t:
        return "Брестская"
    if "гомел" in t:
        return "Гомельская"
    if "гродн" in t:
        return "Гродненская"
    if "могил" in t:
        return "Могилёвская"
    if "витеб" in t:
        return "Витебская"
    if "минская" in t:
        return "Минская"
    if t == "минск":
        return "Минск"
    return clean_text(name)


def _is_zero(value: Any) -> bool:
    s = clean_text(value).replace(" ", "").replace("%", "").replace("руб.", "").replace("руб", "")
    s = s.replace(",", ".")
    return bool(re.fullmatch(r"0+(\.0+)?", s))


def _row_has_real_number(row: dict[str, Any]) -> bool:
    for v in row.values():
        s = clean_text(v)
        if not s:
            continue
        if re.search(r"\d", s) and not _is_zero(s):
            return True
    return False


def facts_from_viewport(viewport: dict[str, Any] | None) -> dict[str, Any]:
    vp = viewport if isinstance(viewport, dict) else {}
    elements = vp.get("elements") if isinstance(vp.get("elements"), list) else []
    filters = vp.get("filters") if isinstance(vp.get("filters"), dict) else {}
    cards: list[dict[str, Any]] = []
    kpi: list[dict[str, Any]] = []
    buttons: list[dict[str, Any]] = []
    map_numbers: list[dict[str, Any]] = []
    map_names: list[str] = []
    seen_regions: set[str] = set()
    tables: list[dict[str, Any]] = []

    for el in elements:
        if not isinstance(el, dict):
            continue
        etype = str(el.get("type") or "")
        name = str(el.get("name") or "")
        text = clean_text(el.get("text"))
        if "Cards" in etype and text:
            cards.append({"name": name, "text": text})
        elif ("Indicator" in etype or "Progress" in etype or "Gauge" in etype) and text:
            kpi.append({"name": name, "text": text})
        elif "Button" in etype:
            buttons.append(
                {
                    "name": name,
                    "text": text or None,
                    "checked": el.get("checked") if "checked" in el else None,
                }
            )
        elif "Map" in etype:
            for reg in el.get("regions") or []:
                if not isinstance(reg, dict) or not reg.get("name"):
                    continue
                rname = _norm_region(str(reg.get("name")))
                if not rname or len(rname) > 40:
                    continue
                amount = clean_text(reg.get("amount")) or None
                percent = clean_text(reg.get("percent")) or None
                if percent and "руб" in percent.lower():
                    percent = None
                if amount or percent:
                    map_names[:] = [n for n in map_names if n != rname]
                    if rname not in {x["name"] for x in map_numbers}:
                        map_numbers.append(
                            {"name": rname, "amount": amount, "percent": percent}
                        )
                    seen_regions.add(rname)
                elif rname not in seen_regions:
                    map_names.append(rname)
                    seen_regions.add(rname)
        elif "Pivot" in etype or etype == "StiTableElement":
            raw_cols = list(el.get("columns") or [])
            columns = [short_column(c) for c in raw_cols]
            rows_out: list[dict[str, Any]] = []
            for row in el.get("rows") or []:
                if not isinstance(row, dict):
                    continue
                obj: dict[str, Any] = {}
                for i, col in enumerate(raw_cols):
                    key = columns[i] if i < len(columns) else short_column(col)
                    obj[key] = clean_text(row.get(col))
                if _row_has_real_number(obj):
                    rows_out.append(obj)
            tables.append(
                {
                    "name": name,
                    "capture": el.get("capture"),
                    "columns": columns,
                    "rows": rows_out,
                    "row_count": len(rows_out),
                    "status": "ok" if rows_out else "empty_on_screen",
                }
            )

    return {
        "filters": {
            "panel": dict(filters.get("panel") or {})
            if isinstance(filters.get("panel"), dict)
            else {},
            "dashboard": list(filters.get("dashboard") or [])
            if isinstance(filters.get("dashboard"), list)
            else [],
        },
        "cards": cards,
        "kpi": kpi,
        "buttons": buttons,
        "map": {"with_numbers": map_numbers, "names_only": map_names},
        "tables": tables,
    }
