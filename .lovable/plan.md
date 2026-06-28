# Plan: Contradiction Detection Card

No schema changes. Reads only. Auth-gated.

## Files

**New (1)**

- `src/components/dashboard/ContradictionCard.tsx`

**Modified (3)**

- `src/lib/coach.functions.ts` — add `getContradictions()`
- `supabase/functions/generate-daily-coach-note/index.ts` — detect contradictions, inject into Haiku prompt
- `src/routes/_authenticated/dashboard.tsx` — mount card above `CoachingFeed`

The Edge Function can't import `src/lib/coach.functions.ts` (Deno vs Node), so the detection logic gets factored into a small pure helper used by both surfaces:

- `supabase/functions/_shared/contradictions.ts` (new) — pure `detectContradictions(ctx)` function
- The server fn duplicates the same rules in TS (small enough, ~40 lines)

Actually cleaner: keep the rules in **one** place — `supabase/functions/_shared/contradictions.ts` is Deno-only. So:

- New shared module: `src/lib/contradictions.ts` (pure, no imports) — used by the server fn
- The Edge Function inlines the same `detectContradictions()` function (or imports via relative path from `supabase/functions/_shared/contradictions.ts` — Deno-safe). I'll create **two** files with identical logic since the runtimes don't share modules. The pure function is ~50 lines; drift risk is acceptable and called out in a header comment in both files.

---

## Detection rules (`detectContradictions`)

Input shape:

```ts
{
  goal: string | null,                  // muscle_gain | fat_loss | recomposition | strength | athletic_performance
  adjustmentKcal: number | null,        // from latest nutrition_weekly_reviews
  adherencePct: number | null,
  avgStrain7d: number | null,
  avgRir7d: number | null,
  sets7d: number,
  readinessToday: number | null,
}
```

Output:

```ts
{
  detected: boolean,
  contradictions: Array<{
    type: 'muscle_gain_deficit' | 'overreaching' | 'fat_loss_collapse' | 'volume_readiness',
    severity: 'high' | 'medium',
    message: string,        // 2 sentences max
    actionTitle: string,
    actionBody: string,     // 1 sentence
  }>
}
```

Rules (in order):

1. `muscle_gain_deficit` — goal=muscle_gain && adjustmentKcal < -200 → high
2. `overreaching` — avgStrain7d > 10 && readinessToday < 45 && avgRir7d < 1.5 → high
3. `fat_loss_collapse` — goal=fat_loss && adherencePct < 50 && adjustmentKcal < -200 → high
4. `volume_readiness` — sets7d > 20 && readinessToday < 40 → high (medium if readiness 40–50)

Each rule emits the exact message/action copy from the spec, parameterized with the user's numbers where helpful (e.g. "250 kcal deficit").

## `getContradictions()` server fn

In `src/lib/coach.functions.ts`, `.middleware([requireSupabaseAuth])`, no input. Inside handler:

- Resolve TZ via `resolveUserTimezone` + `getLocalDateISO` for today
- Parallel queries (all RLS-scoped via `context.supabase`):
  - `profiles.goal`
  - latest `nutrition_weekly_reviews` row (order desc, limit 1): `adjustment_kcal, adherence_pct, confidence_tier`
  - `readiness_scores` for today: `final_score`
  - `shield_training_logs` last 7 days: `strain_value` → JS avg
  - `workout_set_logs` last 7 days completed=true → count
  - `workout_set_logs` last 7 days `rir` → JS avg (non-null)
- Build input ctx, call `detectContradictions(ctx)` from `@/lib/contradictions`
- Return result; sort `contradictions` so `severity:'high'` first
- Cached 1h via TanStack Query on client

## Component `ContradictionCard.tsx`

- `useSuspenseQuery` w/ `queryKey: ['coach','contradictions']`, 1h stale / 2h gc
- Returns `null` if `!data.detected`
- Renders an amber/red-bordered card using APEX tokens:
  - Header: small "!" badge (red bg if high, amber if medium) + label "Your plan has a contradiction"
  - Message (text1, 14px, 2 lines)
  - Action block (nested surface2 panel): `actionTitle` (12px uppercase tracked, label color) + `actionBody` (text2, 13px)
  - Footer: severity pill ("High confidence" red / "Medium confidence" amber) — no emoji per project markdown-stripping convention
  - If `contradictions.length > 1`: small "+N other signal(s)" line at bottom
- Allowed font sizes only: 10/12/13/14/20. No bold variants. No `rounded-3xl`. No `text-text-accent`. Inline colors via `T.red`, `T.amber`, `T.surface`, `T.surface2`, `T.text1/2/3`, `T.label`, `T.border`.

## Dashboard mount

In `src/routes/_authenticated/dashboard.tsx` Coach section, just **before** `<CoachingFeed />`:

```tsx
<Suspense fallback={null}>
  <ContradictionCard />
</Suspense>
```

Add the import alongside the existing dashboard component imports.

## Edge function integration (`generate-daily-coach-note`)

After the macro target / meal aggregation block and before building `haikuPrompt`:

1. Query the same signals as the server fn (latest weekly review, today's readiness, last-7-day strain avg, last-7-day sets count, last-7-day RIR avg)
2. Call inlined `detectContradictions(...)` (copied into the file from the shared spec, or imported from `_shared/contradictions.ts` — I'll go with `_shared/contradictions.ts` to keep one Deno source of truth)
3. If `detected`, take highest-severity contradiction and prepend a `CONTRADICTION ALERT:` block to `haikuPrompt`:

```
CONTRADICTION ALERT:
{message}

Action: {actionBody}
Severity: {severity}

Override your generic coaching today. Lead with this contradiction in your first sentence. Then provide your normal nutrition observations briefly.
```

Existing instruction list and 150–200 word target stay intact. No changes to storage / idempotency / cron. No model change.

## File layout summary

- `src/lib/contradictions.ts` — pure rule fn (TS, no deps)
- `supabase/functions/_shared/contradictions.ts` — Deno copy with identical rules + comment "keep in sync with src/lib/contradictions.ts"
- `src/lib/coach.functions.ts` — append `getContradictions()`
- `src/components/dashboard/ContradictionCard.tsx` — new
- `src/routes/_authenticated/dashboard.tsx` — import + Suspense mount before `<CoachingFeed />`
- `supabase/functions/generate-daily-coach-note/index.ts` — import shared rule, query signals, prepend alert to prompt

## Action  


✅ Integrate contradiction detection INTO the daily coaching note generation — not as separate card logic

Single Haiku inference per user per day (contradiction context + coaching in one prompt)

User sees unified response, not "contradiction card" + "generic coaching"

Saves 50% token cost

✅ Output format: NO MARKDOWN, plain prose

Card renders as clean prose blocks, not formatted text

Message: 2 sentences, plain English

Action: 1 sentence, directive

No emojis, no bold, no bullet points

5-second scan time max