"""Dashboard element inventory — names/types for human photo → agent context."""

from __future__ import annotations

from typing import Any


def structure_from_viewport(viewport: dict[str, Any] | None) -> dict[str, Any]:
    """Slim inventory: no table row dumps."""
    vp = viewport if isinstance(viewport, dict) else {}
    elements_in = vp.get("elements") if isinstance(vp.get("elements"), list) else []
    items: list[dict[str, Any]] = []
    for el in elements_in:
        if not isinstance(el, dict):
            continue
        name = str(el.get("name") or "").strip() or "element"
        etype = str(el.get("type") or "Unknown")
        item: dict[str, Any] = {
            "name": name,
            "type": etype,
            "title": el.get("title"),
        }
        if "checked" in el:
            item["checked"] = bool(el.get("checked"))
        if el.get("value") is not None:
            item["value"] = el.get("value")
        if el.get("text") is not None:
            text = str(el.get("text") or "")
            item["text"] = text if len(text) <= 120 else text[:117] + "..."
        row_count = el.get("row_count")
        if row_count is not None or el.get("rows") is not None:
            rows = el.get("rows") or []
            rc = int(row_count if row_count is not None else len(rows))
            item["has_rows"] = True
            item["row_count"] = rc
            cols = el.get("columns") or []
            if cols:
                item["columns"] = list(cols)[:40]
            if el.get("capture") is not None:
                item["capture"] = el.get("capture")
        regions = el.get("regions") if isinstance(el.get("regions"), list) else None
        if regions:
            item["regions"] = regions
        items.append(item)

    # Stable sort: buttons/filters first-ish by type family, then name
    def sort_key(it: dict[str, Any]) -> tuple:
        t = str(it.get("type") or "")
        family = 9
        if "Button" in t:
            family = 0
        elif "Combo" in t or "ListBox" in t or "TreeView" in t or "DatePicker" in t:
            family = 1
        elif "Indicator" in t or "Progress" in t or "Gauge" in t:
            family = 2
        elif "Map" in t:
            family = 3
        elif "Pivot" in t or "Table" in t:
            family = 4
        elif "Chart" in t:
            family = 5
        elif "Text" in t:
            family = 6
        return (family, str(it.get("name") or ""))

    items.sort(key=sort_key)
    return {
        "captured_at": vp.get("captured_at"),
        "element_count": len(items),
        "elements": items,
    }


def build_structure_text(structure: dict[str, Any] | None) -> str:
    st = structure if isinstance(structure, dict) else {}
    elements = st.get("elements") if isinstance(st.get("elements"), list) else []
    lines: list[str] = []
    lines.append("========== STRUKTURA DASHBORDA ==========")
    lines.append("Sfoto etu stranicu / okoshko i prishli agentu.")
    lines.append("Zdes TOLKO imena blokov (bez strok tablic).")
    lines.append("")
    if st.get("captured_at"):
        lines.append(f"captured_at = {st.get('captured_at')}")
    lines.append(f"elementov = {st.get('element_count', len(elements))}")
    lines.append("")

    if not elements:
        lines.append("(pusto — otkroy /viewer, podozhdi progrisovku, zhmi STRUKTURA)")
        lines.append("========================================")
        return "\n".join(lines)

    by_family: dict[str, list[dict[str, Any]]] = {}
    for el in elements:
        if not isinstance(el, dict):
            continue
        t = str(el.get("type") or "Unknown")
        if "Button" in t:
            fam = "1) KNOPKI"
        elif any(x in t for x in ("Combo", "ListBox", "TreeView", "DatePicker", "NumberBox")):
            fam = "2) FILTRY / SELECT"
        elif any(x in t for x in ("Indicator", "Progress", "Gauge")):
            fam = "3) KPI"
        elif "Map" in t:
            fam = "4) KARTA"
        elif "Pivot" in t:
            fam = "5) PIVOT"
        elif "Table" in t:
            fam = "6) TABLICY"
        elif "Chart" in t:
            fam = "7) CHART"
        elif "Text" in t:
            fam = "8) TEXT"
        else:
            fam = "9) PROCHEE"
        by_family.setdefault(fam, []).append(el)

    for fam in sorted(by_family.keys()):
        lines.append(fam)
        for el in by_family[fam]:
            name = el.get("name")
            etype = el.get("type")
            title = el.get("title")
            if isinstance(title, str) and len(title) > 48 and " " not in title:
                title = None
            bits = [f"   [{name}] type={etype}"]
            if title:
                bits.append(f"title={title!r}")
            if "checked" in el:
                bits.append(f"checked={el.get('checked')}")
            if el.get("value") is not None:
                bits.append(f"value={el.get('value')!r}")
            if el.get("text") is not None:
                bits.append(f"text={el.get('text')!r}")
            if el.get("has_rows"):
                bits.append(f"rows={el.get('row_count')}")
                if el.get("capture"):
                    bits.append(f"capture={el.get('capture')}")
                cols = el.get("columns") or []
                if cols and not el.get("regions"):
                    bits.append(f"cols={cols}")
            lines.append(" ".join(bits))
            for reg in el.get("regions") or []:
                if not isinstance(reg, dict):
                    continue
                lines.append(
                    f"      {reg.get('name')}"
                    f"  amount={reg.get('amount')!r}"
                    f"  percent={reg.get('percent')!r}"
                    f"  value={reg.get('value')!r}"
                )
        lines.append("")

    lines.append("========================================")
    lines.append("JSON: /api/structure")
    lines.append("Viewer: /viewer   Struktura: /structure")
    return "\n".join(lines)


STRUCTURE_PAGE_HTML = """\
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>STRUKTURA dashborda</title>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0; padding: 16px 20px 48px;
      background: #0b1220; color: #d7f5d0;
      font: 18px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    h1 { font-size: 28px; color: #86efac; margin: 0 0 8px; }
    .hint { color: #94a3b8; font-size: 15px; margin-bottom: 16px; }
    .bar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
    button {
      font: inherit; padding: 8px 14px; cursor: pointer;
      background: #166534; color: #ecfdf5; border: 1px solid #22c55e;
      font-weight: 700;
    }
    button.secondary { background: #1f2937; border-color: #475569; color: #e2e8f0; font-weight: 500; }
    pre {
      margin: 0; white-space: pre-wrap; word-break: break-word;
      background: #020617; border: 1px solid #334155; padding: 16px;
      font-size: 16px; line-height: 1.4;
    }
    a { color: #93c5fd; }
  </style>
</head>
<body>
  <h1>STRUKTURA dashborda</h1>
  <p class="hint">
    Sfoto ves' spisok (scroll esli nado) i prishli v chat.<br/>
    Snachala otkroy <a href="/viewer" target="_blank">/viewer</a>, potom zhmi Obnovit' zdes'
    ili knopku STRUKTURA na dashborde.
  </p>
  <div class="bar">
    <button type="button" id="btn-refresh">Obnovit' s servera</button>
    <button type="button" class="secondary" id="btn-viewer">Otkryt' viewer</button>
  </div>
  <pre id="out">Zagruzka...</pre>
  <script>
    function load() {
      fetch("/api/structure-text", { cache: "no-store" })
        .then(function (r) { return r.text(); })
        .then(function (t) {
          document.getElementById("out").textContent = t;
        })
        .catch(function (e) {
          document.getElementById("out").textContent = String(e);
        });
    }
    document.getElementById("btn-refresh").onclick = load;
    document.getElementById("btn-viewer").onclick = function () {
      window.open("/viewer", "_blank");
    };
    load();
    setInterval(load, 4000);
  </script>
</body>
</html>
"""
