# APEX Closed-Loop Diagnostic (read-only)

**Context restated.** APEX is a closed-loop coaching app: deterministic engines compute everything and AI only narrates. The loop is onboarding → readiness_scores → training gate → workout_set_logs → weekly macro review → new macro targets → nutrition logs → back into readiness. Every check below is proved from live SQL or quoted code; nothing was changed and no fixes are proposed here.

## Results table


| #   | Check                                  | Verdict                         | Evidence |
| --- | -------------------------------------- | ------------------------------- | -------- |
| 1   | Onboarding capture completeness        | **PARTIAL FAIL**                | See §1   |
| 2   | Cron jobs scheduled                    | **UNKNOWN** (permission denied) | See §2   |
| 3   | Engine 1 (readiness) writing           | **PASS**                        | See §3   |
| 4   | Readiness gate consumed by training UI | **PASS (weak — manual choice)** | See §4   |
| 5   | Engine 2 (macro adaptation) loop       | **PARTIAL FAIL**                | See §5   |
| 6   | Training load → nutrition seam         | **PASS**                        | See §6   |
| 7   | AI narration boundary                  | **PASS**                        | See §7   |
| 8   | Data completeness for reviews          | **PASS**                        | See §8   |


---

## §1 Onboarding capture

`profiles` columns present: `name, biological_sex, age, measurement_weight_kg, measurement_height_cm, goal, target_weight_kg, target_rate_pct, training_days_per_week, training_day_codes, equipment_access, experience_level, eating_pattern, coaching_time, timezone, body_data_type, dexa_*`, plus review state fields.

Onboarding UI (`src/routes/_authenticated/onboarding.tsx`) writes: `name, biological_sex, age, measurement_weight_kg, measurement_height_cm, goal, target_weight_kg, target_rate_pct, training_day_codes, equipment_access, experience_level, eating_pattern` (lines 295–334). So every field the checklist named is captured in onboarding. **Never-collected**: none of the listed fields.

Population reality across all 70 profiles:

```
total=70   no_goal=0   no_days=0   no_eating=0
no_xp=53   no_equip=53   no_rate=69   no_age=0   no_sex=0   no_name=0
```

- `experience_level` and `equipment_access` are NULL for **53 / 70** profiles. They are both read by engines (`generate-plan`, `check-permission-slip`, `evaluate-fuelling`, `generate-training-sync`, `generate-weekly-pattern`, `generate-daily-coach-note`), so those users hit engines with missing inputs.
- `target_rate_pct` is NULL for **69 / 70** — meaning macro-review direction math (`p.target_rate_pct` in `macro-calculation.ts` L≈241) falls back to `0.25` for essentially everyone.

These are stale seed rows, not a schema hole — onboarding does write the columns. Marked partial because whatever seeded these test users bypassed onboarding and the read-side engines have no defaults.

## §2 Cron jobs

```
SELECT jobname, schedule, active FROM cron.job;
ERROR:  permission denied for schema cron
```

`cron.job` and `cron.job_run_details` are not readable from the exec Postgres role. Cannot prove or disprove that the daily readiness/coach-note and weekly-macro-review crons are scheduled. **UNKNOWN.**

Indirect evidence a scheduler is running: `nutrition_weekly_reviews` has fresh rows dated `2026-07-06` for the current week (§5), and 9 `daily_macro_targets` rows exist with `source='weekly_review'` written after the onboarding rows. Something is calling `trigger-weekly-macro-review`; the SQL check to confirm it's `pg_cron` and not an ad-hoc invocation is blocked by permissions.

## §3 Engine 1 writing

`readiness_scores` latest 10 rows all have `final_score` populated and `pillar_breakdown IS NOT NULL = true`, with `nutrition_modifier` and `training_permission` set:

