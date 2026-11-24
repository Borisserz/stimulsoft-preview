"""Regression tests for stimulsoft-preview endpoints (/filters, /shot, /dashboards, /vendor)."""

from __future__ import annotations

import json
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import view_dashboard as vd  # noqa: E402
import pick_dashboard as pd_mod  # noqa: E402


_SAMPLE_MRT_A = json.dumps(
    {
        "ReportVersion": "2024.2.2",
        "Dictionary": {
            "Variables": {
                "0": {
                    "Name": "Region",
                    "Alias": "Регион",
                    "Category": "Фильтры",
                    "Type": "String",
                    "Value": "Минск",
                    "DialogInfo": {
                        "Keys": ["Минск", "Гомель"],
                        "Values": ["г. Минск", "Гомельская область"],
                    },
                },
                "1": {
                    "Name": "Year",
                    "Alias": "Год",
                    "Category": "Фильтры",
                    "Type": "Int32",
                    "Value": "2025",
                    "DialogInfo": {
                        "Keys": ["2024", "2025"],
                        "Values": ["2024", "2025"],
                    },
                },
            }
        },
    },
    ensure_ascii=False,
)

_SAMPLE_MRT_B = json.dumps(
    {
        "ReportVersion": "2024.2.2",
        "Dictionary": {
            "Variables": {
                "0": {
                    "Name": "Month",
                    "Alias": "Месяц",
                    "Category": "Фильтры",
                    "Type": "Int32",
                    "Value": "1",
                    "DialogInfo": {
                        "Keys": ["1", "2"],
                        "Values": ["Январь", "Февраль"],
                    },
                }
            }
        },
    },
    ensure_ascii=False,
)


class ViewDashboardTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        (self.base / "local").mkdir()
        (self.base / "dashboards").mkdir()
        (self.base / "vendor").mkdir()
        (self.base / "vendor" / "html2canvas.min.js").write_text(
            "window.html2canvas = function(){};", encoding="utf-8"
        )
        (self.base / "local" / "demo.mrt").write_text(_SAMPLE_MRT_A, encoding="utf-8")
        (self.base / "local" / "revenue.mrt").write_text(_SAMPLE_MRT_B, encoding="utf-8")
        (self.base / "dashboards" / "instruction.md").write_text(
            "# Инструкция\n\n## demo.mrt\nОбщий демо-дашборд.\n\n"
            "## revenue.mrt\nВыручка, поступления и динамика по месяцам.\n",
            encoding="utf-8",
        )
        vd.app.config["TESTING"] = True
        self.client = vd.app.test_client()

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_vendor_html2canvas_served(self) -> None:
        resp = self.client.get("/vendor/html2canvas.min.js")
        self.assertEqual(resp.status_code, 200)
        self.assertIn(b"html2canvas", resp.data)

    def test_dashboards_lists_files_and_instruction(self) -> None:
        with mock.patch.object(vd, "ROOT", self.base), mock.patch.object(
            pd_mod, "ROOT", self.base
        ):
            resp = self.client.get("/dashboards")
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertIsInstance(body, dict)
        self.assertTrue(body.get("ok"))
        self.assertTrue(body.get("instruction"))
        self.assertIn("dir", body)
        self.assertIsInstance(body.get("mrt"), list)
        self.assertIn("demo.mrt", body["mrt"])
        self.assertIn("revenue.mrt", body["mrt"])
        names = [row["name"] for row in body.get("dashboards") or []]
        self.assertIn("demo.mrt", names)
        self.assertIn("revenue.mrt", names)

    def test_post_filters_picks_dashboard_and_returns_dash_main_shape(self) -> None:
        def fake_chat(messages, **_kwargs):
            sys_msg = messages[0]["content"]
            if "выбираешь один файл" in sys_msg:
                return json.dumps(
                    {"mrt": "revenue.mrt", "title": "Выручка", "reason": "про выручку"}
                )
            return json.dumps({"Month": "2"})

        with mock.patch.object(vd, "ROOT", self.base), mock.patch.object(
            pd_mod, "ROOT", self.base
        ), mock.patch.object(
            pd_mod, "llm_configured", return_value=True
        ), mock.patch.object(
            pd_mod, "_chat", side_effect=fake_chat
        ), mock.patch.object(
            vd.webbrowser, "open"
        ) as mock_browser:
            resp = self.client.post(
                "/filters",
                json={"question": "покажи выручку за февраль", "run_queries": False},
            )
            self.assertEqual(resp.status_code, 200)
            body = resp.get_json()
            self.assertEqual(body["mrt"], "revenue.mrt")
            self.assertEqual(body["dashboard"]["mrt"], "revenue.mrt")
            self.assertIn("Выручка", body["dashboard"]["description"])
            self.assertEqual(body["result"], {"Month": "2"})
            mock_browser.assert_not_called()

            # POST /open?open=0 with result returns clean /open path
            open_resp = self.client.post(
                "/open?open=0",
                json={"filters": body["result"], "mrt": body["mrt"]},
                headers={"Accept": "application/json"},
            )
            self.assertEqual(open_resp.status_code, 200)
            obody = open_resp.get_json()
            self.assertEqual(obody["path"], "/open")
            self.assertTrue(obody["url"].endswith("/open"))
            mock_browser.assert_not_called()

            # Prepared /mrt-render uses the picked revenue.mrt and remembered filters
            render_resp = self.client.get("/mrt-render")
            self.assertEqual(render_resp.status_code, 200)
            rendered = json.loads(render_resp.get_data(as_text=True))
            self.assertEqual(
                rendered["Dictionary"]["Variables"]["0"]["Value"], "2"
            )

    def test_get_filters_and_heuristic_pick_without_llm(self) -> None:
        with mock.patch.object(vd, "ROOT", self.base), mock.patch.object(
            pd_mod, "ROOT", self.base
        ), mock.patch.object(pd_mod, "llm_configured", return_value=False):
            # GET /filters?mrt=demo.mrt remains 100% compatible with case-3
            get_resp = self.client.get("/filters?mrt=demo.mrt&run_queries=0")
            self.assertEqual(get_resp.status_code, 200)
            gbody = get_resp.get_json()
            self.assertEqual(gbody["mrt"], "demo.mrt")
            self.assertEqual(gbody["count"], 2)

            # POST /filters without LLM falls back to instruction.md keyword matching
            post_resp = self.client.post(
                "/filters",
                json={"question": "покажи выручку по месяцам", "run_queries": False},
            )
            self.assertEqual(post_resp.status_code, 200)
            pbody = post_resp.get_json()
            self.assertEqual(pbody["mrt"], "revenue.mrt")
            self.assertEqual(pbody["dashboard"]["mrt"], "revenue.mrt")
            self.assertIn("result", pbody)

    def test_shot_poll_uses_id_and_since_without_losing_signal(self) -> None:
        shot_out: dict[str, object] = {}

        def _call_shot() -> None:
            r = self.client.get("/shot?mrt=revenue.mrt")
            shot_out["status"] = r.status_code
            shot_out["body"] = r.get_json()

        with mock.patch.object(vd, "_shot_wait_ms", return_value=5000):
            t = threading.Thread(target=_call_shot, daemon=True)
            t.start()
            time.sleep(0.15)

            # First poll gets the signal + id
            p1 = self.client.get("/api/shot-poll?mrt=revenue.mrt").get_json()
            self.assertTrue(p1["shoot"])
            sid = p1["id"]
            self.assertTrue(sid)

            # Second poll WITHOUT since still sees the same pending id (signal not popped!)
            p2 = self.client.get("/api/shot-poll?mrt=revenue.mrt").get_json()
            self.assertTrue(p2["shoot"])
            self.assertEqual(p2["id"], sid)

            # Report done with matching id
            done = self.client.post(
                "/api/shot-done?key=revenue.mrt",
                json={"ok": True, "id": sid, "png": {"name": "dash.png"}},
            )
            self.assertEqual(done.status_code, 200)
            t.join(timeout=3.0)

        self.assertEqual(shot_out.get("status"), 200)
        body = shot_out.get("body")
        self.assertIsInstance(body, dict)
        self.assertTrue(body["ok"])
        self.assertEqual(body["id"], sid)
        self.assertEqual(body["png"], {"name": "dash.png"})

    def test_post_filters_empty_body_returns_catalog_without_browser(self) -> None:
        with mock.patch.object(vd, "ROOT", self.base), mock.patch.object(
            pd_mod, "ROOT", self.base
        ), mock.patch.object(vd.webbrowser, "open") as mock_browser:
            resp = self.client.post("/filters?open=0", json={"run_queries": False})
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertIn("filters", body)
        self.assertIn("mrt", body)
        self.assertNotIn("url", body)
        mock_browser.assert_not_called()

    def test_stimulsoft_rot13_base64_and_form_handler_post_are_not_treated_as_open_filters(self) -> None:
        import codecs

        with mock.patch.object(vd, "ROOT", self.base), mock.patch.object(
            vd.webbrowser, "open"
        ) as mock_browser:
            # 1) GET /open?mrt=demo.mrt must NOT treat "mrt" query param as a filter variable
            get_resp = self.client.get("/open?mrt=demo.mrt")
            self.assertEqual(get_resp.status_code, 200)
            self.assertNotIn("mrt", vd.LATEST_RENDER_FILTERS)

            # 2) Stimulsoft JS viewer sends ROT13(base64(JSON)) body to POST /open (without ?sti_event= in query)
            raw_json = json.dumps({"event": "BeginProcessData", "command": "ProcessSqlData", "clientGuid": "123"})
            b64 = vd.base64.b64encode(raw_json.encode("utf-8")).decode("ascii")
            rot13_body = codecs.encode(b64, "rot_13")
            post_resp = self.client.post(
                "/open",
                data=rot13_body,
                content_type="text/plain;charset=UTF-8",
            )
            # Must NOT return the meta-refresh "Opening dashboard..." HTML or call webbrowser.open!
            mock_browser.assert_not_called()
            self.assertNotIn("Opening dashboard", post_resp.get_data(as_text=True))




if __name__ == "__main__":
    unittest.main()
