"""Выбор .mrt по вопросу: инструкция (.md) → LLM → имя mrt → дальше filters/open.

Поддерживает как папку ``dashboards/`` (или ``DASHBOARDS_DIR``), так и рабочую
папку ``local/`` (где на деске лежат ``.mrt`` и опционально ``instruction.md``).
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent

PICK_SYSTEM = """Ты выбираешь один файл дашборда (.mrt) по вопросу пользователя.

Тебе даны:
1) инструкция (из .md);
2) список доступных .mrt файлов.

Ответь ТОЛЬКО JSON без markdown:
{"mrt":"<точное имя файла из списка>","title":"<короткий заголовок>","reason":"<почему выбран>"}

Правила:
- mrt — только имя из списка (как есть, с .mrt);
- если ничего идеально не подходит — выбери ближайший и объясни в reason;
- description в ответ не пиши — сервер возьмёт секцию из instruction.md.
"""

FILTER_VALUES_SYSTEM = """Ты заполняешь фильтры дашборда по вопросу пользователя.

На вход — JSON filters как в API: name, alias, choices[{key,value,checked}], value (дефолт).
choices часто из SQL — это и есть допустимые значения.

Ответь ТОЛЬКО JSON без markdown:
{"<name>": <value>, ...}

Правила:
- ключи объекта — только filters[].name;
- если есть choices — верни РОВНО choices[].key выбранного пункта (не выдумывай);
- по смыслу вопроса выбери подходящий пункт («Брест» → key «Брестская»);
- фильтра нет в вопросе — ключ не включай (сервер оставит value/дефолт);
- без choices — свободное значение из вопроса.
"""


def dashboards_dir() -> Path:
    raw = (os.environ.get("DASHBOARDS_DIR") or "").strip()
    if raw:
        p = Path(raw)
        return p if p.is_absolute() else ROOT / p
    local_dir = ROOT / "local"
    if local_dir.is_dir() and any(local_dir.glob("*.mrt")):
        return local_dir
    return ROOT / "dashboards"


DASHBOARDS_DIR = dashboards_dir()


def _candidate_dirs(dir_path: Path | None = None) -> list[Path]:
    if dir_path is not None:
        return [dir_path]
    dirs: list[Path] = []
    explicit = (os.environ.get("DASHBOARDS_DIR") or "").strip()
    if explicit:
        p = Path(explicit)
        dirs.append(p if p.is_absolute() else ROOT / p)
    for cand in (ROOT / "local", ROOT / "dashboards"):
        if cand not in dirs:
            dirs.append(cand)
    return dirs


def list_mrt_files(dir_path: Path | None = None) -> list[dict[str, object]]:
    """Доступные .mrt в local/ и dashboards/ (без дубликатов по имени, local/ приоритетнее)."""
    seen: set[str] = set()
    out: list[dict[str, object]] = []
    for base in _candidate_dirs(dir_path):
        if not base.is_dir():
            continue
        for mrt in sorted(base.glob("*.mrt")):
            key = mrt.name.lower()
            if key in seen:
                continue
            seen.add(key)
            out.append(
                {
                    "mrt": mrt.name,
                    "mrt_path": str(mrt.resolve()),
                    "id": mrt.stem,
                }
            )
    return out


def load_instruction(dir_path: Path | None = None) -> str:
    """Инструкция для LLM: instruction.md в local/ или dashboards/, иначе *.md."""
    for base in _candidate_dirs(dir_path):
        if not base.is_dir():
            continue
        preferred = base / "instruction.md"
        if preferred.is_file():
            text = preferred.read_text(encoding="utf-8").strip()
            if text:
                return text
    parts: list[str] = []
    for base in _candidate_dirs(dir_path):
        if not base.is_dir():
            continue
        for md in sorted(base.glob("*.md")):
            if md.name.lower() == "readme.md":
                continue
            body = md.read_text(encoding="utf-8").strip()
            if body:
                parts.append(body)
        if parts:
            return "\n\n---\n\n".join(parts).strip()
    return ""


def list_dashboards(dir_path: Path | None = None) -> list[dict[str, object]]:
    """Каталог для /dashboards: mrt + есть ли instruction."""
    instruction = load_instruction(dir_path)
    items = list_mrt_files(dir_path)
    return [
        {
            **item,
            "has_instruction": bool(instruction),
        }
        for item in items
    ]


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None or str(raw).strip() == "":
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def _llm_config() -> dict[str, object]:
    max_tokens_raw = (
        os.environ.get("LLM_MAX_TOKENS") or os.environ.get("VISION_MAX_TOKENS") or ""
    ).strip()
    max_tokens: int | None
    try:
        max_tokens = int(max_tokens_raw) if max_tokens_raw else None
    except ValueError:
        max_tokens = None

    base = (
        os.environ.get("LLM_BASE_URL")
        or os.environ.get("VISION_API_BASE_URL")
        or "http://127.0.0.1:8080/v1"
    ).strip().rstrip("/")
    if not base.endswith("/v1") and not base.endswith("/chat/completions"):
        base = base + "/v1"

    api_key = (
        os.environ.get("LLM_API_KEY") or os.environ.get("VISION_API_KEY") or ""
    ).strip()
    if "," in api_key:
        api_key = api_key.split(",", 1)[0].strip()

    model = (
        os.environ.get("LLM_MODEL") or os.environ.get("VISION_MODEL") or ""
    ).strip()

    raw_reasoning = os.environ.get("LLM_REASONING", "").strip()
    if not raw_reasoning:
        raw_reasoning = os.environ.get("VISION_REASONING", "").strip()

    return {
        "base_url": base,
        "api_key": api_key,
        "model": model,
        "timeout": float(os.environ.get("LLM_TIMEOUT", "60") or "60"),
        "max_tokens": max_tokens,
        "reasoning": (
            _env_bool("LLM_REASONING", False)
            if raw_reasoning != ""
            else None
        ),
        "reasoning_effort": (
            os.environ.get("LLM_REASONING_EFFORT", "medium").strip() or "medium"
        ),
    }


def llm_configured() -> bool:
    cfg = _llm_config()
    return bool(str(cfg.get("model") or "").strip())


def _strip_thinking(text: str) -> str:
    """Убрать блоки рассуждения, оставить финальный ответ."""
    s = text or ""
    s = re.sub(r"<think>[\s\S]*?</think>", "", s, flags=re.I)
    s = re.sub(r"<thinking>[\s\S]*?</thinking>", "", s, flags=re.I)
    return s.strip()


def _chat(messages: list[dict[str, str]], *, temperature: float = 0.1) -> str:
    cfg = _llm_config()
    model = str(cfg["model"] or "")
    if not model:
        raise RuntimeError("Задай LLM_MODEL (или VISION_MODEL) в .env")
    base_url = str(cfg["base_url"])
    url = base_url if base_url.endswith("/chat/completions") else f"{base_url}/chat/completions"
    body: dict[str, object] = {
        "model": model,
        "temperature": temperature,
        "messages": messages,
    }
    if cfg["max_tokens"] is not None:
        body["max_tokens"] = int(cfg["max_tokens"])
    if cfg["reasoning"] is not None:
        reasoning_on = bool(cfg["reasoning"])
        body["chat_template_kwargs"] = {"enable_thinking": reasoning_on}
        body["reasoning_effort"] = (
            str(cfg["reasoning_effort"]) if reasoning_on else "none"
        )
    headers = {"Content-Type": "application/json"}
    key = str(cfg["api_key"] or "")
    if key:
        headers["Authorization"] = f"Bearer {key}"

    for attempt in range(2):
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=float(cfg["timeout"])) as resp:
                raw = resp.read().decode("utf-8")
            break
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:500]
            if (
                attempt == 0
                and exc.code == 400
                and "reasoning" in detail.lower()
                and ("reasoning_effort" in body or "chat_template_kwargs" in body)
            ):
                body.pop("reasoning_effort", None)
                body.pop("chat_template_kwargs", None)
                continue
            raise RuntimeError(f"LLM HTTP {exc.code}: {detail}") from exc
        except Exception as exc:
            raise RuntimeError(f"LLM request failed: {exc}") from exc

    parsed = json.loads(raw)
    try:
        msg = parsed["choices"][0]["message"]
        content = msg.get("content")
        if content in (None, "") and msg.get("reasoning_content"):
            content = msg.get("content") or ""
        return _strip_thinking(str(content or ""))
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError(f"bad LLM response: {raw[:400]}") from exc


def _parse_json_object(text: str) -> dict[str, object]:
    s = (text or "").strip()
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*", "", s, flags=re.I)
        s = re.sub(r"\s*```$", "", s)
    try:
        obj = json.loads(s)
        if isinstance(obj, dict):
            return obj
    except json.JSONDecodeError:
        pass
    m = re.search(r"\{[\s\S]*\}", s)
    if not m:
        raise RuntimeError(f"LLM не вернул JSON: {s[:300]}")
    obj = json.loads(m.group(0))
    if not isinstance(obj, dict):
        raise RuntimeError("LLM JSON не объект")
    return obj


def _normalize_mrt_name(name: str) -> str:
    n = (name or "").strip().replace("\\", "/").split("/")[-1]
    if n and not n.lower().endswith(".mrt"):
        n = n + ".mrt"
    return n


def _find_mrt(
    mrt_name: str,
    *,
    dir_path: Path | None = None,
) -> dict[str, object]:
    """Найти .mrt в local/ или dashboards/ по имени (demo / demo.mrt)."""
    mrt_list = list_mrt_files(dir_path)
    if not mrt_list:
        raise RuntimeError("Нет *.mrt в local/ и dashboards/")
    want = _normalize_mrt_name(mrt_name)
    match = next((x for x in mrt_list if str(x["mrt"]) == want), None)
    if match is None:
        want_l = want.lower()
        match = next(
            (
                x
                for x in mrt_list
                if str(x["mrt"]).lower() == want_l
                or str(x["id"]).lower() == want_l.removesuffix(".mrt")
            ),
            None,
        )
    if match is None:
        names = [str(x["mrt"]) for x in mrt_list]
        raise RuntimeError(f"Нет mrt={want!r}. Доступны: {', '.join(names)}")
    return match


def resolve_dashboard(
    mrt_name: str,
    *,
    dir_path: Path | None = None,
) -> dict[str, object]:
    """Дашборд уже выбран: без LLM, description из instruction.md."""
    match = _find_mrt(mrt_name, dir_path=dir_path)
    instruction = load_instruction(dir_path)
    description = _description_from_instruction(instruction, str(match["mrt"]))
    return {
        "id": match["id"],
        "mrt": match["mrt"],
        "mrt_path": match["mrt_path"],
        "title": str(match["id"]),
        "description": description,
        "reason": "mrt задан клиентом",
        "instruction_used": bool(instruction),
        "available_mrt": [str(x["mrt"]) for x in list_mrt_files(dir_path)],
        "picked": False,
    }


def _heuristic_pick(
    question: str,
    mrt_list: list[dict[str, object]],
    instruction: str,
) -> dict[str, object]:
    """Fallback-подбор .mrt по ключевым словам из instruction.md / имени файла."""
    if len(mrt_list) == 1:
        return mrt_list[0]
    q_words = {
        w[:5]
        for w in re.findall(r"[0-9a-zа-яё]{3,}", (question or "").casefold().replace("ё", "е"))
    }
    best = mrt_list[0]
    best_score = -1
    for item in mrt_list:
        mrt_name = str(item["mrt"])
        stem = str(item["id"]).casefold().replace("ё", "е")
        sec = _description_from_instruction(instruction, mrt_name) if instruction else ""
        blob = f"{stem} {sec}".casefold().replace("ё", "е")
        score = 0
        if stem in (question or "").casefold().replace("ё", "е"):
            score += 10
        blob_words = {w[:5] for w in re.findall(r"[0-9a-zа-яё]{3,}", blob)}
        score += len(q_words & blob_words)
        if score > best_score:
            best_score = score
            best = item
    return best


def pick_dashboard(question: str, *, dir_path: Path | None = None) -> dict[str, object]:
    """Инструкция + список .mrt → LLM (или эвристика) → выбранный mrt."""
    mrt_list = list_mrt_files(dir_path)
    if not mrt_list:
        raise RuntimeError("Нет *.mrt в local/ и dashboards/")

    instruction = load_instruction(dir_path)
    q = (question or "").strip()
    if not q:
        raise RuntimeError("question пустой")

    names = [str(x["mrt"]) for x in mrt_list]
    if len(mrt_list) == 1:
        match = mrt_list[0]
        description = _description_from_instruction(instruction, str(match["mrt"]))
        return {
            "id": match["id"],
            "mrt": match["mrt"],
            "mrt_path": match["mrt_path"],
            "title": str(match["id"]),
            "description": description,
            "reason": "доступен один файл .mrt",
            "instruction_used": bool(instruction),
            "available_mrt": names,
            "picked": False,
        }

    picked: dict[str, object] = {}
    if instruction and llm_configured():
        user = (
            f"Инструкция:\n{instruction}\n\n"
            f"Доступные .mrt:\n{json.dumps(names, ensure_ascii=False)}\n\n"
            f"Вопрос пользователя:\n{q}"
        )
        try:
            content = _chat(
                [
                    {"role": "system", "content": PICK_SYSTEM},
                    {"role": "user", "content": user},
                ]
            )
            picked = _parse_json_object(content)
            want = _normalize_mrt_name(str(picked.get("mrt") or ""))
            match = _find_mrt(want, dir_path=dir_path)
        except Exception as exc:
            match = _heuristic_pick(q, mrt_list, instruction)
            picked["reason"] = (
                f"Выбран эвристикой ({exc}); файл {match['mrt']}."
            )
    else:
        match = _heuristic_pick(q, mrt_list, instruction)
        picked["reason"] = f"Выбран по ключевым словам: {match['mrt']}."

    title = str(picked.get("title") or match["id"]).strip()
    description = _description_from_instruction(instruction, str(match["mrt"]))
    return {
        "id": match["id"],
        "mrt": match["mrt"],
        "mrt_path": match["mrt_path"],
        "title": title,
        "description": description,
        "reason": str(picked.get("reason") or "").strip(),
        "instruction_used": bool(instruction),
        "available_mrt": names,
        "llm_raw": picked,
        "picked": True,
    }


def _description_from_instruction(instruction: str, mrt_name: str) -> str:
    """Вся секция instruction.md про этот .mrt (заголовок + тело). Иначе весь файл."""
    stem = Path(mrt_name).stem
    text = (instruction or "").strip()
    if not text:
        return ""
    pat = re.compile(
        rf"(?im)^##\s+({re.escape(mrt_name)}|{re.escape(stem)})\s*$"
    )
    m = pat.search(text)
    if not m:
        return ""
    start = m.start()
    nxt = re.search(r"(?m)^##\s+", text[m.end() :])
    end = m.end() + nxt.start() if nxt else len(text)
    return text[start:end].strip()


def build_result(
    filters: list[dict],
    extracted: dict[str, object] | None = None,
) -> dict[str, object]:
    """name→value: filters[].value, поверх ответ LLM как есть."""
    by_name: dict[str, dict] = {}
    alias_map: dict[str, str] = {}
    for f in filters:
        if not isinstance(f, dict):
            continue
        name = str(f.get("name") or "").strip()
        if not name:
            continue
        by_name[name] = f
        alias = str(f.get("alias") or "").strip()
        if alias:
            alias_map[alias.lower()] = name
        alias_map[name.lower()] = name

    result: dict[str, object] = {
        name: f.get("value") for name, f in by_name.items()
    }
    if not extracted:
        return result

    for raw_key, val in extracted.items():
        key = str(raw_key or "").strip()
        if not key or val is None or val == "":
            continue
        name = key if key in by_name else alias_map.get(key.lower())
        if name:
            result[str(name)] = val
    return result


def extract_filter_values(
    question: str,
    filters: list[dict],
) -> dict[str, object]:
    """LLM работает с filters как есть → {name: value}."""
    q = (question or "").strip()
    if not q or not filters or not llm_configured():
        return {}

    compact: list[dict[str, object]] = []
    for f in filters:
        if not isinstance(f, dict) or not f.get("name"):
            continue
        item: dict[str, object] = {
            "name": f.get("name"),
            "alias": f.get("alias") or f.get("name"),
            "value": f.get("value"),
            "choices": f.get("choices") or [],
        }
        compact.append(item)

    if not compact:
        return {}

    user = (
        f"filters:\n{json.dumps(compact, ensure_ascii=False)}\n\n"
        f"question:\n{q}"
    )
    content = _chat(
        [
            {"role": "system", "content": FILTER_VALUES_SYSTEM},
            {"role": "user", "content": user},
        ]
    )
    picked = _parse_json_object(content)
    out: dict[str, object] = {}
    for k, v in picked.items():
        if isinstance(v, (dict, list)):
            continue
        out[str(k)] = v
    return out