```
2026-07-01  final_score=56  has_pillars=t  fuel_more          orange_reduce
2026-07-01  final_score=50  has_pillars=t  normal             orange_reduce
2026-06-30  final_score=70  has_pillars=t  hydration_priority yellow_modify
… (8 more, all populated)
```

Total rows: **1,179** since 2026-05-30. **PASS.**

## §4 Gate consumption

`src/routes/workouts.tsx`:

```ts
// L113
const { data: readinessRow } = await supabase.from("readiness_scores")…
setTodayReadiness(readinessRow ? Number(readinessRow.final_score) : null);

// L172-187 — actual gate
const effectivePlan = useMemo(() => {
  if (!volumeChoice || volumeChoice === "full") return plan;
  const factor = volumeChoice === "recovery" ? 0.5 : 0.7;
  const days = plan.plan_data.days.map((d, i) =>
    i !== todayIdx || d.rest ? d
    : { ...d, exercises: d.exercises.map(ex => ({ ...ex, sets: Math.max(2, Math.ceil(ex.sets * factor)) })) }
  );
  return { ...plan, plan_data: { ...plan, days } };
}, [plan, volumeChoice, todayIdx]);

// L284 — readiness triggers the choice
if ((todayReadiness ?? 50) < 45 && volumeChoice === null && !todayDay.rest) {
  // renders "Readiness is X. Consider scaling back." with three buttons
```

So today's rendered session **is** reshaped by `readiness_scores.final_score`, but only through a user-tapped choice on the low-readiness banner (thresholds: `< 45` shows the prompt; buttons choose `-30%`, `-50%`, or full). There is no automatic default — if the user does nothing, the full plan renders. `training_permission` (`orange_reduce`/`yellow_modify`) is written but not read by `workouts.tsx` (no matches).

Verdict: **PASS**, weak — the gate exists and consumes `final_score`, but relies on a manual choice rather than the engine's `training_permission` decision.

Sample low-readiness day: user `00000000-…-0001-000000000006`, `2026-07-01`, `final_score=56`, `training_permission=orange_reduce`. Because 56 ≥ 45, the workouts screen would render the plan **at full volume** with no banner — the `training_permission=orange_reduce` signal is discarded by the UI.

## §5 Engine 2 (macro adaptation) loop

`daily_macro_targets` shows history exists with a provenance trail. Example user `…0001-000000000006`:

```
2026-05-30 → 2026-06-22   target=2772  source=onboarding
2026-06-22 → (open)       target=2060  source=weekly_review  review_id=dbc9aab6…
```

`apply_existing_weekly_macro_review` exists (confirmed in `pg_proc` output shown in system context / db-functions block) and 9 macro-target rows in the table have `source='weekly_review'` (8 distinct users), each linked to a `review_id`.

But the review activity is skewed:

```
SELECT decision, count(*) FROM nutrition_weekly_reviews …
 reduce=0   increase=0   hold=114   capped=9   applied=9   total=123
```

- **0** reviews decided `reduce` or `increase`. All movement in `daily_macro_targets` came from `decision='capped'` (safety floor/ceiling), not from the observed-vs-target rate comparison.
- The 20 most recent reviews (week `2026-07-06`, `2026-06-29`) are **all** `decision=hold, flag_reason=abnormal_week, adjustment_kcal=0, weight_trend_kg_per_week=0.00`. `applied_at` is NULL for every recent row.
- Combined with §1 (`target_rate_pct` NULL for 69 / 70 users), the rate-based adjustment branch has effectively never fired in the recorded history. Adaptation is running structurally, but the current cohort experiences no adaptive movement — only the initial safety-cap correction.

**PARTIAL FAIL.** The engine loop is wired end to end (weekly review → RPC → new target with `source='weekly_review'`), but for every user with 3+ weeks of data the recent decisions are `hold/abnormal_week`, so live adaptation is dead for the current cohort until adherence and `target_rate_pct` are populated.

## §6 Training load → nutrition seam

`supabase/functions/_shared/macro-calculation.ts`:

