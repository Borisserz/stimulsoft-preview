"""Atlas pack: multi-page inventory."""

from __future__ import annotations

import os
import unittest

os.environ.setdefault("MRT_PATH", "local/dashboard.mrt")

from atlas_pack import (  # noqa: E402
    apply_atlas_post,
    build_atlas_text,
    normalize_atlas,
)
import view_dashboard as vd  # noqa: E402


class AtlasPackTests(unittest.TestCase):
    def test_replace_and_append(self) -> None:
        base = apply_atlas_post(
            None,
            {
                "replace": True,
                "captured_at": "t0",
                "pages": [
                    {
                        "label": "page0",
                        "kind": "auto_page",
                        "page_index": 0,
                        "page_name": "Dashboard1",
                        "viewport": {
                            "elements": [
                                {
                                    "name": "ButtonElement1",
                                    "type": "StiButtonElement",
                                    "text": "С выполнением плана",
                                },
                                {
                                    "name": "PivotTableElement13",
                                    "type": "StiPivotTableElement",
                                    "row_count": 81,
                                    "columns": ["a"],
                                    "rows": [{"a": 1}],
                                    "capture": "pivot_viewer",
                                },
                            ]
                        },
                    }
                ],
            },
        )
        self.assertEqual(base["page_count"], 1)
        self.assertIn("С выполнением плана", base["pages"][0]["highlights"]["button_texts"])
        self.assertIn("PivotTableElement13", base["pages"][0]["highlights"]["pivot_names"])

        added = apply_atlas_post(
            base,
            {
                "page": {
                    "label": "drill Pinsk",
                    "kind": "manual",
                    "page_index": 0,
                    "filters": {"dashboard": [{"path": "drill", "value": "Пинск"}]},
                    "viewport": {
                        "elements": [
                            {
                                "name": "PivotTableElement108",
                                "type": "StiPivotTableElement",
                                "row_count": 16,
                                "rows": [],
                                "capture": "html_grid",
                            }
                        ]
                    },
                }
            },
        )
        self.assertEqual(added["page_count"], 2)
        text = build_atlas_text(added)
        self.assertIn("ATLAS", text)
        self.assertIn("drill Pinsk", text)
        self.assertIn("CHECKLIST", text)
        self.assertIn("PivotTableElement108", text)

    def test_normalize_empty(self) -> None:
        self.assertEqual(normalize_atlas(None)["page_count"], 0)


class AtlasApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = vd.app.test_client()
        with vd._params_lock:
            vd._ATLAS = None

    def test_atlas_routes(self) -> None:
        r = self.client.post(
            "/api/atlas",
            json={
                "replace": True,
                "pages": [
                    {
                        "label": "page0",
                        "kind": "auto_page",
                        "page_index": 0,
                        "viewport": {
                            "elements": [
                                {"name": "T1", "type": "StiTextElement", "text": "Динамика"}
                            ]
                        },
                    }
                ],
            },
        )
        self.assertEqual(r.status_code, 200)
        page = self.client.get("/atlas")
        self.assertEqual(page.status_code, 200)
        self.assertIn(b"ATLAS", page.data)
        text = self.client.get("/api/atlas-text")
        self.assertIn("Динамика", text.get_data(as_text=True))


if __name__ == "__main__":
    unittest.main()
