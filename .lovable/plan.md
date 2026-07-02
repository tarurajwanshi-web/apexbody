# Batch: weekly-pattern prose conversion

## Status of Fix 1 (evaluate-fuelling)

Already applied in this project earlier today — p80 population gate removed, replaced with `avg_rir_check <= 2` eligibility, duplicate `avg_rir` calc collapsed, `lookbackStart` removed. No action needed. Will re-verify by reading the file before closing.

## Fix 2 — `supabase/functions/generate-weekly-pattern/index.ts` lines 429–434

Replace the numbered-markdown structure block:

```
Generate a weekly pattern review (250-300 words). Structure:

1. **What's Working** (celebrate 3-4 specific wins — use their actual data, not generic)
2. **Pattern to Notice** (one recurring pattern from their actual foods/flags — not judgment, just observation)
3. **One Experiment to Try Next Week** (specific, actionable, with expected outcome)
4. **Your Body This Week** (connect training + nutrition + weight trend — what actually happened)
```

with the plain-prose instruction the user pasted (flowing paragraphs, no markdown, no numbering, no headers, same four beats in order).

## Not in scope

- Rules block (lines 436–448), Output line (450), the `📊` opener — untouched.
- No other files.
- No prompt changes to `evaluate-fuelling` or `generate-training-sync`.

## Verify after edit

- `rg -n "What's Working|Pattern to Notice|\*\*" supabase/functions/generate-weekly-pattern/index.ts` → no matches inside the prompt body.
- Re-read `evaluate-fuelling/index.ts` around the volume-tier filter to confirm Fix 1 is still in place.
