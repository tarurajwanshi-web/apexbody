# Plan: Body Composition Classifier

Pure-rules classifier. No AI. Reads only.

## Files

**New (2)**
- `src/lib/body-comp.functions.ts` — `getBodyCompState()` server fn
- `src/components/dashboard/BodyCompCard.tsx` — display card

**Modified (1)**
- `src/routes/_authenticated/dashboard.tsx` — mount under Coach section after `ExerciseHistoryPanel`

## `getBodyCompState()` server fn

`createServerFn({ method: 'GET' })` + `.middleware([requireSupabaseAuth])`, no input.

Inside handler (RLS via `context.supabase`, `userId` from context):

1. Resolve TZ via `resolveUserTimezone` + `getLocalDateISO`. Date range: today and today−6 (7-day window).
2. **Weight**: query `body_measurement_events` for last 7 days, ordered by `measured_at` (or `entry_date`) asc. Pull `weight_kg` non-null.
   - `latestWeight` = last row, `earliestWeight` = first row.
   - `weightChange = latestWeight - earliestWeight` (kg).
   - `weightPct = abs(weightChange / earliestWeight) × 100`.
3. **Strength**: query `workout_set_logs` last 7 days, `completed=true`, with `exercise_id`, `weight_kg`, `reps_completed`, `entry_date`.
   - Find top 3 exercises by set count over the window.
   - For each, compute `latestVolume = weight × reps` from the most recent completed set, and `earliestVolume` from the oldest completed set in the window.
   - Aggregate: sum latest vs sum earliest across the 3 exercises.
   - `strengthChangePct = ((sumLatest - sumEarliest) / sumEarliest) × 100`.
4. **Confidence**:
   - `high` — ≥2 weight points AND ≥2 strength sessions across ≥2 distinct days.
   - `medium` — at least 1 weight + 1 strength data point in window.
   - `low` — sparse / missing data; classification falls back to plateau with low confidence.
5. **Classification matrix** (apply exactly as specified by the user, using `weightPct` and `abs(strengthChangePct)` against the 2% threshold and the directional signs of `weightChange` / `strengthChangePct`):
   - W↑ S↑ both >2% → `clean_bulk`
   - W↑ S→ (<2%) → `excess_fat_gain`
   - W↓ S↑ both >2% → `perfect_recomposition`
   - W↓ S→ → `good_cut`
   - W↓ S↓ both >2% → `muscle_loss`
   - else → `body_recomposition_plateau`

Return shape (matches spec):
```ts
{
  state: string,
  weight_change: number,      // kg, signed, rounded to 1 decimal
  strength_change: number,    // % signed, rounded to 1 decimal
  message: string,
  action: string,
  confidence: 'high' | 'medium' | 'low',
}
```

Insufficient data branch: if `latestWeight == null` OR no completed sets, return `state: 'body_recomposition_plateau'`, `confidence: 'low'`, with a copy variant ("Not enough data yet. Log weight and at least one workout this week.") and a neutral action.

## `BodyCompCard.tsx`

- `useSuspenseQuery({ queryKey: ['coach','body-comp'], queryFn: ..., staleTime: 1h, gcTime: 2h })`.
- Pure presentational; no markdown, no emoji (project markdown-stripping convention — the spec emojis in `message` will be stripped before render via the same regex used in `dashboard.tsx`/`text.ts`).
- Layout using APEX tokens from `@/components/dashboard/tokens`:
  - Card: `cardStyle` (`T.surface`, `T.border`, 16 radius).
  - Title row: "Body Composition" 10px uppercase tracked, `T.label`.
  - State message: 13px `T.text1`, 2-line max.
  - Stats line: 12px `T.text2` — "Weight: −0.8 kg · Strength: +2.3%" using arrows in plain unicode (no emoji); color the deltas with `T.green` / `T.red` / `T.text3` based on sign + state.
  - Action block: nested `nestedCardStyle` panel with 12px uppercase `T.label` "Next" + 12px `T.text2` action body.
  - Footer: confidence pill 10px uppercase — `high` green, `medium` amber, `low` text3.
- Allowed font sizes only (10/12/13/14/20). No bold. No `rounded-3xl`. No `text-text-accent`.
- Returns `null` when both `weight_change === 0` and `strength_change === 0` AND `confidence === 'low'`? No — always render so users see the empty-state guidance.

## Dashboard mount

In `src/routes/_authenticated/dashboard.tsx`, inside the Coach section, immediately after the `<ExerciseHistoryPanel />` Suspense block:

```tsx
<SectionLabel>Body composition</SectionLabel>
<Suspense fallback={<SkeletonBlock />}>
  <BodyCompCard />
</Suspense>
```

(Reuses the existing `SkeletonBlock` component already defined in the file; the spec's `<SkeletonRow />` does not exist in the project.)

Add `import { BodyCompCard } from '@/components/dashboard/BodyCompCard'` alongside the existing dashboard component imports.

## Notes / non-goals

- No schema changes. No migrations. No new RPCs.
- All emojis in the spec messages are stripped before display to comply with the project's plain-prose card convention.
- 1-hour cache via TanStack Query; no manual invalidation hooks added.
- `lint:ui` constraints respected (font sizes, no bold, no `rounded-3xl`, no `text-text-accent`).
