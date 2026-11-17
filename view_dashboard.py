#!/usr/bin/env python3
"""Stimulsoft Dashboards.PYTHON 2024.2.2 — по официальным sample Flask.

Docs / samples:
  Editing a Dashboard Template in the Designer
  Showing a Dashboard in the Viewer
  How to Activate the Product
  Using Parameters in SQL Query (onBeginProcessData)
  Setting Dashboard Variables on the Server-Side
  passQueryParametersToReport / onPrepareVariables / onInteraction

Параметры:
  POST /api/params  {"Region":"West","Visits":5}
  GET  /api/params
  GET  /viewer?Region=West   (query → переменные mrt)
  клики/фильтры на дашборде → POST /api/params (onInteraction)

Запуск:
  .venv/bin/pip install -r requirements.txt
  MRT_PATH=твой.mrt .venv/bin/python view_dashboard.py
"""

from __future__ import annotations

import json
import os
import sys
import threading
import webbrowser
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus, urlparse

import stimulsoft_dashboards  # noqa: F401 — подтягивает dashboards.js
from flask import Flask, Response, jsonify, request
from stimulsoft_data_adapters.enums.StiFrameworkType import StiFrameworkType
from stimulsoft_reports.classes.StiResult import StiResult
from stimulsoft_reports.designer import StiDesigner
from stimulsoft_reports.events import (
    StiDataEventArgs,
    StiReportEventArgs,
    StiVariablesEventArgs,
)
from stimulsoft_reports.report import StiReport
from stimulsoft_reports.report.dictionary.StiVariable import StiVariable
from stimulsoft_reports.report.enums.StiVariableType import StiVariableType
from stimulsoft_reports.viewer import StiViewer

from llm_pack import (
    build_results_digest,
    build_verify_report,
    dumps_llm_pack,
    enrich_interaction,
    is_real_filter_key,
    sanitize_filters,
    snapshot_from_data_args,
    update_filter_state,
)
from atlas_pack import (
    ATLAS_PAGE_HTML,
    apply_atlas_post,
    build_atlas_text,
    normalize_atlas,
)
from structure_pack import (
    STRUCTURE_PAGE_HTML,
    build_structure_text,
    structure_from_viewport,
)
from viewport_pack import (
    build_viewport_compare_text,
    build_viewport_pack,
    normalize_viewport,
)

ROOT = Path(__file__).resolve().parent


def load_env() -> None:
    path = ROOT / ".env"
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ[k.strip()] = v.strip().strip("'\"")


def path_of(raw: str) -> Path:
    p = Path(raw)
    return p if p.is_absolute() else ROOT / p


def apply_license(component) -> None:
    """В 2024.2.x лицензия вешается на instance: component.license.setKey/setFile."""
    key = (
        os.environ.get("STIMULSOFT_DASHBOARDS_LICENSE_KEY", "").strip()
        or os.environ.get("STIMULSOFT_REPORTS_LICENSE_KEY", "").strip()
        or os.environ.get("STIMULSOFT_LICENSE_KEY", "").strip()
    )
    file_raw = (
        os.environ.get("STIMULSOFT_DASHBOARDS_LICENSE_FILE", "").strip()
        or os.environ.get("STIMULSOFT_REPORTS_LICENSE_FILE", "").strip()
        or os.environ.get("STIMULSOFT_LICENSE_FILE", "").strip()
    )
    if key:
        component.license.setKey(key)
    elif file_raw:
        component.license.setFile(str(path_of(file_raw).resolve()))


load_env()

_mrt = os.environ.get("MRT_PATH", "").strip()
_argv_mrt = ""
if len(sys.argv) > 1 and not sys.argv[1].startswith("-"):
    # only treat CLI arg as MRT when it looks like a report path (not unittest module)
    if sys.argv[1].lower().endswith(".mrt"):
        _argv_mrt = sys.argv[1]
if _argv_mrt:
    MRT_PATH = path_of(_argv_mrt)
elif _mrt:
    MRT_PATH = path_of(_mrt)
else:
    raise SystemExit("Задай MRT_PATH в .env")
if not MRT_PATH.is_file():
    raise SystemExit(f"Нет .mrt: {MRT_PATH}")

HOST = os.environ.get("VIEWER_HOST", "127.0.0.1")
PORT = int(os.environ.get("VIEWER_PORT", "8040") or "8040")
OPEN_BROWSER = os.environ.get("VIEWER_OPEN", "1").lower() in {"1", "true", "yes"}

