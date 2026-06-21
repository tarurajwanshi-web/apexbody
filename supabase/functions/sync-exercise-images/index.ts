// sync-exercise-images
// Fetches reference images for exercise names from the wger public API
// (https://wger.de, CC-BY-SA 4.0) and caches them in Supabase Storage so we
// do not hotlink wger on every page load. Per CC-BY-SA we persist the
// per-image license_author so the client can render visible attribution.
//
// Strategy: wger's API has no working full-text search, so we fetch the full
// English exercise-translation index once per invocation and match locally:
//   1. exact (case-insensitive) name match → 2. all user-name tokens appear
//   in a wger name. Anything else is left unmatched (a missing image is
//   strictly better than a wrong image).
//
// Input: { names?: string[] } — if omitted, scans all weekly_plans.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BUCKET = "exercise-images";
const WGER = "https://wger.de/api/v2";

const nameKey = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

const tokens = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((t) => t.length > 2);

type WgerTr = { exercise: number; name: string };
type WgerImg = { exercise: number; image: string; is_main: boolean; license_author: string | null };

// Hard page caps so a single invocation cannot exhaust the 150s budget on
// wger pagination alone. wger has ~hundreds of pages at limit=200; we cap
// well below that and let subsequent invocations pick up the rest.
const MAX_PAGES = 8;
const FETCH_TIMEOUT_MS = 8000;

async function fetchWithTimeout(url: string): Promise<Response | null> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try { return await fetch(url, { signal: ctrl.signal }); }
  catch { return null; }
  finally { clearTimeout(to); }
}

async function fetchAllEnglishTranslations(): Promise<WgerTr[]> {
  const out: WgerTr[] = [];
  let url: string | null = `${WGER}/exercise-translation/?language=2&limit=200`;
  let pages = 0;
  while (url && pages++ < MAX_PAGES) {
    const r = await fetchWithTimeout(url);
    if (!r || !r.ok) break;
    const j = await r.json() as { results?: WgerTr[]; next?: string | null };
    for (const t of j.results ?? []) if (t.exercise && t.name) out.push({ exercise: t.exercise, name: t.name });
    url = j.next ?? null;
  }
  return out;
}

async function fetchAllImages(): Promise<WgerImg[]> {
  const out: WgerImg[] = [];
  let url: string | null = `${WGER}/exerciseimage/?limit=200`;
  let pages = 0;
  while (url && pages++ < MAX_PAGES) {
    const r = await fetchWithTimeout(url);
    if (!r || !r.ok) break;
    const j = await r.json() as { results?: WgerImg[]; next?: string | null };
    for (const im of j.results ?? []) if (im.image && im.exercise) out.push(im);
    url = j.next ?? null;
  }
  return out;
}

// Equipment / qualifier tokens that wger names often omit. Used as
// non-required tokens when matching — they boost confidence when present,
// but a wger name doesn't have to contain them.
const OPTIONAL = new Set([
  "barbell","dumbbell","cable","machine","kettlebell","band","resistance",
  "single","arm","leg","floor","incline","decline","weighted",
]);

function pickBestExerciseId(userName: string, translations: WgerTr[]): number | null {
  const wantLc = userName.trim().toLowerCase();
  for (const t of translations) if (t.name.trim().toLowerCase() === wantLc) return t.exercise;
  const want = tokens(userName);
  if (want.length === 0) return null;
  const required = want.filter((w) => !OPTIONAL.has(w));
  const targetTokens = required.length >= 1 ? required : want;
  let best: { id: number; score: number; len: number } | null = null;
  for (const t of translations) {
    const tn = t.name.toLowerCase();
    // All required tokens must appear in the wger name.
    if (!targetTokens.every((w) => tn.includes(w))) continue;
    // Score: # of total user tokens (incl. optional) appearing in wger name.
    let score = 0;
    for (const w of want) if (tn.includes(w)) score++;
    if (!best || score > best.score || (score === best.score && t.name.length < best.len)) {
      best = { id: t.exercise, score, len: t.name.length };
    }
  }
  return best?.id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supa = createClient(url, key);

    const body = await req.json().catch(() => ({}));
    let names: string[] = Array.isArray(body?.names) ? body.names : [];
    if (names.length === 0) {
      const { data: plans } = await supa.from("weekly_plans").select("plan_data").limit(500);
      const set = new Set<string>();
      for (const p of plans ?? []) {
        const days = (p as any)?.plan_data?.days ?? [];
        for (const d of days) for (const ex of d?.exercises ?? []) if (ex?.name) set.add(String(ex.name));
      }
      names = Array.from(set);
    }

    // Skip names already cached.
    const keys = names.map(nameKey);
    const { data: existing } = await supa
      .from("exercise_image_cache").select("exercise_name_key").in("exercise_name_key", keys);
    const have = new Set((existing ?? []).map((r: any) => r.exercise_name_key));
    const todo = names.filter((n) => !have.has(nameKey(n)));
    if (todo.length === 0) {
      return new Response(JSON.stringify({ ok: true, processed: 0, matched: 0, missing: [] }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Build the wger indexes once.
    const [translations, images] = await Promise.all([fetchAllEnglishTranslations(), fetchAllImages()]);
    const imgsByExercise = new Map<number, WgerImg[]>();
    for (const im of images) {
      const arr = imgsByExercise.get(im.exercise) ?? [];
      arr.push(im); imgsByExercise.set(im.exercise, arr);
    }

    const report = { processed: 0, matched: 0, missing: [] as string[] };
    for (const name of todo) {
      report.processed++;
      const exId = pickBestExerciseId(name, translations);
      if (exId == null) { report.missing.push(name); continue; }
      const imgs = imgsByExercise.get(exId);
      if (!imgs?.length) { report.missing.push(name); continue; }
      const img = imgs.find((i) => i.is_main) ?? imgs[0];
      const imgRes = await fetch(img.image).catch(() => null);
      if (!imgRes || !imgRes.ok) { report.missing.push(name); continue; }
      const blob = await imgRes.arrayBuffer();
      const ext = (img.image.split(".").pop() || "png").toLowerCase().split("?")[0].slice(0, 5);
      const path = `${nameKey(name)}.${ext}`;
      const ct = imgRes.headers.get("content-type") || `image/${ext}`;
      const up = await supa.storage.from(BUCKET).upload(path, new Uint8Array(blob), { contentType: ct, upsert: true });
      if (up.error) { report.missing.push(name); continue; }
      await supa.from("exercise_image_cache").upsert({
        exercise_name_key: nameKey(name),
        exercise_name: name,
        storage_path: path,
        wger_exercise_id: exId,
        license: "CC BY-SA 4.0",
        license_author: img.license_author || "wger contributors",
        original_url: img.image,
      });
      report.matched++;
    }
    return new Response(JSON.stringify({ ok: true, ...report }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e instanceof Error ? e.message : e) }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
