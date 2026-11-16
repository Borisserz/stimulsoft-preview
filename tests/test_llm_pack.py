"""Unit tests for LLM pack builders (no Flask / no Stimulsoft runtime)."""

from __future__ import annotations

import unittest
from types import SimpleNamespace

from llm_pack import build_llm_pack, rows_as_records, snapshot_from_data_args


class RowsAsRecordsTests(unittest.TestCase):
    def test_zips_columns_to_dicts(self):
        rows = rows_as_records(["a", "b"], [[1, 2], [3, 4]])
        self.assertEqual(rows, [{"a": 1, "b": 2}, {"a": 3, "b": 4}])

    def test_empty_columns_keeps_raw_rows(self):
        raw = [[1], [2]]
        self.assertEqual(rows_as_records([], raw), raw)

    def test_none_rows(self):
        self.assertEqual(rows_as_records(["a"], None), [])


class SnapshotFromArgsTests(unittest.TestCase):
    def test_builds_named_result_without_sql(self):
        args = SimpleNamespace(
            dataSource="MapData",
            connection="PG",
            queryString="SELECT 1 -- secret logic",
            result=SimpleNamespace(
                columns=["region", "value"],
                rows=[["West", 10], ["East", 20]],
            ),
        )
        name, payload = snapshot_from_data_args(args)
        self.assertEqual(name, "MapData")
        self.assertEqual(payload["row_count"], 2)
        self.assertEqual(
            payload["rows"],
            [{"region": "West", "value": 10}, {"region": "East", "value": 20}],
        )
        self.assertNotIn("query", payload)
        self.assertNotIn("sql", payload)
        blob = str(payload)
        self.assertNotIn("SELECT", blob)

    def test_falls_back_to_connection_name(self):
        args = SimpleNamespace(
            dataSource=None,
            connection="Conn1",
            result=SimpleNamespace(columns=["x"], rows=[[1]]),
        )
        name, payload = snapshot_from_data_args(args)
        self.assertEqual(name, "Conn1")
        self.assertEqual(payload["rows"], [{"x": 1}])

    def test_missing_result_returns_none_payload(self):
        args = SimpleNamespace(dataSource="X", connection=None, result=None)
        name, payload = snapshot_from_data_args(args)
        self.assertEqual(name, "X")
        self.assertIsNone(payload)


class BuildLlmPackTests(unittest.TestCase):
    def test_pack_shape(self):
        pack = build_llm_pack(
            filters={"Year": "2025"},
            interaction={"action": "DashboardFiltering"},
            results={"T": {"columns": ["a"], "row_count": 1, "rows": [{"a": 1}]}},
        )
        self.assertEqual(pack["filters"]["Year"], "2025")
        self.assertEqual(pack["interaction"]["action"], "DashboardFiltering")
        self.assertEqual(pack["results"]["T"]["row_count"], 1)
        self.assertEqual(set(pack.keys()), {"filters", "interaction", "results"})


if __name__ == "__main__":
    unittest.main()
