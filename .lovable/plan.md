## Batch fix — Engine 3 & 4 column/logic corrections

### FIX 1 — `generate-weekly-pattern/index.ts`
Already correct (line 202 reads `entry_date, strain_value, session_notes`). No-op.

### FIX 2 — `check-permission-slip/index.ts` lines 92, 94, 98
```ts
.select("final_score, score_date")   // was: overall_score, entry_date
.order("score_date", { ascending: false })  // was: entry_date
...
const readinessScore = readiness?.final_score || 0;  // was: overall_score
```

### FIX 3 — `generate-plan/index.ts` lines 122–131
Select `entry_date` and group by date before averaging:
```ts
const { data: nutritionRows } = await supa
  .from("shield_nutrition_logs")
  .select("entry_date, estimated_calories")
  .eq("user_id", user_id)
  .eq("deleted", false)
  .in("calorie_estimate_status", ["estimated", "manual_edited"])
  .gte("entry_date", sevenDaysAgoISO);

const intakeByDate: Record<string, number> = {};
for (const r of nutritionRows ?? []) {
  const d = r.entry_date as string;
  intakeByDate[d] = (intakeByDate[d] ?? 0) + Number(r.estimated_calories ?? 0);
}
const dailyTotals = Object.values(intakeByDate);
const avgIntake = dailyTotals.length > 0
  ? dailyTotals.reduce((a, b) => a + b, 0) / dailyTotals.length
  : null;
```

No prompts, outputs, gating, or plan structure touched.
