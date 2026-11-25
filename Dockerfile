FROM python:3.11-slim AS builder
WORKDIR /build
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

FROM python:3.11-slim AS runner
WORKDIR /app
RUN useradd --create-home --uid 1000 --shell /usr/sbin/nologin appuser \
    && mkdir -p /app/local /app/exports /app/dashboards \
    && chown -R appuser:appuser /app
COPY --from=builder /install /usr/local
COPY --chown=appuser:appuser \
    view_dashboard.py \
    extract_mrt.py \
    filters_mrt.py \
    pick_dashboard.py \
    screenshot_dashboard.js \
    ./
COPY --chown=appuser:appuser vendor ./vendor
COPY --chown=appuser:appuser dashboards ./dashboards
USER appuser
ENV VIEWER_HOST=0.0.0.0 \
    VIEWER_PORT=8040 \
    VIEWER_OPEN=0 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
EXPOSE 8040
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8040/docs', timeout=3)"
CMD ["python", "view_dashboard.py"]
