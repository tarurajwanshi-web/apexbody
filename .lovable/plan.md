# Dashboard Display Fixes (frontend-only)

Scope: only files under `src/components/dashboard/` and `src/lib/dashboard-state.ts` / `src/lib/dashboard-data.ts` if needed for headline derivation. No edge functions, DB, other pages, navigation, or score logic touched.

## 1. Shared text utilities

Add two pure helpers (co-located in `src/components/dashboard/tokens.ts` or a new `src/components/dashboard/text.ts` — single small file, no new deps):

- `stripMarkdown(input: string): string`
  - Remove `**` and `*` markers (bold/italic), keep inner text.
  - Remove leading `#`, `##`, `###` header markers at line starts.
  - Collapse `\r\n` → `\n`. Preserve `\n\n` as paragraph breaks.
  - Trim trailing whitespace per line; trim outer whitespace.
- `stripEmojis(input: string): string`
  - Remove emoji ranges via regex (covers ❌ ✅ ⚠️ 🕐 📊 and general Unicode emoji blocks).
  - Collapse leftover double spaces.
- `cleanCardText(input)` = `stripEmojis(stripMarkdown(input))`.
- `firstSentence(input: string): string`
  - Run `cleanCardText` first.
  - Cut at first `.`, `!`, `?`, or `\n` (whichever comes first). Return trimmed substring without the terminator-trailing whitespace. If none found, return the whole cleaned string.

## 2. Apply to all card renderers

In `src/components/dashboard/ContextCard.tsx`, `ThisWeek.tsx`, `BottomSheet.tsx`, and any place coaching card `content` is rendered:

- Pipe every card `content` field through `cleanCardText` before render.
- Card types covered: `daily_note`, `daily_scorecard`, `weekly_pattern`, `training_sync`, `permission_slip`.
- For multi-paragraph rendering, split on `\n\n` and map to `<p>` blocks (paragraph spacing via existing styles).

## 3. Scorecard: color-only status

In whichever component renders scorecard rows (ContextCard scorecard branch / BottomSheet):

- After `cleanCardText`, no emoji remains.
- Keep value color (red/amber/green/etc.) as the sole status signal — no replacement glyph inserted. Existing color logic untouched.

## 4. Week in Review / Next Week's Plan subtitles

In `ThisWeek.tsx`, strip emojis from row subtitle strings (whether sourced from card content or hardcoded). Apply `cleanCardText` to dynamic subtitles; for any hardcoded literal containing an emoji, remove the emoji character directly.

## 5. APEX Says headline truncation

In ContextCard's `daily_note` / "APEX Says" branch:

- Replace current `slice(0, 60)` (or similar char-count truncation) with `firstSentence(content)`.
- Body below headline continues to render full `cleanCardText(content)` split into paragraphs.

## Verification

- Visually confirm on `/dashboard`:
  - No `*`, `**`, `#` characters visible in any card.
  - No emojis in scorecard, coaching cards, week/next-week rows, or bottom sheet.
  - APEX Says headline ends on a sentence boundary, never mid-word.

## Out of scope

Edge functions, DB content, score calc, other routes, nav, modals outside the dashboard surface.
