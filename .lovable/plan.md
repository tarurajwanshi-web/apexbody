
## B6.2 — Fix generate-plan timeout so a real Sonnet plan writes

### Root cause (confirmed)
`generate-plan/index.ts` makes up to 3 sequential Sonnet calls per invocation (initial → schema-fix retry → volume soft-retry). At `max_tokens: 16000`, each call is ~40–90s. The volume retry fires on nearly every run (±2 sets across all muscles is hard to hit), so typical runs = 2–3 sequential calls = 2–4 min, exceeding the edge wall-clock. Function dies before validate/clamp/write. Observed: ~75s boot→shutdown, no `weekly_plans` update, no HTTP body. Not a token/parse issue — 200s from Anthropic, `stop_reason` guard already in place.

### Scope — two edits, one file
`supabase/functions/generate-plan/index.ts` only.

### Change 1 — Delete the volume soft-retry block
Remove the `// B6 A3 — soft retry on volume target mismatch` block (~lines 463–478) that:
- calls `findVolumeOffenders(plan)`
- re-prompts Sonnet with an "increase these muscles" instruction
- calls `tryClaude(reprompt)` a second/third time
- re-runs `validateGeneratedPlan` on the retried plan

Rationale: `clampPlanToCeilings` (downstream, ~line 488) is deterministic and already GUARANTEES no muscle exceeds `fuel_adjusted_mrv`. That hard ceiling doesn't need an LLM retry. Sonnet still receives target volumes in the prompt (best-effort adherence); missing them is fine because the clamp enforces the invariant.

Keep:
- The schema-fix retry (~lines 448–461) — fires rarely, fixes broken JSON schema, worst case is now 2 calls.
- `findVolumeOffenders` — leave defined (unused) or delete; harmless. Prefer delete for cleanliness.
- `clampPlanToCeilings`, `block_context`, landmark read, volume-target prompt injection — all unchanged.

Worst case after this: 2 Sonnet calls. Typical case: 1.

### Change 2 — Add 55s AbortController to callClaude
Wrap the Anthropic fetch in `callClaude` with an `AbortController` that aborts at 55000ms:

```ts
async function callClaude(apiKey: string, prompt: string) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 55000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { /* unchanged */ },
      body: JSON.stringify({ /* unchanged, max_tokens: 16000 */ }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    const j = await res.json();
    if (j?.stop_reason === "max_tokens") {
      throw new Error("Anthropic response truncated: stop_reason=max_tokens");
    }
    // existing parse/diagnostic path unchanged
    ...
  } finally {
    clearTimeout(timer);
  }
}
```

On abort, `fetch` throws `AbortError` → caught by the existing `try { plan = await tryClaude(...) } catch { plan = null }` → clean fallback path runs, `clampPlanToCeilings` runs on fallback, `weekly_plans` is written, HTTP body returns. Function ALWAYS completes and writes something within edge limits.

### Leave unchanged
- `max_tokens: 16000`
- `model: claude-sonnet-4-6`
- Clamp, `block_context` stamp, landmark read, volume-target prompt injection
- Schema-fix retry
- `generate-training-sync`, `generate-weekly-pattern`, all other functions

### Deploy + decisive test
1. Deploy `generate-plan` only.
2. Invoke for `1f83792a-5b77-4c6a-aafe-858f21380f14` via the internal-secret path (`tmp_dispatch_generate_plan`), since preview SDK returns 403.
3. Confirm the function RETURNS (not 75s silent death) — response body within ~60s.
4. Run this single query against `weekly_plans`:

```sql
select
  plan_data->>'volume_gate_alert' as vol_alert,
  (select sum((ex->>'sets')::int)
     from jsonb_array_elements(plan_data->'days') d,
          jsonb_array_elements(d->'exercises') ex) as total_sets,
  (select array_agg(distinct ex->>'muscle_group')
     from jsonb_array_elements(plan_data->'days') d,
          jsonb_array_elements(d->'exercises') ex) as muscles,
  md5(plan_data::text) as plan_hash
from weekly_plans
where user_id='1f83792a-5b77-4c6a-aafe-858f21380f14'
  and week_start_date=(select max(week_start_date) from weekly_plans
                        where user_id='1f83792a-5b77-4c6a-aafe-858f21380f14');
```

### Two outcomes — both decisive
- **PASS**: `vol_alert` is NOT "Safe fallback plan generated" (null or a readiness message), `total_sets` ~90–110, `muscles` includes calves/forearms → real Sonnet plan wrote. B6.2 done; proceed to adherence measurement.
- **FAIL**: `vol_alert` still "Safe fallback" BUT the function returned cleanly within ~60s → a single Sonnet call is aborting at 55s. Definitive signal that generation must go async/background (return immediately, write via `EdgeRuntime.waitUntil`) → open B6.2b.

Either way, the 75s silent-death mode is eliminated.

### Out of scope (deferred, in order)
1. Onboarding delivery fix (blocking await + landmarks race in `onboarding.tsx:313–330`).
2. Set-count filler + goal-aware sequencer (deterministic post-processors).
3. Phenotype priority-weight hooks.
4. B7 day-1 ring dispatch.
5. Async/background generation — ONLY if the test above shows a single call aborts.
