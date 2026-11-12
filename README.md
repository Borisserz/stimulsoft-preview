# stimulsoft-preview

Дизайнер дашбордов Stimulsoft **2024.2.6** и адаптер к базе. Настоящий `.mrt` и лицензия на этой машине, в git их нет.

## На Windows

Подойдёт Node, который уже стоит, включая 26.

```cmd
git clone https://github.com/Borisserz/stimulsoft-preview.git
cd stimulsoft-preview
npm install
```

Положи рядом с проектом, в папку `local`:

- `local\dashboard.mrt` — файл, который прод ещё открывает на 2024. Не тот, что сохраняли в дизайнере 2026.
- `local\license.key` — обе строки, как в файле с ключами:

```
STIMULSOFT_REPORTS_LICENSE_KEY=...
STIMULSOFT_DASHBOARDS_LICENSE_KEY=...
```

Движок 2024.2.6 держит один ключ. Для дашборда подставляется ключ Dashboards.

Подключение к Postgres — как в DBeaver, отдельным файлом. Строка из `.mrt` для запросов не используется, если файл есть.

```cmd
copy db.env.example local\db.env
notepad local\db.env
```

Поля `HOST`, `PORT`, `DATABASE`, `USER`, `PASSWORD`, `SSL`.

Если отчёт уже лежит в другом месте:

```cmd
set REPORT_PATH=D:\path\file.mrt
start.cmd
```

Дальше открой http://127.0.0.1:8080 и нажми просмотр. Окно консоли оставляй открытым: туда адаптер пишет, дошла ли база. Пароль в лог не попадает.

Жёлтая полоска сверху — нет файла или ключа. Красная — файл собран движком 2025/2026, этот дизайнер может показать пустые блоки.
