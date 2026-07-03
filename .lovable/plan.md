## Goal

Single source of truth for "which plan day is today" so Dashboard and Workouts agree. Also fix a mislabeled row in `dashboard.tsx`.

## Changes

### 1. New file: `src/lib/plan.functions.ts`

Create with the exact content provided:

- `PlanDay` type
- `todayMondayIndex()` — `(new Date().getDay() + 6) % 7`
- `resolveTodayPlanDay(days, todayISO)` — matches by `day.date === todayISO`; falls back to Monday-index with `console.warn`; returns `{ idx, day }` or `null`.

### 2. `src/lib/dashboard-data.ts`

- Add import: `import { resolveTodayPlanDay } from "@/lib/plan.functions";`
- Replace the block:
  ```ts
  const latestPlan = ((plansRes.data as any[]) ?? [])[0]?.plan_data ?? null;
  const days = (latestPlan?.days as any[]) ?? [];
  const jsDay = new Date().getDay();
  const todayIdx = (jsDay + 6) % 7;
  const todayPlannedRaw = days[todayIdx] ?? null;
  ```
  with:
  ```ts
  const latestPlan = ((plansRes.data as any[]) ?? [])[0]?.plan_data ?? null;
  const days = (latestPlan?.days as any[]) ?? [];
  const todayPlannedRaw = resolveTodayPlanDay(days, today)?.day ?? null;
  ```
  Reuses the `today` const already defined at the top of `loadDashboardData`.

### 3. `src/routes/_authenticated/dashboard.tsx` (label fix)

Rename the mislabeled QuietRow — change:

```tsx
<QuietRow label="Recovery" value={trendWord(data.compliance7d)} />
```

to:

```tsx
<QuietRow label="Adherence trend" value={trendWord(data.compliance7d)} />
```

Data source unchanged. (Note: user message said "in dashboard-data.ts" but the JSX lives in `dashboard.tsx` — will edit the correct file.)

### 4. `src/routes/workouts.tsx`

- Add imports:
  - `import { useUserTimezone, getLocalDateISO } from "@/lib/dates";`
  - `import { resolveTodayPlanDay } from "@/lib/plan.functions";`
- Inside `WorkoutsPage()`, add:
  ```ts
  const tz = useUserTimezone();
  const todayLocalISO = getLocalDateISO(tz);
  ```
- Replace 8 `todayISO()` call sites (lines 95, 106, 113, 644, 716, 778, and both weekStart-relative date builds) with `todayLocalISO`. **Exception:** the weekStart-range calculation at line 99 stays on `todayMondayIndex()` — device-week bucketing for the weekly log query is a separate, lower-risk concern, not touched in this batch.
- Replace `const todayIdx = todayMondayIndex();` with:
  ```ts
  const todayIdx = resolveTodayPlanDay(effectivePlan?.plan_data?.days, todayLocalISO)?.idx ?? todayMondayIndex();
  ```

## Out of scope

- No edge-function changes.
- No other files.
- No reformatting of unrelated code.
- Weekly-log week bucketing in `workouts.tsx` line 99 stays as-is.

## Verification before finishing

Read `src/routes/workouts.tsx` first to confirm the exact call sites and the current `todayISO()` / `todayMondayIndex()` / `effectivePlan` shape match the described lines before editing.  
  
**Problem 1 — the call-site count in the plan is wrong.** Actual count, verified just now: 6 `todayISO()` sites (95, 106, 113, 644, 716, 778) and exactly 2 `todayMondayIndex()` sites (line 50, line 99) — not "8 plus both weekStart-relative builds." There's only one weekStart build (line 99), and the plan's phrasing conflates it with line 50 incorrectly. Minor on its own, but sloppy line-counting in an instruction handed to a coding agent is how you get a bad paste that "mostly" works and silently misses a site.

**Problem 2 — this one would actually break the app.** The plan says replace line 50's `todayIdx` with a version reading `effectivePlan?.plan_data?.days`. But `effectivePlan` is a `useMemo` defined at **line 168** — after `todayIdx`. Worse, `effectivePlan`'s own memo *depends on* `todayIdx` (line 195: `[effectivePlan, todayIdx]` — circular) and `todayIdx` is used to build `effectivePlan` in the first place (line 172 area). Wiring line 50 to read from `effectivePlan` means referencing a variable before it exists — TDZ error, build breaks immediately on paste.

The correct fix reads from the **raw** `plan` **state** (declared line 35, populated by the fetch effect), not `effectivePlan`:

ts

```ts
const todayIdx = resolveTodayPlanDay(plan?.plan_data?.days, todayLocalISO)?.idx ?? todayMondayIndex();
```

Also confirmed clean: `useUserTimezone` and `getLocalDateISO` are both real exports from `src/lib/dates.ts` (lines 109 and 24) — that part of the plan is accurate.

One placement question before I finalize the corrected version — need to see where `tz`/`todayLocalISO` should get declared relative to line 50 so they're in scope in time.

Validated safe placement of utility functions within existing code structure

Validated safe placement of utility functions within existing code structure

Confirmed — `plan` state is declared at line 35, `todayIdx` at line 50, both inside the same synchronous function body, no effect boundary between them. Safe to insert the timezone consts right before line 50. `plan` will be `null` on first render before the fetch resolves — already handled, since `resolveTodayPlanDay` returns `null` on a null/undefined `days` array and the `?? todayMondayIndex()` fallback catches it.

Here's the corrected plan — same goal, same files, two fixes applied:

```
### 4. src/routes/workouts.tsx (CORRECTED)

Add imports:
  import { useUserTimezone, getLocalDateISO } from "@/lib/dates";
  import { resolveTodayPlanDay } from "@/lib/plan.functions";

Immediately after the existing useState declarations (after `const ptrStart = useRef<number | null>(null);`, before the current `const todayIdx = todayMondayIndex();` line), insert:
  const tz = useUserTimezone();
  const todayLocalISO = getLocalDateISO(tz);

Replace:
  const todayIdx = todayMondayIndex();
with:
  const todayIdx = resolveTodayPlanDay(plan?.plan_data?.days, todayLocalISO)?.idx ?? todayMondayIndex();

  -- NOT effectivePlan. effectivePlan is a later useMemo (line 168) that
  -- itself depends on todayIdx — reading it here is a temporal-dead-zone
  -- reference and will break the build on paste.

Replace exactly these 6 todayISO() call sites with todayLocalISO:
  line 95  .eq("entry_date", todayISO())
  line 106 .lte("entry_date", todayISO())
  line 113 .eq("score_date", todayISO())
  line 644 entry_date: todayISO()
  line 716 const date = todayISO();
  line 778 entry_date: todayISO()

Leave line 99 (weekStart.setDate(weekStart.getDate() - todayMondayIndex()))
untouched — device-week bucketing for the weekly log query, explicitly
out of scope for this batch.
```

Sections 1–3 (`plan.functions.ts`, `dashboard-data.ts`, the `dashboard.tsx` label fix) were already correct as written — no changes needed there. This corrected version is what should actually go to Lovable.

&nbsp;