_db = os.environ.get("DATABASE_URL", "").strip()
if not _db:
    user = os.environ.get("POSTGRES_USER", "").strip()
    password = os.environ.get("POSTGRES_PASSWORD", "").strip()
    db = os.environ.get("POSTGRES_DB", "").strip()
    host = os.environ.get("POSTGRES_HOST", "127.0.0.1").strip() or "127.0.0.1"
    port = os.environ.get("POSTGRES_PORT", "5432").strip() or "5432"
    if user and password and db:
        _db = f"postgresql://{quote_plus(user)}:{quote_plus(password)}@{host}:{port}/{db}"

PG_CONN = ""
if _db:
    u = urlparse(_db)
    if u.hostname and u.path.lstrip("/"):
        PG_CONN = (
            f"Host={u.hostname}; Port={u.port or 5432}; "
            f"Database={u.path.lstrip('/').split('?', 1)[0]}; "
            f"User Id={u.username or ''}; Password={u.password or ''};"
        )
if not PG_CONN:
    raise SystemExit("Нет DATABASE_URL / POSTGRES_USER+PASSWORD+DB в .env")

app = Flask(__name__)

# Последние параметры: POST /api/params, query /viewer?X=, клики onInteraction.
_params_lock = threading.Lock()
_PARAMS: dict[str, Any] = {}
_LAST_INTERACTION: dict[str, Any] | None = None
_INTERACTIONS: list[dict[str, Any]] = []
_INTERACTIONS_MAX = 50
# SQL/onEndProcessData snapshot — debug only, NOT for LLM pack.
_RESULTS: dict[str, Any] = {}
# Full visible dashboard snapshot from client (source of truth for LLM/SVERKA).
_VIEWPORT: dict[str, Any] | None = None
# Multi-page + manual scenario inventory (ATLAS).
_ATLAS: dict[str, Any] | None = None
_FILTERS_UPDATED_AT: str | None = None
_FILTER_GEN: int = 0
_APPLIED_LOG: list[dict[str, Any]] = []
_APPLIED_LOG_MAX = 100
# last BeginProcessData params per datasource (for verify / freshness)
_PENDING_APPLY: dict[str, dict[str, Any]] = {}
# region drill-in levels (kept for interaction enrichment / debug)
_DRILL_STACK: list[list[dict[str, Any]]] = []
# Apply-Filter from map/table/list clicks (debug / interaction enrich)
_APPLY_FILTERS: list[dict[str, Any]] = []


def _now_stamp() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

_STI_QUERY_SKIP = {"sti_event", "sti_data", "sti_handler"}


def _load_debug_js() -> str:
    # read each time; utf-8-sig strips BOM if Windows editors added it.
    # export_json_parse.js first — pure Table→JSON helpers for hybrid capture.
    parts = [
        (ROOT / "export_json_parse.js").read_text(encoding="utf-8-sig"),
        (ROOT / "dash_debug.js").read_text(encoding="utf-8-sig"),
    ]
    return "\n".join(parts)


def _public_query_params() -> dict[str, str]:
    return {
        k: v
        for k, v in request.args.items()
        if k not in _STI_QUERY_SKIP and not k.startswith("sti_")
    }


def _body_params() -> dict[str, Any]:
    out: dict[str, Any] = {}
    if request.form:
        out.update({k: v for k, v in request.form.items()})
    if request.is_json:
        body = request.get_json(silent=True)
        if isinstance(body, dict):
            nested = body.get("params")
            if isinstance(nested, dict):
                out.update(nested)
            else:
                out.update(
                    {
                        k: v
                        for k, v in body.items()
                        if k not in {"params", "interaction"}
                    }
                )
    return out


def params_snapshot() -> dict[str, Any]:
    with _params_lock:
        return dict(_PARAMS)


