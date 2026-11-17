"""Qwen chat client, same wire as case-3: /v1/chat/completions, thinking off.

No call happens until a base URL is passed in. The ask route does not call this yet.
"""

from __future__ import annotations

import json
from typing import Any, Callable

DEFAULT_MODEL = "qwen3.5-4b"

Post = Callable[[str, dict[str, Any]], str]


class QwenOff(RuntimeError):
    pass


def chat_url(base_url: str) -> str:
    base = base_url.rstrip("/")
    base = base.removesuffix("/chat/completions").removesuffix("/v1")
    return f"{base}/v1/chat/completions"


def chat_body(user_text: str, *, model: str = DEFAULT_MODEL) -> dict[str, Any]:
    return {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "Верни один JSON-объект с ключами year, month, money, oblast, rayon. "
                    "Нет значения — null. Числа не выдумывай."
                ),
            },
            {"role": "user", "content": user_text},
        ],
        "temperature": 0.2,
        "max_tokens": 1024,
        "chat_template_kwargs": {"enable_thinking": False},
    }


def _after_think(raw: str) -> str:
    text = raw
    if "</think>" in text:
        text = text.rsplit("</think>", 1)[1]
    return text.strip()


def complete(user_text: str, *, base_url: str, post: Post, model: str = DEFAULT_MODEL) -> str:
    if not base_url:
        raise QwenOff("set QWEN_API_BASE_URL")
    raw = post(chat_url(base_url), chat_body(user_text, model=model))
    payload = json.loads(raw)
    content = payload["choices"][0]["message"]["content"]
    return _after_think(str(content))
