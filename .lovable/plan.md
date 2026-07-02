# Switch mini-explanation calls from Lovable Gateway to OpenAI (APEX voice)

Scope: three files. Only the small "mini explanation / pattern explanation" AI calls change. Pattern detection math, main weekly card generation, contradiction logic, cadence gating, idempotency, `generate-plan`, `training-rules.ts`, and all SQL/schema stay untouched.

## FILE 1 — `supabase/functions/check-permission-slip/index.ts`

Delete the `- Start with 🎯` bullet from the Haiku prompt text. No other changes.

## FILE 2 — `supabase/functions/evaluate-fuelling/index.ts`

1. Add import after `authorize.ts` import:
   `import { buildApexSystemPrompt } from "../_shared/apex-voice.ts";`
2. Extend profile select to include `name`.
3. Add `const openaiKey = Deno.env.get("OPENAI_API_KEY")!;` next to existing env reads.
4. Replace `miniExplain` entirely: new signature takes `openaiKey` plus `name` and `proficiency` in ctx; calls `https://api.openai.com/v1/chat/completions` with `gpt-4o-mini`, `response_format: json_object`, system prompt = `buildApexSystemPrompt({ proficiency, name })`, user prompt unchanged in substance.
5. Update the call site to pass `openaiKey`, and add `name` / `proficiency` from the profile row.
6. Check whether `lovableKey` is referenced elsewhere in the file; if not, remove the declaration. (Confirmed from the file shown: only `miniExplain` uses it — remove the `const lovableKey = ...` line.)

## FILE 3 — `supabase/functions/generate-weekly-pattern/index.ts`

1. Replace `generatePatternExplanation` entirely: new signature takes `openaiKey` and `ctx` including `name`; calls OpenAI `gpt-4o-mini` with `response_format: json_object`, system = `buildApexSystemPrompt({ proficiency, name })`, user prompt unchanged in substance.
2. Add `const openaiKey = Deno.env.get("OPENAI_API_KEY") || "";` inside `Deno.serve` next to existing env reads.
3. Update the call site to pass `openaiKey` and `name: (profile as any).name ?? null`.
4. Remove the existing `lovableKey` declaration/env read from this file (nothing else uses it here).

## Notes

- `OPENAI_API_KEY` already exists in project secrets — no `add_secret` needed.
- `buildApexSystemPrompt` already exists in `_shared/apex-voice.ts`.
- No changes to `generate-training-sync`, `calculate-macros-weekly`, or `_shared/time-helpers.ts`.
