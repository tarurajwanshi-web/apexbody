## Force rebundle of weekly-macro functions

Add a single comment line at the top of each function's `index.ts` to force a fresh bundle that picks up the current `_shared/macro-calculation.ts` (F1 goal-deficit block).

### Edits

**File 1 — `supabase/functions/calculate-macros-weekly/index.ts`**
Insert at line 1:
```ts
// redeploy: rebundle _shared/macro-calculation.ts (F1 goal-deficit) 2026-07-21
```

**File 2 — `supabase/functions/trigger-weekly-macro-review/index.ts`**
Insert at line 1:
```ts
// redeploy: rebundle _shared/macro-calculation.ts (F1 goal-deficit) 2026-07-21
```

No other changes.

### Deploy

Redeploy both functions via `supabase--deploy_edge_functions` with `["calculate-macros-weekly", "trigger-weekly-macro-review"]` and confirm each returns a new deploy timestamp.