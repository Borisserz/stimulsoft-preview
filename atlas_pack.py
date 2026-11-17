"""Dashboard Atlas: multi-page + manual scenario inventory for the agent."""

from __future__ import annotations

from typing import Any

from facts_pack import facts_from_viewport
from llm_pack import dumps_llm_pack, json_safe
from structure_pack import structure_from_viewport


def _highlights_from_structure(structure: dict[str, Any]) -> dict[str, Any]:
    els = structure.get("elements") if isinstance(structure.get("elements"), list) else []
    buttons: list[str] = []
    pivots: list[str] = []
    maps: list[str] = []
    map_regions: list[str] = []
    for el in els:
        if not isinstance(el, dict):
            continue
        name = str(el.get("name") or "")
        etype = str(el.get("type") or "")
        if "Button" in etype:
            t = el.get("text") or name
            buttons.append(str(t)[:80])
        if "Pivot" in etype or "Table" in etype:
            pivots.append(name)
        if "Map" in etype:
            maps.append(name)
            for reg in el.get("regions") or []:
                if isinstance(reg, dict) and reg.get("name"):
                    map_regions.append(str(reg.get("name")))
    return {
        "button_texts": buttons[:40],
        "pivot_names": pivots[:20],
        "map_names": maps[:10],
        "map_region_names": map_regions[:20],
    }