```ts
// L161
const { data: workoutSets } = await supa.from("workout_set_logs").select("id").eq("user_id", user_id)
  .gte("entry_date", week_start_date).lt("entry_date", window_end_exclusive);
const totalSets = workoutSets?.length ?? 0;

// L166
const { data: trainingLogs } = await supa.from("shield_training_logs").select("strain_value")…
const avgStrain = trainingLogs.reduce((s,t)=>s+Number(t.strain_value??0),0)/trainingLogs.length;

// L171-192 — trainingLoadIndex composed from sets + strain, clamped 0.7..1.3
// L255
const raw_target_calories = blended_tdee * trainingLoadIndex;
```

Both columns exist and are populated. Last 14 `shield_training_logs.strain_value` rows show values 2.4–18 across active users on `2026-06-26..29`. `workout_set_logs` has 876 rows total. Both feed `trainingLoadIndex` and it multiplies `blended_tdee` on the exact seam. **PASS.**

## §7 AI narration boundary

Edge functions that call an LLM (grep for `LOVABLE_API_KEY|ANTHROPIC_API_KEY|CLAUDE_API|OPENAI_API_KEY|api.anthropic|api.openai`):

```
generate-training-sync         ← buildApexSystemPrompt ✓ (L206)
generate-weekly-pattern        ← buildApexSystemPrompt ✓ (L67, L434)
generate-daily-coach-note      ← buildApexSystemPrompt ✓ (L289)
evaluate-fuelling              ← buildApexSystemPrompt ✓ (L68)
check-permission-slip          ← buildApexSystemPrompt ✓ (L188)
coach-general-qa               ← buildApexSystemPrompt ✓ (L14, module-level APEX_BASE)
generate-plan                  ← LLM caller, NO buildApexSystemPrompt import
score-nutrition                ← LLM caller, NO buildApexSystemPrompt import
parse-device-upload            ← LLM caller, NO buildApexSystemPrompt import
backfill-cues                  ← LLM caller, NO buildApexSystemPrompt import
```

6/10 LLM callers wrap the shared voice. The 4 that don't (`generate-plan`, `score-nutrition`, `parse-device-upload`, `backfill-cues`) are extraction/scoring pipelines producing structured output, not user-facing narration — sample of `score-nutrition` shows the LLM returns a JSON score wrapper, then deterministic code stores it; numeric fields written to DB are the engine's, not free-text from the model.

Example of engine numbers passed **into** the model (proving narration-only boundary) — `generate-training-sync` L206 area:

```ts
system: buildApexSystemPrompt({ proficiency, name }),
messages: [{ role: "user", content: `Readiness ${final_score}. Strain ${avgStrain}.
Volume ${weeklySetAvg} sets/day. Target kcal ${target_calories}. Adherence ${adherence_pct}%…` }]
```

Numeric targets/load/scores in the DB come from the engines, not the model. **PASS.**

## §8 Data completeness

```
readiness_scores        rows=1179   min(score_date)=2026-05-30
workout_set_logs        rows=876
shield_nutrition_logs   rows=387
```

No truncation triggers on these tables (only append/upsert webhooks, per `db-functions` in project context — `shield_*_webhook` dispatches score jobs; nothing deletes rows). Soft-delete on nutrition logs is `deleted=true` flag, not row removal. **PASS.**

---

## Broken links in the loop (confirmed FAILs, most loop-critical first)

