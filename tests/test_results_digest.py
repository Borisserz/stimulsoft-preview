"""Tests: human-readable results digest + UTF-8 pack (Cyrillic payment names)."""

from __future__ import annotations

import json
import unittest

from llm_pack import build_results_digest, dumps_llm_pack, json_safe


class ResultsDigestTests(unittest.TestCase):
    def test_digest_shows_source_row_samples(self):
        results = {
            "dashboardReportsPaymentsRegion": {
                "columns": ["region", "amount"],
                "row_count": 2,
                "rows": [
                    {"region": "Брестская", "amount": "100.50"},
                    {"region": "Минская", "amount": "200"},
                ],
            }
        }
        digest = build_results_digest(results, max_rows_per_source=3)
        self.assertIn("dashboardReportsPaymentsRegion", digest)
        self.assertIn("Брестская", digest)
        self.assertIn("100.50", digest)
        self.assertIn("row_count=2", digest)

    def test_digest_empty_results(self):
        self.assertIn("NO DATA", build_results_digest({}))


class Utf8PackTests(unittest.TestCase):
    def test_dumps_keeps_cyrillic_readable(self):
        pack = {
            "filters": {},
            "interaction": None,
            "results": {
                "T": {
                    "columns": ["name"],
                    "row_count": 1,
                    "rows": [{"name": "Налог"}],
                }
            },
        }
        text = dumps_llm_pack(json_safe(pack))
        # Must be valid UTF-8 JSON with real Cyrillic (not only \\u escapes)
        self.assertIn("Налог", text)
        parsed = json.loads(text)
        self.assertEqual(parsed["results"]["T"]["rows"][0]["name"], "Налог")
        text.encode("utf-8")


if __name__ == "__main__":
    unittest.main()
