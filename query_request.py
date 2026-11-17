"""Turn a small filter POST into the variables the viewer already applies.

Year, month, and money type (report variable typenum) only.
A region such as Minsk is a map click, not a variable, so it is rejected here.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import urlencode

_ALLOWED = {"year", "month", "money", "typenum"}


class QueryFilterError(ValueError):
    pass


def _int_field(value: Any, name: str) -> int:
    if isinstance(value, bool) or isinstance(value, (dict, list)) or value is None:
        raise QueryFilterError(f"{name} must be a number")
    text = str(value).strip()
    if not text or not text.lstrip("-").isdigit():
        raise QueryFilterError(f"{name} must be a number")
    return int(text)


def _scalar(value: Any, name: str) -> str:
    if isinstance(value, bool) or isinstance(value, (dict, list)) or value is None:
        raise QueryFilterError(f"{name} must be a number or text")
    text = str(value).strip()
    if not text:
        raise QueryFilterError(f"{name} must be a number or text")
    return text


def filters_from_body(body: dict[str, Any]) -> dict[str, str]:
    if not isinstance(body, dict):
        raise QueryFilterError("need JSON object")
    unknown = [str(key) for key in body if str(key) not in _ALLOWED]
    if unknown:
        raise QueryFilterError("only year, month, money")
    out: dict[str, str] = {}
    if "year" in body:
        year = _int_field(body["year"], "year")
        if year < 2000 or year > 2100:
            raise QueryFilterError("year 2000..2100")
        out["year"] = str(year)
    if "month" in body:
        month = _int_field(body["month"], "month")
        if month < 1 or month > 12:
            raise QueryFilterError("month 1..12")
        out["month"] = str(month)
    if "money" in body or "typenum" in body:
        money = body["money"] if "money" in body else body["typenum"]
        if "money" in body and "typenum" in body and str(body["money"]) != str(body["typenum"]):
            raise QueryFilterError("money and typenum differ")
        out["typenum"] = _scalar(money, "money")
    if not out:
        raise QueryFilterError("need year, month, or money")
    return out


def viewer_path(params: dict[str, str]) -> str:
    return "/viewer?" + urlencode(params)
