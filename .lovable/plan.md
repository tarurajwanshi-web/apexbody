## Fix: readiness query column name in generate-training-sync

**File:** `supabase/functions/generate-training-sync/index.ts`

**Bug:** The readiness query references `entry_date`, but `readiness_scores` uses `score_date`.

### Change (lines 140–145)

Replace:
```ts
const { data: readiness } = await supa
  .from("readiness_scores")
  .select("entry_date, final_score")
  .eq("user_id", profile.user_id)
  .gte("entry_date", addDays(today, -7))
  .lte("entry_date", today)
  .order("entry_date", { ascending: false });
```

With:
```ts
const { data: readiness } = await supa
  .from("readiness_scores")
  .select("score_date, final_score")
  .eq("user_id", profile.user_id)
  .gte("score_date", addDays(today, -7))
  .lte("score_date", today)
  .order("score_date", { ascending: false });
```

### Out of scope
No other file, no other query, no auth/prompt/storage changes.
