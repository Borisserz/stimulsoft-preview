"""Dashboard structure inventory for photo → agent."""

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
from structure_pack import build_structure_text, structure_from_viewport


class StructureUnitTests(unittest.TestCase):
    def test_groups_buttons_and_skips_row_dump(self) -> None:
        st = structure_from_viewport(
            {
                "captured_at": "t1",
                "elements": [
                    {
                        "name": "Pivot1",
                        "type": "StiPivotTableElement",
                        "title": "Payments",
                        "columns": ["a", "b"],
                        "rows": [{"a": 1}, {"a": 2}],
                        "row_count": 2,
                        "capture": "html_sti",
                    },
                    {
                        "name": "ButtonBudget",
                        "type": "StiButtonElement",
                        "title": "Местный",
                        "checked": True,
                    },
                    {
                        "name": "KPI1",
                        "type": "StiIndicatorElement",
                        "value": "100",
                        "text": "100",
                    },
                ],
            }
        )
        self.assertEqual(st["element_count"], 3)
        names = [e["name"] for e in st["elements"]]
        self.assertEqual(names[0], "ButtonBudget")
        pivot = next(e for e in st["elements"] if e["name"] == "Pivot1")
        self.assertTrue(pivot["has_rows"])
        self.assertEqual(pivot["row_count"], 2)
        self.assertNotIn("rows", pivot)
        text = build_structure_text(st)
        self.assertIn("KNOPKI", text)
        self.assertIn("ButtonBudget", text)
        self.assertIn("PIVOT", text)
        self.assertNotIn('"a": 1', text)


class StructureApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = vd.app.test_client()

    def test_structure_page_and_api(self) -> None:
        self.client.post(
            "/api/viewport",
            json={
                "elements": [
                    {
                        "name": "Btn1",
                        "type": "StiButtonElement",
                        "title": "Респ",
                        "checked": False,
                    }
                ]
            },
        )
        r = self.client.get("/api/structure")
        self.assertEqual(r.status_code, 200)
        data = r.get_json()
        self.assertEqual(data["element_count"], 1)
        self.assertEqual(data["elements"][0]["name"], "Btn1")
        t = self.client.get("/api/structure-text")
        self.assertIn(b"Btn1", t.data)
        page = self.client.get("/structure")
        self.assertEqual(page.status_code, 200)
        self.assertIn(b"STRUKTURA", page.data)


if __name__ == "__main__":
    unittest.main()
