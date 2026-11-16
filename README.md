# stimulsoft-preview

Stimulsoft **Dashboards.PYTHON 2024.2.2** — Flask designer + viewer.  
`.mrt`, ключи и БД лежат в `local/` на машине (в git не попадают).

## Windows (основной путь)

```cmd
git pull
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
```

В `local\` должны быть:

| файл | что |
|------|-----|
| `dashboard.mrt` | шаблон 2024 |
| `license.key` | `STIMULSOFT_DASHBOARDS_LICENSE_KEY=...` (+ reports) |
| `db.env` | `HOST` `PORT` `DATABASE` `USER` `PASSWORD` `SSL` |

```cmd
copy db.env.example local\db.env
notepad local\db.env
.venv\Scripts\python view_dashboard.py
```

- Designer: http://127.0.0.1:8040/designer  
- Viewer: http://127.0.0.1:8040/viewer  
- Params: http://127.0.0.1:8040/api/params  

На viewer в углу — debug: список блоков и кнопок (`dash_debug.js`).

Опционально `local\.env`: `MRT_PATH`, `VIEWER_PORT`, `DATABASE_URL`, …

## Node-дизайнер 2024.2.6 (старый путь)

```cmd
npm install
start.cmd
```

Откроет http://127.0.0.1:8080. Тот же `local\dashboard.mrt`, `local\license.key`, `local\db.env`.