1. **Engine 2 adaptive branch never fires for the current cohort** (§5). Recent reviews are 100% `hold / abnormal_week / adjustment_kcal=0 / trend=0`, and 0 reviews in history have decision `reduce` or `increase`. The observed-vs-target-rate math in `macro-calculation.ts` (L241–274) has produced zero movement; only the safety-cap branch (`decision=capped`, 9 rows) ever wrote a new target. Adaptation is structurally wired but functionally silent.
2. `**target_rate_pct` NULL for 69 of 70 profiles** (§1). This is the input the adaptive branch in §5 gates on; without it the fat-loss/gain rate comparison degrades to a fallback and no user's targets can move via the rate seam.
3. `**experience_level` and `equipment_access` NULL for 53 of 70 profiles** (§1). Read by `generate-plan`, `check-permission-slip`, `evaluate-fuelling`, `generate-training-sync`, `generate-weekly-pattern`, `generate-daily-coach-note` — those engines run against missing inputs for the majority of users.
4. **Readiness gate uses `final_score` cutoff instead of `training_permission**` (§4). `readiness_scores.training_permission` (values `orange_reduce`, `yellow_modify`) is written by the engine but not read anywhere in `src/routes/workouts.tsx`; the UI compares `final_score < 45` and requires a user tap. Users with `training_permission=orange_reduce` and `final_score=56` (real row: user `…000006`, 2026-07-01) see the full plan with no banner — engine decision discarded.

Cron scheduling status (§2) remains **UNKNOWN** — `cron.job` is not readable from this role, so it is not listed as a FAIL.  
  
Not yet — two of the four FAILs may be misdiagnosed, and I can check both in the code before you burn a fix cycle. Give me a second.Approve with corrections — two of the four FAILs are misdiagnosed, and fixing them as reported would be fixing the wrong thing.

**FAIL 1 (adaptation silent) is mostly your test data, not the engine.** The code shows `abnormal = adherence < 45%` (70% when at the calorie floor), and the trend branch only runs with `days_logged >= 3 && weigh_in_count >= 2`. Your seeded users don't log meals consistently and barely weigh in, so every review correctly decides `hold/abnormal_week` with trend 0.00. The engine is behaving exactly as designed against garbage input. The fix is not code — it's seeding two or three users with 4 weeks of realistic adherent data (5+ logged days/week, 2+ weigh-ins/week, a genuine weight trend off-target) and confirming a `reduce` or `increase` fires. Until that test passes, we genuinely don't know if the adaptive branch works; right now it's merely unproven, not broken.

**FAIL 2 (target_rate_pct NULL) is a design choice, not a hole.** Onboarding writes it only when the user sets a pace — line 309: `draft.targetRatePct ? Number(...) : null` — and the engine falls back to 0.25. That's defensible, but silent. Small real fix: persist the default explicitly at onboarding completion (write 0.25 with the goal-appropriate sign) so the DB reflects what the engine will actually do and the review provenance isn't lying.

**FAIL 3 (experience/equipment NULL for 53/70)** — seed artifact, those rows bypassed onboarding. No code fix. Optionally backfill the test rows with one UPDATE.

**FAIL 4 is the real one, and it's worse than the report frames it.** The engine writes `training_permission` (`orange_reduce`, `yellow_modify`) and the UI ignores it entirely, using its own `final_score < 45` cutoff plus a manual tap. That's the UI re-deriving a decision an engine already made — a direct violation of your own rule 3, and it means the moat feature literally doesn't reach the user at readiness 56 with `orange_reduce`. Fix: `workouts.tsx` reads `training_permission` as the source of truth, auto-applies the reduction by default (orange → 0.7, red/recover → 0.5, yellow → banner with modify suggestion), with a one-tap "train full anyway" override so autonomy is preserved. The `< 45` heuristic gets deleted.

**Cron (UNKNOWN):** run `SELECT jobname, schedule, active FROM cron.job;` yourself in the Supabase dashboard SQL editor — that runs as postgres and will see the schema Lovable's role can't. Thirty seconds, and it settles whether adaptation has a heartbeat at all. Do this before anything else; if the weekly cron isn't there, that jumps to fix #1.

So the approved batch is: gate fix (FAIL 4, Claude Code, one file), target_rate_pct explicit default (onboarding, two lines), test-data seed pack + verification query proving `reduce`/`increase` fires and your manual cron check.