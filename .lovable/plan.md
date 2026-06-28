## Add `volume_gate_alert` field to generate-plan

Single file: `supabase/functions/generate-plan/index.ts`.

### 1. Extend the schema in Claude's system prompt (line 46)

Append `"volume_gate_alert": string|null` as a top-level sibling of `"days"`:

```
Schema: { "days": [ ... ], "volume_gate_alert": string|null }.
```

### 2. Strengthen the readiness alert instruction (line 202–204)

Update `readinessNote` so Claude sets the field explicitly when readiness is low:

```
READINESS ALERT: User's avg readiness score this week is {N}.
Reduce total weekly volume by ~20% (drop 1 set per exercise).
Set "volume_gate_alert" to:
"Low readiness detected — keeping volume conservative this week. Reduce to 3 sets per exercise instead of 4-5 if needed."
```

When `lowReadiness` is false, append an "Otherwise" instruction so Claude knows to emit `"volume_gate_alert": null` — without this, the field can come back missing.

### 3. Defensively normalize on the server (after `callClaude` returns, around line 230–239)

After the plan is parsed:

```ts
const { days, volume_gate_alert } = plan ?? {};
const normalized = {
  days: days ?? [],
  volume_gate_alert: lowReadiness
    ? (volume_gate_alert ??
       "Low readiness detected — keeping volume conservative this week. Reduce to 3 sets per exercise instead of 4-5 if needed.")
    : null,
};
```

This guarantees the field exists and matches the lowReadiness signal even if Claude omits or hallucinates it.

### 4. Store it in `weekly_plans` (line 251)

Replace `plan_data: plan` with `plan_data: normalized`, and include the same value in the response body (line 256) so the client receives the normalized shape.

### Scope

- No schema/migration changes (`plan_data` is jsonb).
- No changes to readiness/fuel/history queries or other prompt sections.
- No changes outside `generate-plan/index.ts`.
