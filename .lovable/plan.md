## Goal

Fix `supabase/functions/swap-plan-day/index.ts` so a rest-day swap preserves each slot's own `date`, `day`, and `day_name`. Only the workout content moves between slots. This aligns with `resolveTodayPlanDay` (in `src/lib/plan.functions.ts`), which resolves "today" by matching `day.date === todayISO` — if swap overwrote the source slot's date, today's resolution would follow the workout to the wrong calendar day.

## Change

Single file: `supabase/functions/swap-plan-day/index.ts`.

### 1. Extend the `Day` type

Add `date?: string` and `session_purpose?: string | null` so both fields survive the spread and TS stays honest:

```ts
type Day = {
  day?: number;
  date?: string;
  day_name?: string;
  session_name?: string | null;
  session_purpose?: string | null;
  rest?: boolean;
  exercises?: unknown[];
  [k: string]: unknown;
};
```

### 2. Rewrite the `newDays` transform

Replace the current `days.map(...)` block with:

```ts
const newDays: Day[] = days.map((d, i) => {
  if (i === target_day_index) {
    // Target slot KEEPS its own date/day/day_name — only workout content moves in.
    return {
      ...sourceDay,
      day: targetDay.day,
      date: targetDay.date,
      day_name: targetDay.day_name,
      rest: false,
    };
  }
  if (i === source_day_index) {
    // Source slot KEEPS its own date/day/day_name — becomes rest.
    return {
      ...sourceDay,
      rest: true,
      session_name: null,
      session_purpose: null,
      exercises: [],
    };
  }
  return d;
});
```

Note the source-slot branch still spreads `sourceDay` (matching the existing code's shape) but explicitly clears session fields and exercises; its `date`/`day`/`day_name` come from `sourceDay` which IS that slot, so they're already correct.

## Out of scope

- No client changes.
- No changes to `plan.functions.ts`, `dashboard-data.ts`, `workouts.tsx`, `generate-plan`, or `_shared/training-rules.ts`.
- No new fields on the request payload; no policy or schema changes.

## Verification

- `rg -n "date:" supabase/functions/swap-plan-day/index.ts` shows date preserved in both branches.
- Manual: after a swap, `plan_data.days[i].date` for every `i` still matches its pre-swap value; only `exercises` / `session_name` / `session_purpose` / `rest` move.
