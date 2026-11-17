"""Sentence → panel filters plus a region drill that is not applied yet.

Rules run with the model off. A model JSON string fills the same slots.
The answer stays empty until a painted pack and a live Qwen call exist.
"""

from __future__ import annotations

import json
import re
from typing import Any

from query_request import filters_from_body, viewer_path

_MONTHS = (
    ("январ", 1),
    ("феврал", 2),
    ("март", 3),
    ("апрел", 4),
    ("май", 5),
    ("мая", 5),
    ("июн", 6),
    ("июл", 7),
    ("август", 8),
    ("сентябр", 9),
    ("октябр", 10),
    ("ноябр", 11),
    ("декабр", 12),
)

_OBLASTS = (
    ("брест", "Брестская"),
    ("витеб", "Витебская"),
    ("гомел", "Гомельская"),
    ("гродн", "Гродненская"),
    ("могил", "Могилёвская"),
)


def _rules(text: str) -> dict[str, Any]:
    low = text.lower().replace("ё", "е")
    slots: dict[str, Any] = {
        "year": None,
        "month": None,
        "money": None,
        "oblast": None,
        "rayon": None,
    }
    year = re.search(r"20\d{2}", low)
    if year:
        slots["year"] = int(year.group(0))
    for stem, number in _MONTHS:
        if stem in low:
            slots["month"] = number
            break
    money = re.search(r"тип(?:\s+денег)?\s+(\d+)", low)
    if money:
        slots["money"] = money.group(1)
    if "пинск" in low:
        slots["rayon"] = "Пинск"
        slots["oblast"] = "Брестская"
    if "минская" in low or "минской" in low:
        slots["oblast"] = "Минская"
    elif "минск" in low and "пинск" not in low:
        slots["oblast"] = "Минск"
    if slots["oblast"] is None:
        for stem, name in _OBLASTS:
            if stem in low:
                slots["oblast"] = name
                break
    return slots


def _model_slots(raw: str) -> dict[str, Any]:
    start = raw.find("{")
    end = raw.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("model text has no JSON object")
    data = json.loads(raw[start : end + 1])
    if not isinstance(data, dict):
        raise ValueError("model JSON must be an object")
    return data


def plan_ask(text: str, *, model_text: str | None = None) -> dict[str, Any]:
    slots = _model_slots(model_text) if model_text else _rules(text)
    panel: dict[str, Any] = {}
    if slots.get("year") not in (None, ""):
        panel["year"] = slots["year"]
    if slots.get("month") not in (None, ""):
        panel["month"] = slots["month"]
    if slots.get("money") not in (None, ""):
        panel["money"] = slots["money"]
    params = filters_from_body(panel) if panel else {}
    oblast = slots.get("oblast") or None
    rayon = slots.get("rayon") or None
    return {
        "params": params,
        "viewer": viewer_path(params) if params else "/viewer",
        "drill": {
            "oblast": oblast,
            "rayon": rayon,
            "status": "pending" if oblast or rayon else "none",
        },
        "answer": None,
        "model": "off",
    }
