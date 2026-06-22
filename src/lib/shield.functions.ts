import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const setInputPathPreference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ input_path_preference: z.enum(["device", "manual"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .upsert(
        { user_id: context.userId, input_path_preference: data.input_path_preference },
        { onConflict: "user_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getInputPathPreference = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<"device" | "manual" | null> => {
    const { data } = await context.supabase
      .from("profiles")
      .select("input_path_preference")
      .eq("user_id", context.userId)
      .maybeSingle();
    const v = data?.input_path_preference;
    return v === "device" || v === "manual" ? v : null;
  });

function today() {
  return new Date().toISOString().slice(0, 10);
}

export const upsertManualRecovery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      recovery_self_rating: z.number().int().min(1).max(5),
      sleep_hours: z.number().min(0).max(24),
      mood_emoji: z.string().min(1).max(8).nullable().optional(),
      // Per-day source marker. 'device_parse_failed_fallback' = the user is
      // normally on the device path but today's screenshot couldn't be
      // parsed, so they entered manually as a one-day fallback. We do NOT
      // change profiles.input_path_preference in that case — they remain a
      // device-path user. Default 'manual' for ordinary manual-path entries.
      recovery_source: z.enum(["manual", "device_parse_failed_fallback"]).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const payload = {
      user_id: context.userId,
      entry_date: today(),
      recovery_self_rating: data.recovery_self_rating,
      sleep_hours: data.sleep_hours,
      recovery_source: data.recovery_source ?? "manual",
      ...(data.mood_emoji != null ? { mood_emoji: data.mood_emoji } : {}),
    };
    const { error } = await context.supabase
      .from("shield_manual_inputs")
      .upsert(payload, { onConflict: "user_id,entry_date" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Standalone mood upsert — used by the device-path recovery flow so device
 *  users still contribute Mood data (their own pillar, independent of path). */
export const upsertMood = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ mood_emoji: z.string().min(1).max(8) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("shield_manual_inputs")
      .upsert(
        { user_id: context.userId, entry_date: today(), mood_emoji: data.mood_emoji },
        { onConflict: "user_id,entry_date" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Atomic increment via SECURITY DEFINER RPC. Returns the new total ml. */
export const logHydration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ amount_ml: z.number().int().min(1).max(5000) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ total_ml: number }> => {
    const { data: total, error } = await context.supabase.rpc("increment_hydration", {
      p_amount_ml: data.amount_ml,
    });
    if (error) throw new Error(error.message);
    return { total_ml: Number(total ?? 0) };
  });

export type HydrationSummary = {
  consumed_ml: number;
  target_ml: number | null;
  had_training_today: boolean;
  weight_kg: number | null;
  path: "device" | "manual";
  /** Recent recovery context for the causally-aware device-path insight.
   *  All optional; populated when readiness_scores rows exist. */
  recovery_today: number | null;
  recovery_yesterday: number | null;
  /** Mean of recovery pillar over prior 7 days (excluding today). */
  recovery_baseline: number | null;
};

export const getTodayHydration = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<HydrationSummary> => {
    const date = today();
    const yesterday = (() => {
      const d = new Date(date + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 1);
      return d.toISOString().slice(0, 10);
    })();
    const baselineFrom = (() => {
      const d = new Date(date + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 8);
      return d.toISOString().slice(0, 10);
    })();
    const [profileRes, manualRes, trainingRes, scoresRes] = await Promise.all([
      context.supabase
        .from("profiles")
        // Read BOTH the measurement weight AND the DEXA lean-mass/bodyfat — we
        // derive a weight fallback from DEXA for users whose onboarding body
        // path was DEXA-only (and therefore never wrote measurement_weight_kg).
        // Root cause of the "Add your weight in settings" bug: only the
        // measurements-path branch of onboarding wrote measurement_weight_kg,
        // so DEXA users and "Skip for now" users had a NULL weight even
        // though their DEXA report contained enough info to derive it.
        .select("input_path_preference, measurement_weight_kg, dexa_lean_mass_kg, dexa_body_fat_pct")
        .eq("user_id", context.userId)
        .maybeSingle(),
      context.supabase
        .from("shield_manual_inputs")
        .select("hydration_ml")
        .eq("user_id", context.userId)
        .eq("entry_date", date)
        .maybeSingle(),
      context.supabase
        .from("shield_training_logs")
        .select("id")
        .eq("user_id", context.userId)
        .eq("entry_date", date)
        .maybeSingle(),
      context.supabase
        .from("readiness_scores")
        .select("score_date, pillar_breakdown")
        .eq("user_id", context.userId)
        .gte("score_date", baselineFrom)
        .lte("score_date", date)
        .order("score_date", { ascending: false }),
    ]);
    const p = profileRes.data ?? {} as any;
    let weight: number | null = p.measurement_weight_kg != null ? Number(p.measurement_weight_kg) : null;
    // Derive from DEXA: total weight = lean_mass / (1 - bodyfat/100)
    if ((!weight || weight <= 0) && p.dexa_lean_mass_kg != null && p.dexa_body_fat_pct != null) {
      const lean = Number(p.dexa_lean_mass_kg);
      const bf = Number(p.dexa_body_fat_pct);
      if (lean > 0 && bf >= 0 && bf < 95) {
        weight = Math.round((lean / (1 - bf / 100)) * 10) / 10;
      }
    }
    const path: "device" | "manual" = p.input_path_preference === "device" ? "device" : "manual";
    const hadTraining = !!trainingRes.data;
    const target = weight && weight > 0
      ? Math.round(weight * (hadTraining ? 40 : 30))
      : null;

    const scoreRows = (scoresRes.data ?? []) as Array<{ score_date: string; pillar_breakdown: any }>;
    const recoveryOf = (iso: string): number | null => {
      const row = scoreRows.find((r) => r.score_date === iso);
      const v = row?.pillar_breakdown?.recovery;
      return typeof v === "number" ? v : null;
    };
    const recovery_today = recoveryOf(date);
    const recovery_yesterday = recoveryOf(yesterday);
    const priors = scoreRows
      .filter((r) => r.score_date !== date)
      .map((r) => r.pillar_breakdown?.recovery)
      .filter((v): v is number => typeof v === "number");
    const recovery_baseline = priors.length ? priors.reduce((a, b) => a + b, 0) / priors.length : null;

    return {
      consumed_ml: Number(manualRes.data?.hydration_ml ?? 0),
      target_ml: target,
      had_training_today: hadTraining,
      weight_kg: weight,
      path,
      recovery_today,
      recovery_yesterday,
      recovery_baseline,
    };
  });

/** Inline weight setter used by the hydration card when no weight is on file.
 *  Persists to profiles.measurement_weight_kg regardless of body_data_type. */
export const setBodyweightKg = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ weight_kg: z.number().min(25).max(400) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .upsert(
        { user_id: context.userId, measurement_weight_kg: data.weight_kg },
        { onConflict: "user_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type HydrationEvent = { id: string; amount_ml: number; created_at: string };
export const getTodayHydrationEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<HydrationEvent[]> => {
    const { data, error } = await context.supabase
      .from("hydration_events")
      .select("id, amount_ml, created_at")
      .eq("user_id", context.userId)
      .eq("entry_date", today())
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as HydrationEvent[];
  });


export const upsertDeviceRecovery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      device_source: z.enum(["whoop", "oura", "garmin"]),
      screenshot_url: z.string().min(1),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const entry_date = today();
    const { data: row, error } = await context.supabase
      .from("shield_device_uploads")
      .upsert(
        {
          user_id: context.userId,
          entry_date,
          device_source: data.device_source,
          screenshot_url: data.screenshot_url,
          parse_status: "pending",
          // Wipe stale parsed values from a prior attempt for the same day
          // (re-upload replacing a failed/partial parse).
          parsed_hrv: null,
          parsed_rhr: null,
          parsed_sleep_hours: null,
          parsed_date: null,
        },
        { onConflict: "user_id,entry_date" },
      )
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    // Dispatch of parse-device-upload is handled by the
    // `shield_device_uploads_parse_dispatch` DB trigger on insert/update.
    // On success the parser flips parse_status='parsed', which triggers
    // calculate-score via the existing shield_device_uploads_webhook.
    // We deliberately do NOT fire-and-forget from here: the Cloudflare
    // Worker terminates the request context on response and cancels
    // un-awaited fetches.
    return { ok: true, upload_id: row?.id };
  });

/** Poll the most recent device upload row for today so the UI can branch
 *  into the right post-parse Journey (A clean / B partial / C failure). */
export type DeviceUploadStatus = {
  id: string;
  parse_status: "pending" | "parsed" | "failed" | string;
  parsed_hrv: number | null;
  parsed_rhr: number | null;
  parsed_sleep_hours: number | null;
  parsed_date: string | null;
  entry_date: string;
  device_source: string | null;
} | null;

export const getTodayDeviceUploadStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DeviceUploadStatus> => {
    const { data, error } = await context.supabase
      .from("shield_device_uploads")
      .select("id, parse_status, parsed_hrv, parsed_rhr, parsed_sleep_hours, parsed_date, entry_date, device_source")
      .eq("user_id", context.userId)
      .eq("entry_date", today())
      .maybeSingle();
    if (error) return null;
    return (data as DeviceUploadStatus) ?? null;
  });

/** Journey B helper: user supplies the RHR the screenshot didn't show.
 *  Writes onto the existing upload row (NOT a separate manual entry) so
 *  the device-path Recovery formula picks it up via the same precedence. */
export const supplementDeviceRhr = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ rhr_bpm: z.number().min(25).max(140) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("shield_device_uploads")
      .update({ parsed_rhr: data.rhr_bpm })
      .eq("user_id", context.userId)
      .eq("entry_date", today());
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Confirmation step: if the screenshot's detected date doesn't match the
 *  upload day (e.g. uploaded at 1am, or reviewing yesterday), reassign the
 *  upload to the correct entry_date. Lightweight — only used when the user
 *  explicitly corrects the detected date. */
export const reassignDeviceUploadDate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      upload_id: z.string().uuid(),
      new_entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("shield_device_uploads")
      .update({ entry_date: data.new_entry_date })
      .eq("id", data.upload_id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const logMeal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      meal_description: z.string().nullable().optional(),
      meal_photo_url: z.string().nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("shield_nutrition_logs")
      .insert({
        user_id: context.userId,
        entry_date: today(),
        meal_description: data.meal_description ?? null,
        meal_photo_url: data.meal_photo_url ?? null,
        claude_score_status: "pending",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export type MealItem = {
  name: string;
  grams: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

export type CalorieEstimateStatus = "pending" | "estimated" | "failed" | "manual_edited";

export type TodayMeal = {
  id: string;
  meal_description: string | null;
  meal_photo_url: string | null;
  claude_score_status: string;
  claude_quality_score: number | null;
  estimated_calories: number | null;
  estimated_protein_g: number | null;
  estimated_carbs_g: number | null;
  estimated_fat_g: number | null;
  estimated_items: MealItem[] | null;
  calorie_estimate_status: CalorieEstimateStatus | null;
  user_corrected: boolean;
  created_at: string;
};

export const getTodayMeals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TodayMeal[]> => {
    const { data, error } = await context.supabase
      .from("shield_nutrition_logs")
      .select("id, meal_description, meal_photo_url, claude_score_status, claude_quality_score, estimated_calories, estimated_protein_g, estimated_carbs_g, estimated_fat_g, estimated_items, calorie_estimate_status, user_corrected, created_at, deleted, entry_date")
      .eq("user_id", context.userId)
      .eq("entry_date", today())
      .eq("deleted", false)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => ({
      id: r.id,
      meal_description: r.meal_description,
      meal_photo_url: r.meal_photo_url,
      claude_score_status: r.claude_score_status,
      claude_quality_score: r.claude_quality_score,
      estimated_calories: r.estimated_calories,
      estimated_protein_g: r.estimated_protein_g,
      estimated_carbs_g: r.estimated_carbs_g,
      estimated_fat_g: r.estimated_fat_g,
      estimated_items: Array.isArray(r.estimated_items) ? r.estimated_items : null,
      calorie_estimate_status: r.calorie_estimate_status ?? null,
      user_corrected: !!r.user_corrected,
      created_at: r.created_at,
    }));
  });


export const updateMeal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      meal_description: z.string().nullable().optional(),
      meal_photo_url: z.string().nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("shield_nutrition_logs")
      .update({
        meal_description: data.meal_description ?? null,
        meal_photo_url: data.meal_photo_url ?? null,
        protein_tier: null,
        carb_quality_score: null,
        timing_score: null,
        claude_score_status: "pending",
        estimated_calories: null,
        estimated_protein_g: null,
        estimated_carbs_g: null,
        estimated_fat_g: null,
        estimated_items: null,
        calorie_estimate_status: "pending",
      })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { id: data.id };
  });

const MealItemSchema = z.object({
  name: z.string(),
  grams: z.number().min(0),
  calories: z.number().min(0),
  protein_g: z.number().min(0),
  carbs_g: z.number().min(0),
  fat_g: z.number().min(0),
});

/** Edit itemized components (e.g. user adjusts grams). Does NOT re-run scoring.
 *  - Marks the row as manual_edited and increments correction_count.
 *  - On first edit, snapshots the AI baseline into original_estimated_* so the
 *    pre-correction estimate is never lost. */
export const updateMealItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), items: z.array(MealItemSchema) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const sum = (k: "calories"|"protein_g"|"carbs_g"|"fat_g") =>
      Math.round(data.items.reduce((a, b) => a + (b[k] || 0), 0));

    const { data: current, error: fetchErr } = await context.supabase
      .from("shield_nutrition_logs")
      .select("estimated_items, estimated_calories, estimated_protein_g, estimated_carbs_g, estimated_fat_g, original_estimated_items, original_estimated_calories, original_estimated_protein_g, original_estimated_carbs_g, original_estimated_fat_g, correction_count")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .single();
    if (fetchErr) throw new Error(fetchErr.message);

    const patch: Record<string, unknown> = {
      estimated_items: data.items,
      estimated_calories: sum("calories"),
      estimated_protein_g: sum("protein_g"),
      estimated_carbs_g: sum("carbs_g"),
      estimated_fat_g: sum("fat_g"),
      calorie_estimate_status: "manual_edited",
      user_corrected: true,
      correction_count: (Number(current?.correction_count ?? 0) + 1),
    };
    // First edit: snapshot the original AI estimate (only if not already set).
    if (current?.original_estimated_items == null) {
      patch.original_estimated_items = current?.estimated_items ?? null;
      patch.original_estimated_calories = current?.estimated_calories ?? null;
      patch.original_estimated_protein_g = current?.estimated_protein_g ?? null;
      patch.original_estimated_carbs_g = current?.estimated_carbs_g ?? null;
      patch.original_estimated_fat_g = current?.estimated_fat_g ?? null;
    }

    const { error } = await context.supabase
      .from("shield_nutrition_logs")
      .update(patch as any)
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const softDeleteMeal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("shield_nutrition_logs")
      .update({ deleted: true })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Body measurement events ----------

