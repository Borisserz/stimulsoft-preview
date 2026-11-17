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


class FactsTests(unittest.TestCase):
    def test_only_real_map_numbers_and_table_rows(self) -> None:
        from facts_pack import facts_from_viewport

        facts = facts_from_viewport(
            {
                "filters": {"panel": {"year": 2025, "trendtype": "cumulative"}},
                "elements": [
                    {
                        "name": "RegionMapElement1",
                        "type": "StiRegionMapElement",
                        "regions": [
                            {
                                "name": "Брестская",
                                "amount": "7 099,31 руб.",
                                "percent": "31,0 %",
                            },
                            {"name": "Гомельская", "amount": None, "percent": None},
                            {"name": "Могилевская", "amount": None, "percent": None},
                            {
                                "name": "Брестская Брестская7 099",
                                "amount": "7 099,31 руб.",
                                "percent": "31,0 %",
                            },
                        ],
                    },
                    {
                        "name": "CardsElement2",
                        "type": "StiCardsElement",
                        "text": "224 711,64 руб.",
                    },
                    {
                        "name": "IndicatorElement67",
                        "type": "StiIndicatorElement",
                        "text": "100%\ue900",
                    },
                    {
                        "name": "PivotTableElement13",
                        "type": "StiPivotTableElement",
                        "capture": "pivot_viewer",
                        "columns": [
                            "Сводная таблица / Наименование платежа",
                            "Сводная таблица / Регион",
                            "Вид бюджета / Консолидированный / Факт (руб.)",
                        ],
                        "rows": [
                            {
                                "Сводная таблица / Наименование платежа": "НДС",
                                "Сводная таблица / Регион": "Брестская",
                                "Вид бюджета / Консолидированный / Факт (руб.)": "29 370,13",
                            }
                        ],
                        "row_count": 1,
                    },
                    {
                        "name": "PivotTableElement6",
                        "type": "StiPivotTableElement",
                        "capture": "pivot_pending",
                        "columns": ["a"],
                        "rows": [],
                        "row_count": 0,
                    },
                ],
            }
        )
        self.assertEqual(facts["map"]["with_numbers"][0]["name"], "Брестская")
        self.assertEqual(facts["map"]["with_numbers"][0]["percent"], "31,0 %")
        self.assertEqual(len(facts["map"]["with_numbers"]), 1)
        self.assertIn("Гомельская", facts["map"]["names_only"])
        self.assertIn("Могилёвская", facts["map"]["names_only"])
        self.assertEqual(facts["kpi"][0]["text"], "100%")
        self.assertEqual(facts["cards"][0]["text"], "224 711,64 руб.")
        table = facts["tables"][0]
        self.assertEqual(table["status"], "ok")
        self.assertEqual(table["rows"][0]["Регион"], "Брестская")
        self.assertEqual(
            table["rows"][0]["Консолидированный / Факт (руб.)"], "29 370,13"
        )
        self.assertEqual(facts["tables"][1]["status"], "empty_on_screen")
        self.assertEqual(facts["tables"][1]["rows"], [])


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
        self.assertIn("PivotTableElement108", text)
        self.assertIn("С выполнением плана", text)
        self.assertIn("tablica", text)

    def test_second_render_keeps_table_numbers(self) -> None:
        stored = apply_atlas_post(
            None,
            {
                "replace": True,
                "pages": [
                    {
                        "label": "page0",
                        "viewport": {
                            "elements": [
                                {
                                    "name": "CardsElement2",
                                    "type": "StiCardsElement",
                                    "text": "224 711,64 руб.",
                                },
                                {
                                    "name": "PivotTableElement25",
                                    "type": "StiPivotTableElement",
                                    "capture": "pivot_viewer",
                                    "columns": ["Платёж", "Факт"],
                                    "rows": [
                                        {"Платёж": "НДС", "Факт": "29 370,1"},
                                        {"Платёж": "Итого", "Факт": "722 087,2"},
                                    ],
                                    "row_count": 2,
                                },
                            ]
                        },
                    }
                ],
            },
        )
        text = build_atlas_text(stored)
        self.assertIn("224 711,64", text)
        self.assertIn("29 370,1", text)
        self.assertIn("722 087,2", text)

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
