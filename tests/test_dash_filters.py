"""TDD: extract map/button filter rules and apply to result rows."""
from __future__ import annotations
import unittest
from llm_pack import (
    extract_dashboard_filter_rules,
    apply_rules_to_results,
    enrich_interaction,
    update_drill_stack,
)

class ExtractRulesTests(unittest.TestCase):
    def test_map_filter_rules_from_filtering_parameters(self):
        interaction = {
            "action": "DashboardFiltering",
            "filteringParameters": {
                "elementName": "Map1",
                "filters": [
                    {
                        "typeItem": "FilterRule",
                        "key": "k1",
                        "path": "region",
                        "condition": "equalTo",
                        "value": "Брестская",
                        "value2": None,
                    }
                ],
            },
        }
        rules = extract_dashboard_filter_rules(interaction)
        self.assertEqual(len(rules), 1)
        self.assertEqual(rules[0]["path"], "region")
        self.assertEqual(rules[0]["value"], "Брестская")

    def test_element_drill_down_rules_from_drill_down_parameters(self):
        # Stimulsoft puts region drill-in filters into drillDownParameters slot
        interaction = {
            "action": "DashboardElementDrillDown",
            "drillDownParameters": {
                "elementName": "Map1",
                "filters": [
                    {
                        "path": "region",
                        "condition": "EqualTo",
                        "value": "Брестская",
                    },
                    {
                        "path": "imns",
                        "condition": "EqualTo",
                        "value": "Инспекция 1",
                    },
                ],
            },
        }
        rules = extract_dashboard_filter_rules(interaction)
        self.assertEqual(len(rules), 2)
        self.assertEqual(rules[0]["value"], "Брестская")
        self.assertEqual(rules[1]["value"], "Инспекция 1")
        enriched = enrich_interaction(interaction)
        self.assertEqual(enriched["element"], "Map1")
        self.assertTrue(enriched.get("drill_down"))
        self.assertEqual(len(enriched["dashboard_filters"]), 2)

    def test_button_event_enrichment(self):
        interaction = {
            "action": "DashboardButtonElementApplyEvents",
            "filteringParameters": {
                "elementName": "ButtonElement2",
                "isChecked": True,
            },
        }
        enriched = enrich_interaction(interaction)
        self.assertEqual(enriched["button"], "ButtonElement2")
        self.assertTrue(enriched["button_checked"])
        self.assertEqual(enriched["action"], "DashboardButtonElementApplyEvents")


class DrillStackTests(unittest.TestCase):
    def test_drill_down_pushes_and_up_pops(self):
        stack: list = []
        stack, flat = update_drill_stack(
            stack,
            {
                "action": "DashboardElementDrillDown",
                "drillDownParameters": {
                    "elementName": "Map1",
                    "filters": [{"path": "region", "value": "Брестская"}],
                },
            },
        )
        self.assertEqual(len(stack), 1)
        self.assertEqual(flat[0]["value"], "Брестская")
        stack, flat = update_drill_stack(
            stack,
            {
                "action": "DashboardElementDrillDown",
                "drillDownParameters": {
                    "elementName": "Map1",
                    "filters": [{"path": "imns", "value": "ИМНС-1"}],
                },
            },
        )
        self.assertEqual(len(stack), 2)
        self.assertEqual([r["value"] for r in flat], ["Брестская", "ИМНС-1"])
        stack, flat = update_drill_stack(
            stack,
            {
                "action": "DashboardElementDrillUp",
                "drillDownParameters": {"elementName": "Map1"},
            },
        )
        self.assertEqual(len(stack), 1)
        self.assertEqual(flat[0]["value"], "Брестская")

class ApplyRulesTests(unittest.TestCase):
    def test_filters_rows_matching_region(self):
        results = {
            "dashboardReportsPaymentsRegion": {
                "columns": ["region", "amount"],
                "row_count": 2,
                "rows": [
                    {"region": "Брестская", "amount": "100"},
                    {"region": "Минская", "amount": "200"},
                ],
            },
            "other": {
                "columns": ["x"],
                "row_count": 1,
                "rows": [{"x": 1}],
            },
        }
        rules = [{"path": "region", "value": "Брестская", "condition": "EqualTo"}]
        filtered = apply_rules_to_results(results, rules)
        self.assertEqual(filtered["dashboardReportsPaymentsRegion"]["row_count"], 1)
        self.assertEqual(
            filtered["dashboardReportsPaymentsRegion"]["rows"][0]["region"],
            "Брестская",
        )
        # unrelated source without matching column keeps rows if no cell matches? 
        # policy: keep source unchanged if no column matches any rule path
        self.assertEqual(filtered["other"]["row_count"], 1)

if __name__ == "__main__":
    unittest.main()
