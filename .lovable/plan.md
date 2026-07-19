## Plan: one-shot `generate-plan` diagnostics

1. **Add temporary response diagnostics only in `generate-plan/index.ts**`
  - Extend `callClaude` so JSON parsing is wrapped in `try/catch` after `stripFences(text)`.
  - On parse failure, return a diagnostic object shaped like:
    ```json
    {
      "__diagnostic_parse_error": true,
      "parse_error": "...",
      "raw_head": "first 300 chars",
      "raw_tail": "last 300 chars",
      "stop_reason": "..."
    }
    ```
  - Keep successful parses behavior-compatible: return the parsed plan normally.
2. **Capture validation diagnostics in the single-user response**
  - Track both schema validation calls already present:
    - first attempt: `v1.violations`
    - retry/final validation: `v2.violations`
  - If the volume-target soft retry runs, keep that separate internally; the requested output focuses on the two existing `validateGeneratedPlan` calls.
  - Add response-only diagnostics:
    ```json
    {
      "diagnostics": {
        "hasLandmarks": true,
        "landmarksByMuscleKeyCount": 0,
        "firstAttemptViolations": [],
        "retryViolations": [],
        "parsedDaysLength": 7,
        "parseDiagnostic": null
      }
    }
    ```
  - If parsing fails, short-circuit safely and return the parse diagnostic in the HTTP JSON instead of falling through to fallback silently.
3. **Deploy the temporary diagnostic function**
  - Deploy only `generate-plan`.
  - Do not touch `generate-training-sync` or `generate-weekly-pattern`.
4. **Invoke once for user `1f83792a-5b77-4c6a-aafe-858f21380f14**`
  - Use the existing secure invocation path for this function.
  - Capture and paste the full raw JSON response body, including diagnostics and any error field.
5. **Revert diagnostics immediately after capture**
  - Restore `generate-plan/index.ts` to the pre-diagnostic behavior.
  - Redeploy `generate-plan` again so the temporary response diagnostics are no longer live.
  - Report that the temporary code was reverted, plus the captured JSON from the one diagnostic run.
6. **Also surface the volume soft-retry outcome:** if the A3 volume retry runs, include in diagnostics: `volumeRetryTriggered` (bool), `volumeOffenders` (the array of muscles that missed target on the first pass), and `volumeRetrySucceeded` (bool — did the retried plan pass validation). And include the final `usedFallback` boolean plus a one-word `fallbackReason` ("parse" | "schema_v1" | "schema_v2" | "volume_retry" | "none") so I can see in one field which door led to the fallback.