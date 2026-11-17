"""Viewport snapshot is the only source for llm-pack / compare."""

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
from viewport_pack import build_viewport_compare_text, build_viewport_pack


class ViewportPackUnitTests(unittest.TestCase):
    def test_pack_maps_tables_to_results(self) -> None:
        pack = build_viewport_pack(
            {
                "captured_at": "t0",
                "filters": {
                    "panel": {"Year": "2024"},
                    "dashboard": [
                        {"path": "map", "value": "Брестская", "condition": "MapEqualTo"}
                    ],
                },
                "interaction": {"action": "DashboardFiltering"},
                "elements": [
                    {
                        "name": "Table1",
                        "type": "StiTableElement",
                        "title": "Payments",
                        "columns": ["region", "name"],
                        "rows": [{"region": "Брестская", "name": f"p{i}"} for i in range(10)],
                        "row_count": 10,
                    },
                    {
                        "name": "KPI1",
                        "type": "StiIndicatorElement",
                        "title": "Sum",
                        "value": "100",
                        "text": "100",
                    },
                ],
            }
        )
        self.assertEqual(pack["results_source"], "viewport")
        self.assertEqual(pack["results"]["Table1"]["row_count"], 10)
        self.assertEqual(pack["dashboard_filters"][0]["value"], "Брестская")
        self.assertEqual(len(pack["elements"]), 2)
        text = build_viewport_compare_text(pack, max_rows=3)
        self.assertIn("VIEWPORT", text)
        self.assertIn("Table1", text)
        self.assertIn("strok=10", text)
        self.assertIn("KPI1", text)
        self.assertIn("100", text)

    def test_compare_shows_export_debug(self) -> None:
        pack = build_viewport_pack(
            {
                "elements": [
                    {
                        "name": "T1",
                        "type": "StiTableElement",
                        "columns": ["a"],
                        "rows": [{"a": 1}],
                        "row_count": 1,
                        "capture": "html_sti",
                    }
                ],
                "export_debug": [
                    {
                        "name": "T1",
                        "ok": False,
                        "capture": None,
                        "rows": None,
                        "reason": "no_component report=no",
                        "prev_capture": "html_sti",
                    }
                ],
            }
        )
        text = build_viewport_compare_text(pack)
        self.assertIn("TABLE DATA PIPELINE", text)
        self.assertIn("no_component", text)
        self.assertIn("html_sti", text)


class ViewportApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = vd.app.test_client()
        self.client.delete("/api/params")

    def test_viewport_overrides_sql_and_drives_pack(self) -> None:
        with vd._params_lock:
            vd._RESULTS["payments"] = {
                "columns": ["a"],
                "row_count": 50,
                "rows": [{"a": i} for i in range(50)],
            }

        body = {
            "captured_at": "2026-11-16T12:00:00",
            "filters": {
                "panel": {"Year": "2024"},
                "dashboard": [
                    {"path": "map", "value": "Брестская", "condition": "MapEqualTo"}
                ],
            },
            "interaction": {"action": "DashboardFiltering", "element": "Map1"},
            "elements": [
                {
                    "name": "Table1",
                    "type": "StiTableElement",
                    "title": "T",
                    "columns": ["region"],
                    "rows": [{"region": "Брестская"} for _ in range(10)],
                    "row_count": 10,
                }
            ],
        }
        r = self.client.post("/api/viewport", json=body)
        self.assertEqual(r.status_code, 200)

        pack = self.client.get("/api/llm-pack").get_json()
        self.assertEqual(pack["results_source"], "viewport")
        self.assertEqual(pack["results"]["Table1"]["row_count"], 10)
        self.assertNotIn("payments", pack["results"])

        text = self.client.get("/api/compare").get_data().decode("utf-8")
        self.assertIn("VIEWPORT", text)
        self.assertIn("strok=10", text)
        self.assertNotIn("strok=50", text)

    def test_empty_viewport_compare_warns(self) -> None:
        text = self.client.get("/api/compare").get_data().decode("utf-8")
        self.assertIn("VIEWPORT PUSTO", text)

    def test_second_viewport_replaces(self) -> None:
        self.client.post(
            "/api/viewport",
            json={
                "elements": [
                    {
                        "name": "Table1",
                        "type": "StiTableElement",
                        "columns": ["x"],
                        "rows": [{"x": 1}],
                        "row_count": 1,
                    }
                ]
            },
        )
        self.client.post(
            "/api/viewport",
            json={
                "elements": [
                    {
                        "name": "Table1",
                        "type": "StiTableElement",
                        "columns": ["x"],
                        "rows": [{"x": 1}, {"x": 2}, {"x": 3}],
                        "row_count": 3,
                    }
                ]
            },
        )
        pack = self.client.get("/api/llm-pack").get_json()
        self.assertEqual(pack["results"]["Table1"]["row_count"], 3)


if __name__ == "__main__":
    unittest.main()
