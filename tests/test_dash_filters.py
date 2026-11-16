"""TDD: extract map/button filter rules and apply to result rows."""
from __future__ import annotations
import unittest
from llm_pack import (
    extract_dashboard_filter_rules,
    apply_rules_to_results,
    enrich_interaction,
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
                        "condition": "EqualTo",
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
