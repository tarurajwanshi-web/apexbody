**New component** `src/components/CoachingFeed.tsx`:
- Fetches `daily_coaching_cards` for the current user via the browser `supabase` client (id, card_type, content, card_date, created_at, ordered by `created_at desc`, limit 20). RLS already scopes to user.
- In-JS sort pins `permission_slip` to the top, then `created_at desc` for the rest.
- Renders one card per entry using inline styles with the exact spec tokens (`#1A1F3A` bg, `#E8E8E8`/`#A8A8A8` text, teal `#00D9FF` / gold `#FFC107` accents, 1px dotted `rgba(0,217,255,0.4)` separator, 12px radius, 20px padding).
- Header row per card: emoji + type label + relative timestamp; dotted separator; content with `white-space: pre-wrap`.
- Type styling:
  - `daily_scorecard` 📊 — base dark card
  - `daily_note` 💡 — 3px left teal border
  - `weekly_pattern` 📈 — larger card (24px padding), `**bold**` headings rendered as section titles
  - `training_sync` 🏋️ — compact (16px padding)
  - `permission_slip` 🎯 — `linear-gradient(135deg,#00D9FF,#FFC107)` background, white text, pinned to top
- Loading skeleton + empty state ("No coaching cards yet — check back after your next scorecard.")
- Section heading: "Your Coaching Feed".

**Edit** `src/routes/_authenticated/dashboard.tsx`:
- Import and render `<CoachingFeed />` between the APEX Score Card block and the existing Recovery / Sleep / Mood + macros sections (below Shield readiness, above nutrition tracking).
- No other dashboard changes.

**Out of scope:** Shield UI, macros UI, header, navigation, other pages, edge functions, RLS, schema, global design tokens.

**Note:** Page bg spec is `#0A0E27` but the dashboard currently uses `#0A0E1A`. Keeping the existing page background and applying the new tokens only inside the feed cards, so nothing else on the dashboard visually shifts.