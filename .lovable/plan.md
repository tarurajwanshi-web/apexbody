# Pattern Memory Explanation Layer

Wrap existing `generate-weekly-pattern` correlations with a Mini AI explanation step, persist alongside patterns, and surface on the dashboard as "Your Recovery Signature".

## 1. Database — new migration

Create `user_recovery_patterns` table (doesn't exist yet):

```sql
CREATE TABLE public.user_recovery_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pattern_type text NOT NULL,         -- 'exercise_lag' | 'sleep_effect' | ...
  pattern_key text NOT NULL,          -- e.g. 'deadlift' — for upsert dedup
  description text NOT NULL,          -- short observation line
  explanation text,                   -- Mini physiology blurb
  protocol text,                      -- Mini actionable protocol
  data_points int NOT NULL DEFAULT 0,
  correlation_coeff numeric,
  metadata jsonb DEFAULT '{}'::jsonb, -- raw pattern fields (rir_impact, days, etc.)
  detected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, pattern_type, pattern_key)
);

GRANT SELECT ON public.user_recovery_patterns TO authenticated;
GRANT ALL ON public.user_recovery_patterns TO service_role;

ALTER TABLE public.user_recovery_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own patterns"
ON public.user_recovery_patterns FOR SELECT TO authenticated
USING (auth.uid() = user_id);
```

No insert/update policies — writes only from edge function via service role.

## 2. `supabase/functions/generate-weekly-pattern/index.ts`

After existing pattern detection block:

- Iterate detected patterns; keep only those with `data_points >= 4`.
- For each, call new helper `generatePatternExplanation(pattern, { age, goal, proficiency })` that hits Lovable AI Gateway (`google/gemini-3-flash-preview`) with the system + user prompts from the spec, expecting JSON `{ explanation, protocol }`.
- Upsert into `user_recovery_patterns` on `(user_id, pattern_type, pattern_key)` with description, explanation, protocol, data_points, correlation_coeff, metadata.
- Wrap each Mini call in try/catch; on failure still upsert pattern without explanation so detection isn't blocked.

Helper lives inline in the function file (no shared module needed for one caller).

## 3. `src/lib/pattern-memory.functions.ts` (new)

`createServerFn` with `requireSupabaseAuth`:

```ts
export const getRecoveryPatterns = createServerFn(...)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from('user_recovery_patterns')
      .select('pattern_type, pattern_key, description, explanation, protocol, data_points, correlation_coeff')
      .gte('data_points', 4)
      .order('correlation_coeff', { ascending: false, nullsFirst: false })
      .limit(3);
    return data ?? [];
  });
```

## 4. `src/components/dashboard/PatternMemoryCard.tsx` (new)

- `useSuspenseQuery({ queryKey: ['recovery-patterns'], queryFn: getRecoveryPatterns, staleTime: 3600_000 })`.
- If empty → render nothing (parent gates section visibility).
- Map up to 3 patterns to APEX-token cards with:
  - Title 14px (pattern key humanized, e.g. "Deadlift Recovery Lag")
  - Observation 13px secondary
  - Explanation 12px tertiary
  - Protocol 12px medium-weight accent
  - Confidence chip 10px: `High (${data_points} observations)`
- Plain text only —  reuse existing `cleanText` util to strip any markdown/emoji from Mini output.

## 5. `src/routes/_authenticated/dashboard.tsx`

- Import `PatternMemoryCard` and existing `SectionLabel` / `SkeletonRow`.
- In Coach section, after `BodyCompCard`:

```tsx
<SectionLabel>Your Recovery Signature</SectionLabel>
<Suspense fallback={<SkeletonRow />}>
  <PatternMemoryCard />
</Suspense>
```

- Visibility gate handled by the card itself (renders null when no qualifying patterns), which also covers the "30+ days" requirement implicitly since 4+ observations require multi-week history.

## Technical notes

- Lovable AI call uses `LOVABLE_API_KEY` already present; model `google/gemini-3-flash-preview`, `Output.object({ explanation, protocol })` for structured JSON.
- Upsert key `(user_id, pattern_type, pattern_key)` lets weekly runs refresh `data_points`/`correlation_coeff` without duplicating rows.
- Cache: server query is cheap; 1h React Query staleTime client-side, matching other Coach panels.
- No changes to existing pattern detection logic or schema beyond the new table.