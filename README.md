# stimulsoft-preview

Чистый **Stimulsoft Dashboards.PYTHON 2024.2.2** (Flask designer + viewer).  
Как в рабочих `view_dashboard.py` / официальных sample: ручной `sti_process` (обход ImportError django), params, onInteraction.

## Windows

```cmd
git pull
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
copy .env.example .env
notepad .env
```

В `.env` укажи:

- `MRT_PATH=local\dashboard.mrt` (или полный путь к `.mrt`)
- ключи `STIMULSOFT_DASHBOARDS_LICENSE_KEY` / `STIMULSOFT_REPORTS_LICENSE_KEY`
- БД: `DATABASE_URL=...` **или** `POSTGRES_HOST` / `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD`

Файлы секретов клади в `local\` (в git не попадают): `dashboard.mrt`, при желании копия ключей.

```cmd
.venv\Scripts\python view_dashboard.py
```

- http://127.0.0.1:8040/designer  
- http://127.0.0.1:8040/viewer  
- http://127.0.0.1:8040/api/params  
- http://127.0.0.1:8040/api/llm-pack — `{filters, interaction, results}` для LLM (без SQL)

Debug-панель **llm-pack** (правый нижний угол) есть на `/viewer` и на `/designer`.
После клика по карте/кнопкам/фильтрам показывает JSON. Если не видно — hard refresh (Ctrl+F5) и проверь что открыт именно этот порт после `git pull`.