def params_update(values: dict[str, Any], *, clear_results_on_change: bool = True) -> dict[str, Any]:
    global _FILTERS_UPDATED_AT, _FILTER_GEN, _DRILL_STACK, _APPLY_FILTERS, _VIEWPORT
    with _params_lock:
        real_changed = False
        for key, value in values.items():
            if not is_real_filter_key(key):
                # UI junk from interaction flatten: "0","1","на 1 января" labels, __action
                continue
            key_s = str(key)
            if value is None:
                if key_s in _PARAMS:
                    _PARAMS.pop(key_s, None)
                    real_changed = True
            else:
                if _PARAMS.get(key_s) != value:
                    real_changed = True
                _PARAMS[key_s] = value
        # drop junk already sitting in the store (does NOT bump generation alone)
        for junk in [k for k in list(_PARAMS.keys()) if not is_real_filter_key(k)]:
            _PARAMS.pop(junk, None)
        if real_changed:
            _FILTERS_UPDATED_AT = _now_stamp()
            _FILTER_GEN += 1
            if clear_results_on_change:
                # Year/Month changed — drop old SQL debug + viewport until new paint
                _RESULTS.clear()
                _VIEWPORT = None
                _PENDING_APPLY.clear()
                # Year/Month change invalidates map drill / apply-filter state
                _DRILL_STACK = []
                _APPLY_FILTERS = []
        return dict(_PARAMS)


def coerce_value(type_name: str, value: Any) -> Any:
    if value is None or type_name is None:
        return value
    if isinstance(value, (dict, list)):
        return value
    text = value if isinstance(value, str) else str(value)
    try:
        if type_name in {
            StiVariableType.INT,
            StiVariableType.INT16,
            StiVariableType.INT32,
            StiVariableType.INT64,
            StiVariableType.SHORT,
            StiVariableType.LONG,
            StiVariableType.BYTE,
            StiVariableType.SBYTE,
            StiVariableType.UINT,
            StiVariableType.UINT16,
            StiVariableType.UINT32,
            StiVariableType.UINT64,
            StiVariableType.USHORT,
            StiVariableType.ULONG,
        }:
            return int(float(text)) if text != "" else value
        if type_name in {
            StiVariableType.DOUBLE,
            StiVariableType.DECIMAL,
            StiVariableType.SINGLE,
            "Float",
        }:
            return float(text) if text != "" else value
        if type_name == StiVariableType.BOOLEAN:
            if isinstance(value, bool):
                return value
            return text.strip().lower() in {"1", "true", "yes", "y", "on"}
        if type_name == StiVariableType.DATETIME:
            if isinstance(value, datetime):
                return value
            for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
                try:
                    return datetime.strptime(text, fmt)
                except ValueError:
                    continue
    except (TypeError, ValueError):
        return value
    return value


def _variable_values(args: StiVariablesEventArgs) -> dict[str, Any]:
    out: dict[str, Any] = {}
    variables = args.variables or {}
    for name, var in variables.items():
        out[str(name)] = getattr(var, "value", var)
    return out


def apply_params_to_variables(args: StiVariablesEventArgs) -> None:
    incoming = params_snapshot()
    incoming.update(_public_query_params())
    if not incoming:
        return
    variables = args.variables
    if variables is None:
        args.variables = {}
        variables = args.variables
    for name, raw in incoming.items():
        if str(name).startswith("__"):
            continue
        if name in variables:
            var = variables[name]
            var.value = coerce_value(var.typeName, raw)
        else:
            variables[name] = StiVariable(name, StiVariableType.STRING, str(raw))


def begin_process_data(args: StiDataEventArgs) -> None:
    args.connectionString = PG_CONN
    incoming = params_snapshot()
    applied: dict[str, Any] = {}
    if args.parameters:
        for name, param in args.parameters.items():
            if name in incoming:
                param.value = incoming[name]
            applied[str(name)] = getattr(param, "value", None)
    ds = str(getattr(args, "dataSource", None) or getattr(args, "connection", None) or "unknown")
    with _params_lock:
        _PENDING_APPLY[ds] = {
            "applied_params": dict(applied),
            "filters_snapshot": dict(_PARAMS),
            "started_at": _now_stamp(),
            "gen": _FILTER_GEN,
        }


def end_process_data(args: StiDataEventArgs) -> None:
    """Сохраняем готовые rows датасорса (карта/таблица/KPI) без SQL."""
    name, payload = snapshot_from_data_args(args)
    if payload is None:
        return
    stamp = _now_stamp()
    with _params_lock:
        pending = dict(_PENDING_APPLY.pop(name, {}) or {})
        # ответ от запроса со старыми Year/Month — выбрасываем
        if pending and pending.get("gen") != _FILTER_GEN:
            return
        payload = dict(payload)
        payload["captured_at"] = stamp
        payload["applied_params"] = dict(pending.get("applied_params") or {})
        _RESULTS[name] = payload
        _APPLIED_LOG.append(
            {
                "dataSource": name,
                "applied_params": dict(pending.get("applied_params") or {}),
                "filters_snapshot": dict(pending.get("filters_snapshot") or _PARAMS),
                "row_count": payload.get("row_count"),
                "captured_at": stamp,
                "gen": pending.get("gen"),
            }
        )
        overflow = len(_APPLIED_LOG) - _APPLIED_LOG_MAX
        if overflow > 0:
            del _APPLIED_LOG[:overflow]


