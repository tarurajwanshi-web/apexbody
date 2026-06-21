// sync-exercise-images
// Fetches reference images for exercise names from the wger public API
// (https://wger.de, CC-BY-SA 4.0) and caches them in Supabase Storage so
// the app does not hotlink wger on every page load.
//
// Input: { names: string[] }   -> sync just those names
//        {}                    -> scan all weekly_plans, dedupe, sync missing
//
// Per-row we persist: storage_path, wger_exercise_id, license, license_author,
// original_url. This metadata is required for the per-image CC-BY-SA
// attribution caption rendered in the client.
//
// Matching strategy: exact (case-insensitive) wger name match first, then a
// loose contains-match against the wger result list when the user-provided
// name contains keywords that appear in a wger exercise name. We skip rather
// than guess wrong: an absent image is much better than a mismatched one.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BUCKET = "exercise-images";
const WGER_BASE = "https://wger.de/api/v2";

function nameKey(s: string) {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function tokens(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((t) => t.length > 2);
}

async function findWgerExercise(name: string): Promise<{ id: number; name: string } | null> {
  // English = language id 2 on wger.
  // Use exerciseinfo for richer payload (includes "name" and license context).
  const search = encodeURIComponent(name);
  const url = `${WGER_BASE}/exerciseinfo/?language=2&limit=50&name=${search}`;
  let res: Response;
  try { res = await fetch(url); } catch { return null; }
  if (!res.ok) return null;
  const json = await res.json().catch(() => null) as { results?: Array<{ id: number; name?: string; translations?: Array<{ language: number; name: string }> }> } | null;
  const results = json?.results ?? [];
  if (results.length === 0) {
    // Fallback: search exercise endpoint
    const r2 = await fetch(`${WGER_BASE}/exercise/?language=2&limit=50&name=${search}`).catch(() => null);
    if (!r2 || !r2.ok) return null;
    const j2 = await r2.json().catch(() => null) as { results?: Array<{ id?: number; exercise_base?: number; name?: string }> } | null;
    const r = j2?.results?.[0];
    const id = r?.exercise_base ?? r?.id;
    if (typeof id !== "number") return null;
    return { id, name: r?.name ?? name };
  }
  const wantTokens = tokens(name);
  // Exact match first (case-insensitive).
  for (const r of results) {
    const cand = r.translations?.find((t) => t.language === 2)?.name ?? r.name ?? "";
    if (cand.trim().toLowerCase() === name.trim().toLowerCase()) return { id: r.id, name: cand };
  }
  // Loose contains match — require ALL tokens of the user-name to appear in wger name.
  for (const r of results) {
    const cand = (r.translations?.find((t) => t.language === 2)?.name ?? r.name ?? "").toLowerCase();
    if (wantTokens.length > 0 && wantTokens.every((t) => cand.includes(t))) {
      return { id: r.id, name: cand };
    }
  }
  return null;
}

async function findWgerImage(exerciseBaseId: number): Promise<{ url: string; license: string | null; license_author: string | null } | null> {
  const url = `${WGER_BASE}/exerciseimage/?exercise_base=${exerciseBaseId}&is_main=True&limit=5`;
  let res: Response;
  try { res = await fetch(url); } catch { return null; }
  if (!res.ok) return null;
  const json = await res.json().catch(() => null) as { results?: Array<{ image: string; license_author?: string; license?: number; license_object?: { short_name?: string } }> } | null;
  let r = json?.results?.[0];
  if (!r) {
    const res2 = await fetch(`${WGER_BASE}/exerciseimage/?exercise_base=${exerciseBaseId}&limit=5`).catch(() => null);
    if (!res2 || !res2.ok) return null;
    const j2 = await res2.json().catch(() => null) as { results?: Array<{ image: string; license_author?: string; license?: number; license_object?: { short_name?: string } }> } | null;
    r = j2?.results?.[0];
  }
  if (!r?.image) return null;
  return {
    url: r.image,
    license: r.license_object?.short_name ?? "CC-BY-SA 4.0",
    license_author: r.license_author ?? null,
  };
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
      const { data: plans } = await supa.from("weekly_plans").select("plan_data").limit(200);
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
      .from("exercise_image_cache")
      .select("exercise_name_key")
      .in("exercise_name_key", keys);
    const have = new Set((existing ?? []).map((r: any) => r.exercise_name_key));
    const todo = names.filter((n) => !have.has(nameKey(n)));

    const report = { processed: 0, matched: 0, missing: [] as string[] };
    for (const name of todo) {
      report.processed++;
      const ex = await findWgerExercise(name);
      if (!ex) { report.missing.push(name); continue; }
      const img = await findWgerImage(ex.id);
      if (!img) { report.missing.push(name); continue; }
      // Download
      const imgRes = await fetch(img.url).catch(() => null);
      if (!imgRes || !imgRes.ok) { report.missing.push(name); continue; }
      const blob = await imgRes.arrayBuffer();
      const ext = (img.url.split(".").pop() || "jpg").toLowerCase().split("?")[0].slice(0, 5);
      const path = `${nameKey(name)}.${ext}`;
      const ct = imgRes.headers.get("content-type") || `image/${ext}`;
      const up = await supa.storage.from(BUCKET).upload(path, new Uint8Array(blob), { contentType: ct, upsert: true });
      if (up.error) { report.missing.push(name); continue; }
      await supa.from("exercise_image_cache").upsert({
        exercise_name_key: nameKey(name),
        exercise_name: name,
        storage_path: path,
        wger_exercise_id: ex.id,
        license: img.license,
        license_author: img.license_author,
        original_url: img.url,
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