export type BodyMeasurement = {
  id: string;
  entry_date: string;
  source: string;
  weight_kg: number | null;
  body_fat_pct: number | null;
  lean_mass_kg: number | null;
  waist_cm: number | null;
  hip_cm: number | null;
  arm_cm: number | null;
  thigh_cm: number | null;
  created_at: string;
};

export const logBodyMeasurement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      source: z.enum(["manual", "dexa", "inbody"]).default("manual"),
      weight_kg: z.number().positive().nullable().optional(),
      body_fat_pct: z.number().min(0).max(100).nullable().optional(),
      lean_mass_kg: z.number().positive().nullable().optional(),
      waist_cm: z.number().positive().nullable().optional(),
      hip_cm: z.number().positive().nullable().optional(),
      arm_cm: z.number().positive().nullable().optional(),
      thigh_cm: z.number().positive().nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("body_measurement_events").insert({
      user_id: context.userId,
      source: data.source ?? "manual",
      weight_kg: data.weight_kg ?? null,
      body_fat_pct: data.body_fat_pct ?? null,
      lean_mass_kg: data.lean_mass_kg ?? null,
      waist_cm: data.waist_cm ?? null,
      hip_cm: data.hip_cm ?? null,
      arm_cm: data.arm_cm ?? null,
      thigh_cm: data.thigh_cm ?? null,
    });
    if (error) throw new Error(error.message);
    // Mirror latest weight/body-fat to profile so other surfaces see the freshest value.
    const profileUpdate: Record<string, unknown> = {};
    if (data.weight_kg != null) profileUpdate.weight_kg = data.weight_kg;
    if (data.body_fat_pct != null) profileUpdate.body_fat_pct = data.body_fat_pct;
    if (Object.keys(profileUpdate).length) {
      await context.supabase.from("profiles")
        .upsert({ user_id: context.userId, ...profileUpdate }, { onConflict: "user_id" });
    }
    return { ok: true };
  });