def results_snapshot() -> dict[str, Any]:
    with _params_lock:
        return {k: dict(v) for k, v in _RESULTS.items()}


def llm_pack_snapshot() -> dict[str, Any]:
    """LLM pack from viewport only (what the human sees)."""
    with _params_lock:
        vp = dict(_VIEWPORT) if isinstance(_VIEWPORT, dict) else None
        inter = _LAST_INTERACTION
        panel = sanitize_filters(_PARAMS)
    pack = build_viewport_pack(vp)
    # merge server-known panel vars if client omitted them
    if panel:
        merged = dict(pack.get("filters") or {})
        for k, v in panel.items():
            merged.setdefault(k, v)
        pack["filters"] = merged
    if inter and not pack.get("interaction"):
        pack["interaction"] = inter
    return pack


def verify_snapshot() -> dict[str, Any]:
    with _params_lock:
        return build_verify_report(
            filters=sanitize_filters(_PARAMS),
            results={k: dict(v) for k, v in _RESULTS.items()},
            filters_updated_at=_FILTERS_UPDATED_AT,
            applied_log=list(_APPLIED_LOG),
        )


def prepare_variables(args: StiVariablesEventArgs) -> None:
    # 1) сначала забираем актуальные Year/Month/… из Stimulsoft (клиент — источник истины)
    client_vars = _variable_values(args)
    if client_vars:
        params_update(client_vars, clear_results_on_change=True)
    # 2) query-string / API overlay поверх
    apply_params_to_variables(args)


