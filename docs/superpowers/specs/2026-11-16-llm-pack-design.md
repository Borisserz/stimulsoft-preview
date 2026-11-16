# LLM pack from Stimulsoft results

## Goal

Give an LLM **filters + computed dashboard results** after Stimulsoft already ran heavy MRT logic. Do **not** send SQL, formulas, or the 30k-line MRT.

## Non-goals

- DOM click graphs / pressing toolbar Download
- Explaining MRT logic to the model
- Headless Node export (needs 2024.3+; we stay on 2024.2.2)

## Behavior

1. Every data adapter `Execute`/`ExecuteQuery` completes → server stores dataset under `dataSource` name (`onEndProcessData`).
2. Viewer interactions (map region, top buttons, variables) → existing `dashCaptureInteraction` + `/api/params`.
3. `GET /api/llm-pack` returns:

```json
{
  "filters": {},
  "interaction": {},
  "results": {
    "SomeDataSource": {
      "columns": ["a", "b"],
      "row_count": 2,
      "rows": [{"a": 1, "b": 2}]
    }
  }
}
```

4. Debug panel (corner) shows this pack JSON (not only raw interaction args). After click, wait briefly for queries, then refresh pack.

## Success

- Map click / filter submit → panel shows updated `filters` + `results` for all sources that re-queried.
- Another service can `GET /api/llm-pack` and POST that JSON to an LLM.
