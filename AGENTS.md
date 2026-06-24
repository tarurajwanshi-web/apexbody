<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Visual regression tests

Playwright specs live under `tests/visual/` and cover Dashboard, Coach, and
Nutrition at iPhone 14 + Pixel 7 viewports. Each spec asserts three DOM
invariants — canonical body background `#0A0E1A`, no helper text rendered in
the AI accent purple `#A78BFA`, and a Coach header `padding-top` ≥ 16px — and
then takes a screenshot diff against the committed baseline in
`tests/visual/__screenshots__/`.

Local workflow:

```bash
bun run dev                  # terminal 1
bun run test:visual          # terminal 2 — diffs against baselines
bun run test:visual:update   # regenerate baselines after intentional UI changes
```

The `BASE_URL` env var overrides the default `http://localhost:8080`. When
`LOVABLE_BROWSER_SUPABASE_*` are present, the specs restore the injected
Supabase session into localStorage so authenticated routes render real data.

## UI consistency lint

`bun run lint:ui` enforces the dashboard spec across `src/routes/*` and
`src/components/dashboard/*`: allowed font sizes (10/12/14/16/18/20 px),
no `rounded-3xl`, no `font-bold|semibold|extrabold|black`, and — scoped to
`src/routes/nutrition.tsx` + `src/components/dashboard/` — no
`text-text-accent` (purple `#A78BFA` is reserved for AI/action UI elsewhere).
