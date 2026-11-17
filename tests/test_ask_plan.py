"""Ask carcass: sentence → year/month/money + a region drill slot. No model call."""

from __future__ import annotations

import json
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
from ask_plan import plan_ask
from qwen_client import QwenOff, chat_body, chat_url, complete


class AskPlanTests(unittest.TestCase):
    def test_minsk_february_keeps_region_out_of_viewer_params(self) -> None:
        plan = plan_ask("по минску за февраль 2025 тип 1")
        self.assertEqual(plan["params"], {"year": "2025", "month": "2", "typenum": "1"})
        self.assertEqual(plan["viewer"], "/viewer?year=2025&month=2&typenum=1")
        self.assertEqual(plan["drill"], {"oblast": "Минск", "rayon": None, "status": "pending"})
        self.assertIsNone(plan["answer"])
        self.assertEqual(plan["model"], "off")

    def test_minskaya_is_not_the_city(self) -> None:
        plan = plan_ask("минская область")
        self.assertEqual(plan["drill"]["oblast"], "Минская")

    def test_pinsk_sits_inside_brest(self) -> None:
        plan = plan_ask("пинский район")
        self.assertEqual(plan["drill"]["oblast"], "Брестская")
        self.assertEqual(plan["drill"]["rayon"], "Пинск")

    def test_model_json_fills_the_same_slots(self) -> None:
        raw = json.dumps(
            {"year": 2024, "month": 3, "money": None, "oblast": "Гомельская", "rayon": None}
        )
        plan = plan_ask("любой текст", model_text=raw)
        self.assertEqual(plan["params"]["year"], "2024")
        self.assertEqual(plan["params"]["month"], "3")
        self.assertEqual(plan["drill"]["oblast"], "Гомельская")
        self.assertNotIn("typenum", plan["params"])


class QwenBodyTests(unittest.TestCase):
    def test_case3_shape(self) -> None:
        self.assertEqual(
            chat_url("http://192.168.4.101:8080/v1"),
            "http://192.168.4.101:8080/v1/chat/completions",
        )
        body = chat_body("верни json", model="qwen3.5-4b")
        self.assertEqual(body["model"], "qwen3.5-4b")
        self.assertFalse(body["chat_template_kwargs"]["enable_thinking"])
        self.assertEqual(body["messages"][0]["role"], "system")

    def test_complete_reads_choice_and_skips_think(self) -> None:
        seen = {}

        def post(url, payload):
            seen["url"] = url
            return '{"choices":[{"message":{"content":"<think>x</think>{\\"year\\":2025}"}}]}'

        text = complete("ping", base_url="http://192.168.4.101:8080", post=post)
        self.assertEqual(text, '{"year":2025}')
        self.assertEqual(seen["url"], "http://192.168.4.101:8080/v1/chat/completions")

    def test_complete_without_url_stays_off(self) -> None:
        with self.assertRaises(QwenOff):
            complete("ping", base_url="", post=lambda url, payload: "")


class AskApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = vd.app.test_client()
        self.client.delete("/api/params")

    def test_post_stores_panel_and_leaves_drill_pending(self) -> None:
        resp = self.client.post(
            "/api/ask",
            json={"text": "по минску за февраль 2025"},
        )
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertEqual(body["drill"]["status"], "pending")
        self.assertEqual(body["drill"]["oblast"], "Минск")
        self.assertFalse(body["ready"])
        self.assertEqual(vd.params_snapshot()["year"], "2025")
        self.assertEqual(vd.params_snapshot()["month"], "2")
        self.assertNotIn("oblast", vd.params_snapshot())
