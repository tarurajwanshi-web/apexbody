## No changes needed — already fixed

`supabase/functions/generate-training-sync/index.ts` lines 142–152 already use `final_score` and `score_date`:

```ts
.from("readiness_scores")
.select("score_date, final_score")
...
.gte("score_date", addDays(today, -7))
.lte("score_date", today)
.order("score_date", { ascending: false });

const avgReadiness = readiness && readiness.length > 0
  ? Math.round(readiness.reduce((s, r) => s + (r.final_score || 0), 0) / readiness.length)
```

No `overall_score` or `entry_date` references remain in this file. The fix from the earlier turn is already in place; approving this plan is a no-op.
