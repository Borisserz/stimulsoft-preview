"""Strict filtering: pack must not show rows the frontend would hide."""

from __future__ import annotations

import unittest

from llm_pack import (
    apply_rules_to_results,
    build_llm_pack,
    update_filter_state,
)


class StrictMatchTests(unittest.TestCase):
    def test_no_any_cell_fallback_keeps_unrelated_out(self):
        # value "1" appears in amount — must NOT keep row via any-cell match
        results = {
            "payments": {
                "columns": ["region", "amount"],
                "row_count": 2,
                "rows": [
                    {"region": "Минская", "amount": "1"},
                    {"region": "Брестская", "amount": "100"},
                ],
            }
        }
        rules = [{"path": "region", "value": "1", "condition": "EqualTo"}]
        filtered = apply_rules_to_results(results, rules)
        # no matching rows → source not included at all
        self.assertEqual(filtered, {})

    def test_drops_sources_without_matching_column(self):
        results = {
            "big_unrelated": {
                "columns": ["x", "y"],
                "row_count": 3,
                "rows": [{"x": 1, "y": 2}, {"x": 3, "y": 4}, {"x": 5, "y": 6}],
            },
            "kpi_singleton": {
                "columns": ["total"],
                "row_count": 1,
                "rows": [{"total": "999"}],
            },
        }
        rules = [{"path": "region", "value": "Брестская", "condition": "EqualTo"}]
        filtered = apply_rules_to_results(results, rules)
        # nothing extra — unrelated and unfiltered KPI are gone
        self.assertNotIn("big_unrelated", filtered)
        self.assertNotIn("kpi_singleton", filtered)
        self.assertEqual(filtered, {})

    def test_strict_path_column_match(self):
        results = {
            "T": {
                "columns": ["region", "amount"],
                "row_count": 2,
                "rows": [
                    {"region": "Брестская", "amount": "10"},
                    {"region": "Минская", "amount": "20"},
                ],
            }
        }
        rules = [{"path": "Data.region", "value": "Брестская", "condition": "EqualTo"}]
        filtered = apply_rules_to_results(results, rules)
        self.assertEqual(filtered["T"]["row_count"], 1)
        self.assertEqual(filtered["T"]["rows"][0]["region"], "Брестская")

    def test_applies_only_rules_that_exist_on_source(self):
        # After drill: region + imns. Map source has only region — must still keep Brest rows.
        results = {
            "map": {
                "columns": ["region", "value"],
                "row_count": 2,
                "rows": [
                    {"region": "Брестская", "value": "10"},
                    {"region": "Минская", "value": "20"},
                ],
            },
            "detail": {
                "columns": ["region", "imns", "amount"],
                "row_count": 3,
                "rows": [
                    {"region": "Брестская", "imns": "A", "amount": "1"},
                    {"region": "Брестская", "imns": "B", "amount": "2"},
                    {"region": "Минская", "imns": "A", "amount": "3"},
                ],
            },
        }
        rules = [
            {"path": "region", "value": "Брестская", "condition": "EqualTo"},
            {"path": "imns", "value": "A", "condition": "EqualTo"},
        ]
        filtered = apply_rules_to_results(results, rules)
        self.assertEqual(filtered["map"]["row_count"], 1)
        self.assertEqual(filtered["map"]["rows"][0]["region"], "Брестская")
        self.assertEqual(filtered["detail"]["row_count"], 1)
        self.assertEqual(filtered["detail"]["rows"][0]["imns"], "A")

    def test_merge_apply_filters_by_path(self):
        apply_f, stack, combined = update_filter_state(
            [],
            [],
            {
                "action": "DashboardFiltering",
                "filteringParameters": {
                    "filters": [{"path": "region", "value": "Брестская"}],
                },
            },
        )
        apply_f, stack, combined = update_filter_state(
            apply_f,
            stack,
            {
                "action": "DashboardFiltering",
                "filteringParameters": {
                    "filters": [{"path": "typenum", "value": "1000000"}],
                },
            },
        )
        paths = {r["path"] for r in combined}
        self.assertEqual(paths, {"region", "typenum"})


class FilterStateTests(unittest.TestCase):
    def test_apply_filter_and_drill_combine(self):
        apply_f: list = []
        stack: list = []
        apply_f, stack, combined = update_filter_state(
            apply_f,
            stack,
            {
                "action": "DashboardFiltering",
                "filteringParameters": {
                    "elementName": "Map1",
                    "filters": [{"path": "region", "value": "Брестская"}],
                },
            },
        )
        self.assertEqual(len(apply_f), 1)
        self.assertEqual(len(stack), 0)
        apply_f, stack, combined = update_filter_state(
            apply_f,
            stack,
            {
                "action": "DashboardElementDrillDown",
                "drillDownParameters": {
                    "elementName": "Map1",
                    "filters": [{"path": "imns", "value": "A"}],
                },
            },
        )
        self.assertEqual([r["value"] for r in combined], ["Брестская", "A"])
        apply_f, stack, combined = update_filter_state(
            apply_f,
            stack,
            {
                "action": "DashboardElementDrillUp",
                "drillDownParameters": {"elementName": "Map1"},
            },
        )
        self.assertEqual([r["value"] for r in combined], ["Брестская"])

    def test_reset_clears_all(self):
        apply_f, stack, combined = update_filter_state(
            [{"path": "region", "value": "X"}],
            [[{"path": "imns", "value": "Y"}]],
            {"action": "DashboardResetAllFilters"},
        )
        self.assertEqual(apply_f, [])
        self.assertEqual(stack, [])
        self.assertEqual(combined, [])

    def test_pack_hides_extra_rows(self):
        pack = build_llm_pack(
            filters={},
            interaction={
                "action": "DashboardElementDrillDown",
                "drillDownParameters": {
                    "elementName": "Map1",
                    "filters": [{"path": "region", "value": "Брестская"}],
                },
            },
            results={
                "payments": {
                    "columns": ["region", "name", "amount"],
                    "row_count": 3,
                    "rows": [
                        {"region": "Брестская", "name": "Налог", "amount": "10"},
                        {"region": "Минская", "name": "Налог", "amount": "20"},
                        {"region": "Брестская", "name": "Пошлина", "amount": "5"},
                    ],
                },
                "noise": {
                    "columns": ["a", "b"],
                    "row_count": 2,
                    "rows": [{"a": 1, "b": 2}, {"a": 3, "b": 4}],
                },
            },
            drill_stack=[
                [{"path": "region", "value": "Брестская", "condition": "EqualTo"}]
            ],
            apply_filters=[],
        )
        self.assertEqual(pack["results"]["payments"]["row_count"], 2)
        self.assertNotIn("noise", pack["results"])
        names = {r["name"] for r in pack["results"]["payments"]["rows"]}
        self.assertEqual(names, {"Налог", "Пошлина"})
        # payload is lean: only columns/row_count/rows (+ filtered_by)
        pay = pack["results"]["payments"]
        self.assertEqual(set(pay.keys()) & {"applied_params", "captured_at"}, set())

    def test_zero_match_source_dropped(self):
        filtered = apply_rules_to_results(
            {
                "payments": {
                    "columns": ["region", "amount"],
                    "row_count": 1,
                    "rows": [{"region": "Минская", "amount": "20"}],
                }
            },
            [{"path": "region", "value": "Брестская", "condition": "EqualTo"}],
        )
        self.assertEqual(filtered, {})


if __name__ == "__main__":
    unittest.main()
