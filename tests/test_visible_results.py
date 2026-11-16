"""Visible table rows from Stimulsoft DOM must win over raw SQL snapshot."""

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


class VisibleResultsTests(unittest.TestCase):
    def setUp(self) -> None:
        c = vd.app.test_client()
        c.delete("/api/params")
        self.client = c

    def test_visible_results_override_raw_sql_snapshot(self) -> None:
        # raw SQL snapshot: 50 rows (what onEndProcessData captured)
        raw = {
            "columns": ["region", "name"],
            "row_count": 50,
            "rows": [{"region": "X", "name": f"r{i}"} for i in range(50)],
        }
        with vd._params_lock:
            vd._RESULTS["payments"] = raw

        # frontend table after filter: 10 rows
        visible = {
            "Table1": {
                "columns": ["region", "name"],
                "row_count": 10,
                "rows": [
                    {"region": "Брестская", "name": f"p{i}"} for i in range(10)
                ],
                "source": "visible_grid",
            }
        }
        r = self.client.post("/api/params", json={"visible_results": visible})
        self.assertEqual(r.status_code, 200)

        pack = self.client.get("/api/llm-pack").get_json()
        self.assertIn("Table1", pack["results"])
        self.assertEqual(pack["results"]["Table1"]["row_count"], 10)
        self.assertNotIn("payments", pack["results"])
        self.assertEqual(pack.get("results_source"), "visible")

        text = self.client.get("/api/compare").get_data().decode("utf-8")
        self.assertIn("posle_filtra=10", text)
        self.assertIn("VISIBLE", text)
        self.assertNotIn("posle_filtra=50", text)


if __name__ == "__main__":
    unittest.main()
