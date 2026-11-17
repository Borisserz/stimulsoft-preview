"""POST /api/query sets year, month, and money type for the viewer."""

from __future__ import annotations

import os
import unittest

os.environ.setdefault("MRT_PATH", "local/dashboard.mrt")
os.environ.setdefault("POSTGRES_HOST", "127.0.0.1")
os.environ.setdefault("POSTGRES_PORT", "1")
os.environ.setdefault("POSTGRES_DB", "smoke")
os.environ.setdefault("POSTGRES_USER", "smoke")
os.environ.setdefault("POSTGRES_PASSWORD", "smoke")
os.environ.setdefault("VIEWER_OPEN", "0")

import view_dashboard as vd
from query_request import QueryFilterError, filters_from_body, viewer_path


class QueryFilterUnitTests(unittest.TestCase):
    def test_money_maps_to_typenum_and_viewer_url(self) -> None:
        params = filters_from_body({"year": 2025, "month": 2, "money": 1})
        self.assertEqual(params, {"year": "2025", "month": "2", "typenum": "1"})
        self.assertEqual(viewer_path(params), "/viewer?year=2025&month=2&typenum=1")

    def test_region_is_rejected(self) -> None:
        with self.assertRaises(QueryFilterError):
            filters_from_body({"year": 2025, "region": "Минск"})

    def test_month_out_of_range(self) -> None:
        with self.assertRaises(QueryFilterError):
            filters_from_body({"month": 13})


class QueryApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = vd.app.test_client()
        self.client.delete("/api/params")

    def test_post_stores_filters_and_drops_old_pack(self) -> None:
        self.client.post(
            "/api/viewport",
            json={
                "captured_at": "old",
                "filters": {"panel": {}},
                "elements": [
                    {
                        "name": "OldTable",
                        "type": "StiTableElement",
                        "columns": ["a"],
                        "rows": [{"a": "stale"}],
                        "row_count": 1,
                    }
                ],
            },
        )
        resp = self.client.post(
            "/api/query",
            json={"year": "2025", "month": "2", "money": "1"},
        )
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertEqual(body["params"]["typenum"], "1")
        self.assertEqual(body["viewer"], "/viewer?year=2025&month=2&typenum=1")
        self.assertFalse(body["ready"])
        pack = self.client.get("/api/llm-pack").get_json()
        self.assertNotIn("OldTable", pack.get("results") or {})
        self.assertEqual(vd.params_snapshot()["year"], "2025")
