# F1 — evaluate-fuelling: swap dead p80 gate for RIR-based eligibility

Single-file change: `supabase/functions/evaluate-fuelling/index.ts`. No schema, no other files.

## Changes

1. **Delete the p80 block** (all-users trailing-30-day percentile query + `setsByUser` map + `totals`/`p80` computation). It's dead weight now that eligibility is per-user physiological, not population-relative.

2. **Delete `lookbackStart`** — verified nothing else in the file references it (only the deleted p80 query used it).

3. **Replace the volume-tier filter** inside the per-profile loop:
   - Keep `if (total_sets < 15) continue;` (high-volume-day floor).
   - Remove the `setsByUser.get(...) < p80` check.
   - Compute `rirs` and `avg_rir_check` here (moved up from below).
   - Add: `if (avg_rir_check === null || avg_rir_check > 2) continue;` — literature-grounded near-failure gate.

4. **Collapse the duplicate rirs/avg_rir calc** below the meals/targets fetches to `const avg_rir = avg_rir_check;` so the rest of the function (evaluate, miniExplain, upsert) is unchanged.

## Untouched

Everything else — readiness fetch, severity nudge, message reinforcement, `readiness_modifier_at_eval` persistence, `miniExplain`, upsert shape, cron gate, `evaluate()` math.

## Verification

- Re-read the diff to confirm `lookbackStart`, `setRowsAll`, `setsByUser`, `totals`, `p80` are all gone with no stragglers.
- Spot-check a manual invoke (`{ user_id }` override still bypasses time gate; RIR gate still applies, which matches intent — only fuelling-risk users get evaluated).
