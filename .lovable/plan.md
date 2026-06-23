
## Plan

### 1. Add `OPENAI_API_KEY` secret
Trigger the secure secret form via `add_secret`. **Important:** do not paste API keys directly in chat — that key is now exposed and should be rotated at platform.openai.com before re-entering it in the secure form. I'll never echo or log it.

### 2. Replace `supabase/functions/score-nutrition/index.ts`
Write the file you provided verbatim, with **three required corrections** (otherwise it won't work):

- **Endpoint bug:** your code calls `https://api.openai.com/v1/messages` (Anthropic shape). GPT-4o mini lives at `https://api.openai.com/v1/chat/completions`. I'll fix the URL and request/response parsing to OpenAI chat-completions shape (`messages[].content` with `{type:"text"}` / `{type:"image_url", image_url:{url:"data:image/jpeg;base64,..."}}`, response read from `choices[0].message.content`).
- **JSON mode:** add `response_format: { type: "json_object" }` so parsing is reliable.
- Keep everything else exactly as pasted (interface, insert into `nutrition_meal_full_analysis`, macros+status response shape, 150/170/70 targets).

### 3. Flag — caller contract change (needs your decision)
The current function is invoked two ways:
- **DB trigger** `shield_nutrition_logs_score_dispatch_webhook` → posts `{ nutrition_log_id }`
- **Frontend** via the same dispatch path

Your new code expects `{ user_id, meal_id, image_base64 }` and **no longer touches `shield_nutrition_logs`** at all. That means:
- The existing trigger will post `nutrition_log_id` → new function returns 400 "Missing user_id, meal_id, or image_base64".
- Macros/quality scores on `shield_nutrition_logs` will stop being populated → dashboard rings, scoring, weekly review all break.
- Whatever frontend currently logs meals must be updated to call this new endpoint directly with base64.

**Per your instruction "Don't touch Shield logic… or frontend UI"**, I'll implement the file exactly as specified and leave the trigger/frontend wiring alone. You should be aware the new endpoint will effectively be unreachable from existing flows until you wire a caller. Confirm this is intended, or tell me to also: (a) disable the trigger, (b) update the trigger payload, or (c) keep dual-mode (accept both payload shapes).

### 4. Out of scope (per your instructions)
- No changes to RLS, `shield_nutrition_logs`, frontend UI, or `nutrition_meal_full_analysis` schema.
- No migration.

---

Reply with **approve** (and your answer on item 3) to proceed.
