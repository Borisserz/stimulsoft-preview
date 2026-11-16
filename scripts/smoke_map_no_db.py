#!/usr/bin/env python3
"""Smoke: viewport capture without real MRT rows or Postgres.

Usage:
  .venv/bin/python scripts/smoke_map_no_db.py
  SMOKE_BASE=http://127.0.0.1:8041 .venv/bin/python scripts/smoke_map_no_db.py
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _env_defaults() -> None:
    os.environ.setdefault("MRT_PATH", str(ROOT / "local" / "dashboard.mrt"))
    os.environ.setdefault("VIEWER_OPEN", "0")
    os.environ.setdefault("ALLOW_SMOKE_SEED", "1")
    os.environ.setdefault("POSTGRES_HOST", "127.0.0.1")
    os.environ.setdefault("POSTGRES_PORT", "1")
    os.environ.setdefault("POSTGRES_DB", "smoke")
    os.environ.setdefault("POSTGRES_USER", "smoke")
    os.environ.setdefault("POSTGRES_PASSWORD", "smoke")


VIEWPORT = {
    "captured_at": "smoke",
    "filters": {
        "panel": {"Year": "2024"},
        "dashboard": [
            {"path": "map", "value": "Брестская", "condition": "MapEqualTo"},
            {"path": "map", "value": "Пинск", "condition": "MapEqualTo"},
        ],
    },
    "interaction": {
        "action": "DashboardElementDrillDown",
        "element": "Map1",
    },
    "elements": [
        {
            "name": "Table1",
            "type": "StiTableElement",
            "title": "Payments",
            "columns": ["region", "city", "amount"],
            "rows": [{"region": "Брестская", "city": "Пинск", "amount": "10"}],
            "row_count": 1,
        },
        {
            "name": "KPI1",
            "type": "StiIndicatorElement",
            "title": "Sum",
            "value": "10",
            "text": "10",
        },
    ],
}


def _http(base: str, method: str, path: str, body: dict | None = None) -> tuple[int, str]:
    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    req = urllib.request.Request(
        base.rstrip("/") + path, data=data, headers=headers, method=method
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")


def run_against_base(base: str) -> None:
    code, _ = _http(base, "DELETE", "/api/params")
    assert code == 200, f"clear failed: {code}"
    code, text = _http(base, "POST", "/api/viewport", VIEWPORT)
    assert code == 200, f"viewport failed: {code} {text}"
    code, text = _http(base, "GET", "/api/compare")
    assert code == 200, text
    print(text)
    assert "VIEWPORT" in text
    assert "strok=1" in text
    assert "KPI1" in text
    assert "Барановичи" not in text
    pack_code, pack_text = _http(base, "GET", "/api/llm-pack")
    assert pack_code == 200
    pack = json.loads(pack_text)
    assert pack["results_source"] == "viewport"
    assert pack["results"]["Table1"]["row_count"] == 1
    print("\nSMOKE OK — viewport drives pack/compare")


def run_inprocess() -> None:
    _env_defaults()
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    import view_dashboard as vd

    c = vd.app.test_client()
    assert c.delete("/api/params").status_code == 200
    assert c.post("/api/viewport", json=VIEWPORT).status_code == 200
    # SQL noise must not leak
    with vd._params_lock:
        vd._RESULTS["noise"] = {
            "columns": ["a"],
            "row_count": 50,
            "rows": [{"a": i} for i in range(50)],
        }
    pack = c.get("/api/llm-pack").get_json()
    assert pack["results_source"] == "viewport"
    assert pack["results"]["Table1"]["row_count"] == 1
    assert "noise" not in pack["results"]
    text = c.get("/api/compare").get_data().decode("utf-8")
    print(text)
    assert "VIEWPORT" in text and "strok=1" in text
    print("\nSMOKE OK (in-process viewport, SQL ignored)")


def main() -> int:
    base = os.environ.get("SMOKE_BASE", "").strip()
    if base:
        run_against_base(base)
    else:
        run_inprocess()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