def save_report(args: StiReportEventArgs):
    if args.report is None:
        return StiResult.getError("empty report")
    try:
        MRT_PATH.write_text(
            json.dumps(args.report, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    except OSError as exc:
        return StiResult.getError(str(exc))
    return None


def sti_process(component) -> bool:
    """2024.2.2: ImportError django в __processFrameworkRequest ломает Flask-детект.

    Не передаём flask.request — кормим query/body вручную и форсим framework=Flask.
    """
    handled = component.processRequest(
        query=request.args.to_dict(),
        body=request.get_data(False),
    )
    component.handler.framework = StiFrameworkType.FLASK
    component.handler.origin = request.origin or "*"
    component.handler.error = None
    component.handler.passQueryParametersToReport = True
    return handled


def _force_utf8(resp):
    """Stimulsoft Flask responses often omit charset → Windows shows □□□ / Unexpected token."""
    if resp is None or not hasattr(resp, "headers"):
        return resp
    mime = (getattr(resp, "mimetype", None) or "").split(";")[0].strip()
    current = resp.headers.get("Content-Type") or mime or "text/html"
    base = current.split(";", 1)[0].strip() or mime or "text/html"
    resp.headers["Content-Type"] = f"{base}; charset=utf-8"
    return resp


def sti_response(component, inject_debug: bool = False):
    component.handler.framework = StiFrameworkType.FLASK
    component.handler.passQueryParametersToReport = True
    if not component.handler.origin:
        component.handler.origin = request.origin or "*"
    resp = component.getFrameworkResponse()
    if inject_debug and hasattr(resp, "get_data") and hasattr(resp, "set_data"):
        # decode as utf-8 explicitly (not latin-1) so Cyrillic in MRT stays intact
        raw = resp.get_data()
        html = raw.decode("utf-8", errors="replace")
        # inline script: avoids Windows encoding breakage of a separate .js fetch.
        # NOTE: do NOT key off "dashCaptureInteraction" — Stimulsoft already emits that name
        # from onInteraction += "dashCaptureInteraction" even when our script is missing.
        marker = "/* stimulsoft-llm-pack-debug */"
        if marker not in html:
            if "<meta charset=" not in html.lower():
                html = html.replace(
                    "<head>",
                    '<head><meta charset="utf-8">',
                    1,
                )
            js = _load_debug_js()
            tag = (
                "<script type=\"text/javascript\">\n"
                + marker
                + "\n"
                + js
                + "\n</script>\n"
            )
            if "</head>" in html:
                html = html.replace("</head>", tag + "</head>", 1)
            elif "</body>" in html:
                html = html.replace("</body>", tag + "</body>", 1)
            else:
                html = html + tag
            resp.set_data(html.encode("utf-8"))
    return _force_utf8(resp)


def remember_interaction(dump: Any) -> None:
    global _LAST_INTERACTION, _DRILL_STACK, _APPLY_FILTERS
    if not isinstance(dump, dict):
        dump = {"raw": dump}
    dump = enrich_interaction(dump) or dump
    with _params_lock:
        _APPLY_FILTERS, _DRILL_STACK, flat = update_filter_state(
            _APPLY_FILTERS, _DRILL_STACK, dump
        )
        dump = dict(dump)
        dump["drill_level"] = len(_DRILL_STACK)
        dump["apply_filter_count"] = len(_APPLY_FILTERS)
        if flat:
            dump["dashboard_filters"] = flat
        _LAST_INTERACTION = dump
        _INTERACTIONS.append(dump)
        overflow = len(_INTERACTIONS) - _INTERACTIONS_MAX
        if overflow > 0:
            del _INTERACTIONS[:overflow]
    action = dump.get("action")
    button = dump.get("button")
    rules = dump.get("dashboard_filters") or []
    print(
        f"[interaction] action={action!r} button={button!r} "
        f"drill_level={dump.get('drill_level')} "
        f"apply={dump.get('apply_filter_count')} filters={len(rules)} "
        f"keys={dump.get('__keys')}",
        flush=True,
    )


def wire_viewer(viewer: StiViewer) -> None:
    apply_license(viewer)
    viewer.options.appearance.fullScreenMode = True
    viewer.handler.passQueryParametersToReport = True
    viewer.onBeginProcessData += begin_process_data
    viewer.onEndProcessData += end_process_data
    viewer.onPrepareVariables += prepare_variables
    # alnum → вызов window.dashCaptureInteraction(args) из dash_debug.js
    viewer.onInteraction += "dashCaptureInteraction"


def wire_designer(designer: StiDesigner) -> None:
    apply_license(designer)
    designer.options.appearance.fullScreenMode = True
    designer.handler.passQueryParametersToReport = True
    designer.onBeginProcessData += begin_process_data
    designer.onEndProcessData += end_process_data
    designer.onPrepareVariables += prepare_variables
    designer.onSaveReport += save_report
    designer.onSaveAsReport += save_report


@app.get("/favicon.ico")
def favicon():
    return Response(status=204)


@app.get("/dash-debug.js")
def dash_debug_js():
    resp = Response(
        _load_debug_js().encode("utf-8"),
        mimetype="application/javascript; charset=utf-8",
    )
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.get("/api/params")
def get_params():
    with _params_lock:
        return jsonify(
            {
                "params": dict(_PARAMS),
                "interaction": _LAST_INTERACTION,
                "interactions_count": len(_INTERACTIONS),
                "results_count": len(_RESULTS),
            }
        )


@app.get("/api/interactions")
def get_interactions():
    with _params_lock:
        return jsonify({"interactions": list(_INTERACTIONS)})


@app.get("/api/llm-pack")
def get_llm_pack():
    """filters + interaction + results всех датасорсов — без SQL/логики MRT."""
    body = dumps_llm_pack(llm_pack_snapshot())
    return Response(body.encode("utf-8"), content_type="application/json; charset=utf-8")


@app.get("/api/llm-pack-digest")
def get_llm_pack_digest():
    """Короткий текст по viewport-таблицам."""
    text = build_results_digest(
        llm_pack_snapshot().get("results") or {}, max_rows_per_source=8
    )
    return Response(text.encode("utf-8"), content_type="text/plain; charset=utf-8")


@app.get("/api/compare")
def get_compare():
    """SVERKA: viewport only (what is drawn on the dashboard)."""
    text = build_viewport_compare_text(llm_pack_snapshot(), max_rows=15)
    return Response(text.encode("utf-8"), content_type="text/plain; charset=utf-8")


@app.get("/api/structure")
def get_structure_json():
    """Inventory of element names/types (no table row dump)."""
    with _params_lock:
        vp = dict(_VIEWPORT) if isinstance(_VIEWPORT, dict) else {}
    body = dumps_llm_pack(structure_from_viewport(vp))
    return Response(body.encode("utf-8"), content_type="application/json; charset=utf-8")


@app.get("/api/structure-text")
def get_structure_text():
    with _params_lock:
        vp = dict(_VIEWPORT) if isinstance(_VIEWPORT, dict) else {}
    text = build_structure_text(structure_from_viewport(vp))
    return Response(text.encode("utf-8"), content_type="text/plain; charset=utf-8")


@app.get("/structure")
def structure_page():
    """Photographable page: all block/button names for the agent."""
    return Response(STRUCTURE_PAGE_HTML.encode("utf-8"), content_type="text/html; charset=utf-8")


@app.get("/api/atlas")
def get_atlas_json():
    with _params_lock:
        atlas = dict(_ATLAS) if isinstance(_ATLAS, dict) else {"pages": []}
    return Response(
        dumps_llm_pack(normalize_atlas(atlas)).encode("utf-8"),
        content_type="application/json; charset=utf-8",
    )


@app.get("/api/atlas-text")
def get_atlas_text():
    with _params_lock:
        atlas = dict(_ATLAS) if isinstance(_ATLAS, dict) else {"pages": []}
    text = build_atlas_text(atlas)
    return Response(text.encode("utf-8"), content_type="text/plain; charset=utf-8")


@app.post("/api/atlas")
def post_atlas():
    global _ATLAS
    body = request.get_json(silent=True) if request.is_json else None
    if not isinstance(body, dict):
        return Response("need JSON atlas object", status=400)
    with _params_lock:
        _ATLAS = apply_atlas_post(_ATLAS, body)
        out = dict(_ATLAS)
    return Response(
        dumps_llm_pack({"ok": True, "atlas": normalize_atlas(out)}).encode("utf-8"),
        content_type="application/json; charset=utf-8",
    )


@app.get("/atlas")
def atlas_page():
    """Multi-page + manual scenario inventory for the agent."""
    return Response(ATLAS_PAGE_HTML.encode("utf-8"), content_type="text/html; charset=utf-8")


@app.get("/api/verify")
def get_verify():
    """Техпроверка свежести SQL (НЕ данные для сверки с экраном)."""
    body = dumps_llm_pack(verify_snapshot())
    return Response(body.encode("utf-8"), content_type="application/json; charset=utf-8")


@app.get("/api/debug/sql-snapshot")
def get_debug_sql_snapshot():
    """Optional debug: raw onEndProcessData rows (NOT for LLM)."""
    with _params_lock:
        body = dumps_llm_pack(
            {"results_source": "sql_snapshot_debug", "results": dict(_RESULTS)}
        )
    return Response(body.encode("utf-8"), content_type="application/json; charset=utf-8")


@app.post("/api/viewport")
def post_viewport():
    """Replace full visible-dashboard snapshot from the browser."""
    global _VIEWPORT
    body = request.get_json(silent=True) if request.is_json else None
    if not isinstance(body, dict):
        return Response('need JSON viewport object', status=400)
    vp = normalize_viewport(body)
    # remember interaction if embedded
    if isinstance(body.get("interaction"), dict):
        remember_interaction(body["interaction"])
    with _params_lock:
        _VIEWPORT = vp
    pack = llm_pack_snapshot()
    return Response(
        dumps_llm_pack({"ok": True, "llm_pack": pack}).encode("utf-8"),
        content_type="application/json; charset=utf-8",
    )


@app.post("/api/params")
def post_params():
    incoming = _body_params()
    incoming.update(_public_query_params())
    body = request.get_json(silent=True) if request.is_json else None
    if isinstance(body, dict) and body.get("interaction") is not None:
        remember_interaction(body.get("interaction"))
    # Do NOT clear viewport on map clicks — client will POST /api/viewport after repaint.
    updated = params_update(incoming, clear_results_on_change=False)
    pack = llm_pack_snapshot()
    return Response(
        dumps_llm_pack(
            {"ok": True, "params": sanitize_filters(updated), "llm_pack": pack}
        ).encode("utf-8"),
        content_type="application/json; charset=utf-8",
    )


@app.delete("/api/params")
def clear_params():
    global _LAST_INTERACTION, _FILTERS_UPDATED_AT, _FILTER_GEN, _DRILL_STACK, _APPLY_FILTERS
    global _VIEWPORT
    with _params_lock:
        _PARAMS.clear()
        _LAST_INTERACTION = None
        _INTERACTIONS.clear()
        _RESULTS.clear()
        _VIEWPORT = None
        _APPLIED_LOG.clear()
        _PENDING_APPLY.clear()
        _DRILL_STACK = []
        _APPLY_FILTERS = []
        _FILTERS_UPDATED_AT = None
        _FILTER_GEN += 1
    return jsonify({"ok": True, "params": {}, "llm_pack": llm_pack_snapshot()})


@app.post("/api/smoke-seed")
def smoke_seed():
    """Local-only: inject a viewport without DB/MRT. Requires ALLOW_SMOKE_SEED=1."""
    global _VIEWPORT
    if os.environ.get("ALLOW_SMOKE_SEED", "").lower() not in {"1", "true", "yes"}:
        return Response("smoke seed disabled", status=404)
    body = request.get_json(silent=True) if request.is_json else None
    if not isinstance(body, dict):
        return Response("need JSON viewport or {viewport|results}", status=400)
    raw = body.get("viewport") if isinstance(body.get("viewport"), dict) else body
    # legacy: {results: {name: payload}} → synthetic viewport tables
    if isinstance(body.get("results"), dict) and "elements" not in raw:
        elements = []
        for name, payload in body["results"].items():
            if not isinstance(payload, dict):
                continue
            elements.append(
                {
                    "name": str(name),
                    "type": "StiTableElement",
                    "columns": list(payload.get("columns") or []),
                    "rows": list(payload.get("rows") or []),
                    "row_count": int(
                        payload.get("row_count") or len(payload.get("rows") or [])
                    ),
                }
            )
        raw = {
            "captured_at": "smoke",
            "filters": body.get("filters")
            or {"panel": {}, "dashboard": body.get("dashboard_filters") or []},
            "interaction": body.get("interaction"),
            "elements": elements,
        }
    vp = normalize_viewport(raw)
    with _params_lock:
        _VIEWPORT = vp
    return jsonify({"ok": True, "elements": len(vp.get("elements") or [])})

@app.route("/mrt", methods=["GET", "POST"])
def serve_mrt():
    raw = MRT_PATH.read_text(encoding="utf-8-sig")
    resp = Response(raw, mimetype="application/json; charset=utf-8")
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.route("/", methods=["GET", "POST"])
@app.route("/designer", methods=["GET", "POST"])
def designer():
    designer = StiDesigner()
    wire_designer(designer)

    if sti_process(designer):
        # ajax handler — без debug overlay
        return sti_response(designer)

    # query на первом открытии тоже кладём в store
    q = _public_query_params()
    if q:
        params_update(q)

    report = StiReport()
    report.loadFile("/mrt")
    designer.report = report
    # debug-панель и на designer (Preview), не только /viewer
    return sti_response(designer, inject_debug=True)


@app.route("/viewer", methods=["GET", "POST"])
def viewer():
    viewer = StiViewer()
    wire_viewer(viewer)

    if sti_process(viewer):
        # handler/ajax — без debug overlay
        return sti_response(viewer)

    q = _public_query_params()
    if q:
        params_update(q)

    report = StiReport()
    report.loadFile("/mrt")
    viewer.report = report
    return sti_response(viewer, inject_debug=True)


def main() -> None:
    print("Stimulsoft Dashboards.PYTHON 2024.2.2 — official Flask wiring", flush=True)
    print(f"MRT: {MRT_PATH.resolve()}", flush=True)
    print(f"Designer: http://{HOST}:{PORT}/designer", flush=True)
    print(f"Viewer:   http://{HOST}:{PORT}/viewer", flush=True)
    print(f"Params:   POST/GET http://{HOST}:{PORT}/api/params", flush=True)
    print(f"LLM pack: GET http://{HOST}:{PORT}/api/llm-pack", flush=True)
    print(f"Verify:   GET http://{HOST}:{PORT}/api/verify", flush=True)
    print(f"Clicks:   GET http://{HOST}:{PORT}/api/interactions", flush=True)
    if OPEN_BROWSER:
        try:
            webbrowser.open(f"http://{HOST}:{PORT}/viewer")
        except Exception:
            pass
    app.run(host=HOST, port=PORT, debug=False)


if __name__ == "__main__":
    main()
