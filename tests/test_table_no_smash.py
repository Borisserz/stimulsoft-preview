"""Table elements must stay structured rows/cols — never one smashed text blob."""

from __future__ import annotations

import unittest

from viewport_pack import build_viewport_compare_text, normalize_viewport


class TableNoSmashTests(unittest.TestCase):
    def test_normalize_drops_huge_text_when_rows_present(self) -> None:
        vp = normalize_viewport(
            {
                "elements": [
                    {
                        "name": "Table1",
                        "type": "StiTableElement",
                        "columns": ["a", "b"],
                        "rows": [{"a": "1", "b": "2"}, {"a": "3", "b": "4"}],
                        "row_count": 2,
                        "capture": "html",
                        "text": "a b 1 2 3 4 " * 40,  # smashed dump
                    }
                ]
            }
        )
        el = vp["elements"][0]
        self.assertEqual(el["row_count"], 2)
        self.assertEqual(len(el["rows"]), 2)
        self.assertNotIn("text", el)

    def test_compare_shows_columns_and_rows(self) -> None:
        pack = {
            "results_source": "viewport",
            "filters": {},
            "dashboard_filters": [],
            "interaction": {},
            "elements": [
                {
                    "name": "Table1",
                    "type": "StiTableElement",
                    "title": "T",
                    "columns": ["region", "amount"],
                    "rows": [
                        {"region": "Брестская", "amount": "10"},
                        {"region": "Минская", "amount": "20"},
                    ],
                    "row_count": 2,
                    "capture": "grid",
                }
            ],
            "results": {},
        }
        text = build_viewport_compare_text(pack, max_rows=5)
        self.assertIn("strok=2", text)
        self.assertIn("columns=", text)
        self.assertIn("Брестская", text)
        self.assertNotIn("a b 1 2 3 4", text)


if __name__ == "__main__":
    unittest.main()