export const getLatestBodyMeasurement = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BodyMeasurement | null> => {
    const { data } = await context.supabase
      .from("body_measurement_events")
      .select("id, entry_date, source, weight_kg, body_fat_pct, lean_mass_kg, waist_cm, hip_cm, arm_cm, thigh_cm, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data as BodyMeasurement) ?? null;
  });

export const upsertTraining = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      strain_value: z.number().nullable().optional(),
      session_notes: z.string().nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("shield_training_logs")
      .upsert(
        {
          user_id: context.userId,
          entry_date: today(),
          strain_value: data.strain_value ?? null,
          session_notes: data.session_notes ?? null,
        },
        { onConflict: "user_id,entry_date" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type PillarBreakdown = {
  recovery?: number | string;
  sleep?: number | string;
  nutrition?: number | string;
  training?: number | string;
  mood?: number | string;
};

export type TodayReadiness = {
  score_date: string;
  final_score: number;
  confidence_level: "HIGH" | "MEDIUM" | "LOW" | null;
  pillar_breakdown: PillarBreakdown | null;
  nudge_message: string | null;
  pre_session_adjustment?: number | null;
} | null;

export const getTodayReadiness = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TodayReadiness> => {
    const { data, error } = await context.supabase
      .from("readiness_scores")
      .select("score_date, final_score, confidence_level, pillar_breakdown, nudge_message, pre_session_adjustment")
      .eq("user_id", context.userId)
      .order("score_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return null;
    if (!data) return null;
    return data as TodayReadiness;
  });

// ---------- Activity / streak ----------
//
// "Activity" for a given date = at least one row exists for that date in ANY
// of: shield_nutrition_logs, shield_training_logs, shield_manual_inputs,
// workout_set_logs.
// Returns: current consecutive streak ending today (0 if today not logged),
// and last 7 days (oldest→today) booleans.

export type ActivityWeek = {
  streak: number;
  last7: boolean[]; // length 7, index 0 = 6 days ago, index 6 = today
};

export const getActivityWeek = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ActivityWeek> => {
    const supa = context.supabase;
    const uid = context.userId;
    // Pull last 60 days of activity dates from all 4 sources.
    const since = new Date();
    since.setDate(since.getDate() - 60);
    const sinceISO = since.toISOString().slice(0, 10);

    const sources: Array<Promise<{ data: { entry_date: string }[] | null }>> = [
      supa.from("shield_nutrition_logs").select("entry_date").eq("user_id", uid).gte("entry_date", sinceISO) as any,
      supa.from("shield_training_logs").select("entry_date").eq("user_id", uid).gte("entry_date", sinceISO) as any,
      supa.from("shield_manual_inputs").select("entry_date").eq("user_id", uid).gte("entry_date", sinceISO) as any,
      supa.from("workout_set_logs").select("entry_date").eq("user_id", uid).gte("entry_date", sinceISO) as any,
    ];
    const results = await Promise.all(sources);
    const days = new Set<string>();
    for (const r of results) for (const row of r.data ?? []) if (row?.entry_date) days.add(row.entry_date);

    const todayISO = new Date().toISOString().slice(0, 10);

    // Streak ending today (or yesterday — grace so users don't lose streak
    // before they've logged today's data).
    let streak = 0;
    const cursor = new Date();
    // If today not logged, start counting from yesterday.
    if (!days.has(todayISO)) cursor.setDate(cursor.getDate() - 1);
    while (true) {
      const iso = cursor.toISOString().slice(0, 10);
      if (days.has(iso)) { streak++; cursor.setDate(cursor.getDate() - 1); }
      else break;
    }

    // last 7 days oldest -> today
    const last7: boolean[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      last7.push(days.has(d.toISOString().slice(0, 10)));
    }

    return { streak, last7 };
  });