def normalize_atlas_page(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    label = str(raw.get("label") or raw.get("page_name") or "snapshot").strip() or "snapshot"
    kind = str(raw.get("kind") or "manual")
    page_index = raw.get("page_index")
    try:
        page_index = int(page_index) if page_index is not None else None
    except (TypeError, ValueError):
        page_index = None
    vp = raw.get("viewport") if isinstance(raw.get("viewport"), dict) else raw
    structure = raw.get("structure")
    if not isinstance(structure, dict):
        structure = structure_from_viewport(vp if isinstance(vp, dict) else {})
    filters = raw.get("filters") if isinstance(raw.get("filters"), dict) else {}
    panel = filters.get("panel") if isinstance(filters.get("panel"), dict) else {}
    dashboard = (
        filters.get("dashboard") if isinstance(filters.get("dashboard"), list) else []
    )
    if not panel and filters and "panel" not in filters and "dashboard" not in filters:
        panel = dict(filters)
    interaction = raw.get("interaction")
    if interaction is not None and not isinstance(interaction, dict):
        interaction = {"raw": interaction}
    # Text render calls normalize again. The stored page has no viewport,
    # so a second facts_from_viewport() would wipe the rows just computed.
    if isinstance(raw.get("viewport"), dict):
        facts = facts_from_viewport(raw["viewport"])
    elif isinstance(raw.get("facts"), dict):
        facts = raw["facts"]
    else:
        facts = facts_from_viewport(vp if isinstance(vp, dict) else {})
    return {
        "page_index": page_index,
        "page_name": str(raw.get("page_name") or "") or None,
        "kind": kind,
        "label": label,
        "captured_at": raw.get("captured_at"),
        "filters": {"panel": dict(panel), "dashboard": list(dashboard)},
        "interaction": interaction,
        "structure": structure,
        "facts": facts,
        "highlights": raw.get("highlights")
        if isinstance(raw.get("highlights"), dict)
        else _highlights_from_structure(structure),
    }


def normalize_atlas(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {"captured_at": None, "pages": [], "page_count": 0}
    pages_in = raw.get("pages") if isinstance(raw.get("pages"), list) else []
    pages: list[dict[str, Any]] = []
    for item in pages_in:
        page = normalize_atlas_page(item)
        if page:
            pages.append(page)
    return {
        "captured_at": raw.get("captured_at"),
        "pages": pages,
        "page_count": len(pages),
    }


def apply_atlas_post(current: dict[str, Any] | None, body: Any) -> dict[str, Any]:
    """replace=true replaces all pages; else append one page or pages list."""
    cur = normalize_atlas(current or {})
    if not isinstance(body, dict):
        return cur
    if body.get("replace"):
        return normalize_atlas(body)
    pages = list(cur.get("pages") or [])
    if isinstance(body.get("page"), dict):
        page = normalize_atlas_page(body["page"])
        if page:
            pages.append(page)
    elif isinstance(body.get("pages"), list):
        for item in body["pages"]:
            page = normalize_atlas_page(item)
            if page:
                pages.append(page)
    out = {
        "captured_at": body.get("captured_at") or cur.get("captured_at"),
        "pages": pages,
    }
    return normalize_atlas(out)


def build_atlas_text(atlas: dict[str, Any] | None) -> str:
    at = normalize_atlas(atlas or {})
    lines: list[str] = []
    lines.append("========== ATLAS DASHBORDA ==========")
    lines.append("Snimki: pages, knopki, proval Brest i Pinsk.")
    lines.append("Pustye oblasti v etoj baze — net dannyh, ne oshibka parsera.")
    lines.append(f"captured_at = {at.get('captured_at')}")
    lines.append(f"snapshots = {at.get('page_count')}")
    lines.append("")
    for i, page in enumerate(at.get("pages") or []):
        lines.append("-" * 42)
        lines.append(
            f"{i+1}) [{page.get('kind')}] {page.get('label')!r} "
            f"page_index={page.get('page_index')} name={page.get('page_name')!r}"
        )
        if page.get("captured_at"):
            lines.append(f"   at={page.get('captured_at')}")
        panel = (page.get("filters") or {}).get("panel") or {}
        dash = (page.get("filters") or {}).get("dashboard") or []
        if panel:
            lines.append("   panel: " + ", ".join(f"{k}={panel[k]}" for k in sorted(panel)))
        if dash:
            for rule in dash[:12]:
                if isinstance(rule, dict):
                    lines.append(f"   filter: {rule.get('path')}={rule.get('value')}")
        inter = page.get("interaction") or {}
        if isinstance(inter, dict) and inter.get("action"):
            lines.append(f"   last_action={inter.get('action')}")
        facts = page.get("facts") if isinstance(page.get("facts"), dict) else {}
        named_buttons = []
        for btn in facts.get("buttons") or []:
            if isinstance(btn, dict) and btn.get("text") and btn["text"] not in named_buttons:
                named_buttons.append(str(btn["text"]))
        if named_buttons:
            lines.append("   knopki: " + " | ".join(named_buttons[:10]))
        if facts.get("labels"):
            lines.append("   nadpisi: " + " | ".join(facts["labels"][:8]))
        if facts.get("kpi"):
            lines.append(
                "   kpi: " + " | ".join(str(c.get("text") or "") for c in facts["kpi"][:8])
            )
        if facts.get("cards"):
            lines.append(
                "   kartochki: "
                + " | ".join(str(c.get("text") or "") for c in facts["cards"][:8])
            )
        mp = facts.get("map") if isinstance(facts.get("map"), dict) else {}
        if mp.get("with_numbers"):
            bits = []
            for reg in mp["with_numbers"][:8]:
                bits.append(
                    f"{reg.get('name')} {reg.get('amount') or ''} {reg.get('percent') or ''}".strip()
                )
            lines.append("   karta cifry: " + " | ".join(bits))
        if mp.get("names_only"):
            lines.append("   karta kontur: " + ", ".join(mp["names_only"][:12]))
        for table in facts.get("tables") or []:
            lines.append(
                f"   tablica {table.get('name')} — {table.get('status')} "
                f"strok={table.get('row_count')} capture={table.get('capture')}"
            )
            if table.get("columns"):
                lines.append("      kolonki: " + " | ".join(table["columns"][:8]))
            rows = list(table.get("rows") or [])
            shown = rows[:6]
            for row in rows[6:]:
                blob = " ".join(str(v) for v in row.values()).lower()
                if "итог" in blob or "total" in blob:
                    shown.append(row)
                    break
            for n, row in enumerate(shown, start=1):
                lines.append(f"      {n}) {row}")
            extra = int(table.get("row_count") or 0) - len(shown)
            if extra > 0:
                lines.append(f"      ... eshche {extra} strok v JSON /api/atlas")
        st = page.get("structure") or {}
        els = st.get("elements") if isinstance(st.get("elements"), list) else []
        lines.append(f"   elementy={len(els)} (polnyj spisok v JSON /api/atlas)")
        lines.append("")
    lines.append("JSON: /api/atlas")
    lines.append("Tekst: /api/atlas-text")
    lines.append("======================================")
    return "\n".join(lines)


ATLAS_PAGE_HTML = """<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8"/>
  <title>ATLAS dashborda</title>
  <style>
    body { margin: 0; font: 15px/1.4 ui-monospace, Menlo, Consolas, monospace;
      background: #0b1220; color: #e2e8f0; }
    h1 { margin: 16px 16px 8px; font-size: 22px; color: #fde68a; }
    .hint { margin: 0 16px 12px; color: #94a3b8; max-width: 920px; }
    .bar { display: flex; gap: 8px; flex-wrap: wrap; margin: 0 16px 12px; }
    button {
      font: inherit; padding: 8px 14px; cursor: pointer;
      background: #854d0e; color: #fef9c3; border: 1px solid #eab308; font-weight: 700;
    }
    button.secondary { background: #1f2937; border-color: #475569; color: #e2e8f0; font-weight: 500; }
    input {
      font: inherit; padding: 8px 10px; min-width: 220px;
      background: #020617; color: #e2e8f0; border: 1px solid #475569;
    }
    pre {
      margin: 0 16px 24px; white-space: pre-wrap; word-break: break-word;
      background: #020617; border: 1px solid #334155; padding: 16px;
      font-size: 15px; line-height: 1.4;
    }
    a { color: #93c5fd; }
  </style>
</head>
<body>
  <h1>ATLAS dashborda</h1>
  <p class="hint">
    1) Na viewer: knopka <b>ATLAS</b> — avto obhod vseh pages.<br/>
    2) Potom klikay Dinamika / drill / knopki, vvod label, zhmi <b>Add snapshot</b>
       (nuzhen otkrytyj viewer s window.opener ili snachala ATLAS s viewer).<br/>
    3) Skachaj tekst ili sfotkay scroll — prishli v chat.
  </p>
  <div class="bar">
    <button type="button" id="btn-refresh">Obnovit'</button>
    <button type="button" class="secondary" id="btn-viewer">Viewer</button>
    <button type="button" class="secondary" id="btn-dl">Download .txt</button>
    <input id="label" placeholder="label: p0 Dinamika / drill Pinsk"/>
    <button type="button" id="btn-add">Add snapshot</button>
  </div>
  <pre id="out">Zagruzka...</pre>
  <script>
    function load() {
      fetch("/api/atlas-text", { cache: "no-store" })
        .then(function (r) { return r.text(); })
        .then(function (t) { document.getElementById("out").textContent = t; })
        .catch(function (e) { document.getElementById("out").textContent = String(e); });
    }
    document.getElementById("btn-refresh").onclick = load;
    document.getElementById("btn-viewer").onclick = function () {
      window.open("/viewer", "_blank");
    };
    document.getElementById("btn-dl").onclick = function () {
      fetch("/api/atlas-text", { cache: "no-store" })
        .then(function (r) { return r.text(); })
        .then(function (t) {
          var a = document.createElement("a");
          a.href = URL.createObjectURL(new Blob([t], { type: "text/plain;charset=utf-8" }));
          a.download = "dashboard-atlas.txt";
          a.click();
        });
    };
    document.getElementById("btn-add").onclick = function () {
      var label = document.getElementById("label").value || "manual";
      var w = window.opener;
      if (w && typeof w.dashAtlasAddSnapshot === "function") {
        w.dashAtlasAddSnapshot(label).then(load).catch(function (e) {
          document.getElementById("out").textContent = String(e);
        });
        return;
      }
      document.getElementById("out").textContent =
        "Otkroj /atlas cherez knopku ATLAS na viewer (opener), ili v console viewer:\\n" +
        "dashAtlasAddSnapshot(" + JSON.stringify(label) + ")";
    };
    load();
    setInterval(load, 5000);
  </script>
</body>
</html>
"""
