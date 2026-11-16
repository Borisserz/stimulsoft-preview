"""Tests for filter/result verify helpers."""

from __future__ import annotations

import unittest
from types import SimpleNamespace

from llm_pack import build_llm_pack, build_verify_report, snapshot_from_data_args


class VerifyReportTests(unittest.TestCase):
    def test_flags_stale_when_results_older_than_filters(self):
        report = build_verify_report(
            filters={"Year": 2025, "Month": 3},
            results={
                "T": {
                    "columns": ["d"],
                    "row_count": 1,
                    "rows": [{"d": "2026-01-01"}],
                    "captured_at": "2026-01-01 00:00:00",
                    "applied_params": {"Year": 2026},
                }
            },
            filters_updated_at="2026-03-01 12:00:00",
            applied_log=[
                {
                    "dataSource": "T",
                    "applied_params": {"Year": 2026, "Month": 1},
                    "filters_snapshot": {"Year": 2026, "Month": 1},
                    "row_count": 1,
                    "captured_at": "2026-01-01 00:00:00",
                }
            ],
        )
        self.assertFalse(report["ok"])
        self.assertTrue(any("stale" in x or "mismatch" in x for x in report["issues"]))

    def test_ok_when_applied_matches_filters(self):
        report = build_verify_report(
            filters={"Year": 2025, "Month": 3},
            results={
                "T": {
                    "columns": ["d"],
                    "row_count": 1,
                    "rows": [{"d": "2025-03-01"}],
                    "captured_at": "2026-03-01 12:01:00",
                    "applied_params": {"Year": 2025, "Month": 3},
                }
            },
            filters_updated_at="2026-03-01 12:00:00",
            applied_log=[
                {
                    "dataSource": "T",
                    "applied_params": {"Year": 2025, "Month": 3},
                    "filters_snapshot": {"Year": 2025, "Month": 3},
                    "row_count": 1,
                    "captured_at": "2026-03-01 12:01:00",
                }
            ],
        )
        self.assertTrue(report["ok"])
        self.assertEqual(report["issues"], [])

    def test_snapshot_can_include_meta(self):
        args = SimpleNamespace(
            dataSource="T",
            connection="PG",
            result=SimpleNamespace(columns=["a"], rows=[[1]]),
        )
        name, payload = snapshot_from_data_args(args)
        self.assertEqual(name, "T")
        self.assertEqual(payload["row_count"], 1)


class BuildPackMetaTests(unittest.TestCase):
    def test_pack_includes_meta(self):
        pack = build_llm_pack(
            filters={"Year": 2025},
            interaction=None,
            results={"T": {"columns": ["a"], "row_count": 0, "rows": []}},
            meta={"filters_updated_at": "x"},
        )
        self.assertEqual(pack["meta"]["filters_updated_at"], "x")


if __name__ == "__main__":
    unittest.main()
