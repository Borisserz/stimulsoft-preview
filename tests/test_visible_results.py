"""Backward-compat alias — viewport is the source of truth now."""

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


class VisibleResultsCompatTests(unittest.TestCase):
    def test_viewport_not_sql(self) -> None:
        c = vd.app.test_client()
        c.delete("/api/params")
        with vd._params_lock:
            vd._RESULTS["payments"] = {
                "columns": ["a"],
                "row_count": 50,
                "rows": [{"a": i} for i in range(50)],
            }
        c.post(
            "/api/viewport",
            json={
                "elements": [
                    {
                        "name": "Table1",
                        "type": "StiTableElement",
                        "columns": ["region"],
                        "rows": [{"region": "X"} for _ in range(10)],
                        "row_count": 10,
                    }
                ]
            },
        )
        pack = c.get("/api/llm-pack").get_json()
        self.assertEqual(pack["results_source"], "viewport")
        self.assertEqual(pack["results"]["Table1"]["row_count"], 10)
        self.assertNotIn("payments", pack["results"])
        text = c.get("/api/compare").get_data().decode("utf-8")
        self.assertIn("VIEWPORT", text)
        self.assertIn("strok=10", text)


if __name__ == "__main__":
    unittest.main()
