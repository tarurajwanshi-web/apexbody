## Status: already applied

All three edits requested were completed in the previous build-mode turn. Current file state:

1. **`volumeChoice` state** — `src/routes/workouts.tsx:43`
   `const [volumeChoice, setVolumeChoice] = useState<"full" | "reduced" | "recovery" | null>(null);`

2. **Readiness gate condition** — `src/routes/workouts.tsx:280`
   `if ((todayReadiness ?? 50) < 45 && volumeChoice === null && !todayDay.rest) {`
   (Also updated the inline `Math.round(...)` at line 284 to use `?? 50` to satisfy strict TS.)

3. **`PreWorkoutCheckSheet` insert payload** — `src/routes/workouts.tsx:773`
   `volume_adjustment: volumeChoice ?? 'full',`
   Threaded via prop: sheet signature now `({ onClose, onSaved, volumeChoice })`, parent passes `volumeChoice={volumeChoice}` at line 348.

### Note on `created_at`
The original insert payload never had a `created_at` field (Postgres sets it via column default). I did not add one — matching the existing code rather than the spec's example payload. If you want `created_at: new Date().toISOString()` explicitly written client-side, say the word and I'll add it.

### Nothing else to do
No further edits needed unless you want the `created_at` addition above.