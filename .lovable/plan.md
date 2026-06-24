## Surgical visual + layout fixes (4 files)

### 1. `src/components/dashboard/TodayCard.tsx`

Add empty-state message under the rings when `recovery`, `fuel`, and `effort` are all null:

> "Log a meal or recovery check-in to see your scores"

Ring component itself unchanged.

### 2. `src/routes/coach.tsx`

- Replace the gradient root background with the canonical `bg-bg-1` (#0A0E1A).
- Add iOS safe-area padding to the header (`pt-[max(1.5rem,env(safe-area-inset-top))]`) so content clears the notch / dynamic island.

### 3. `src/routes/nutrition.tsx`

- Swap `text-text-accent` (purple, reserved for AI/action) → `text-text-secondary` (grey) at lines 476, 504, 518, 602.
- Replace `BottomNav` import + usage with `DashboardNav` (5-tab with + button) to match Dashboard.

### 4. `src/components/dashboard/tokens.ts`

- Change `bg: "#09091A"` → `bg: "#0A0E1A"` so Dashboard matches the CSS `--bg-1` token used elsewhere.

### Result

All three tabs render on the same `#0A0E1A` background, Coach header is no longer clipped on notched devices, Nutrition helper text reads as neutral grey, and empty Dashboard rings explain themselves.

### Verification

Visual check on Dashboard (empty state copy), Nutrition (grey helpers + 5-tab nav), and Coach (flat bg + visible header) at mobile viewport.

### Out of scope

No backend changes, no new components, no Ring/TodayCard layout rebuild.