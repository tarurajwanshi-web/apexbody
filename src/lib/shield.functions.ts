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
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const payload = {
      user_id: context.userId,
      entry_date: today(),
      recovery_self_rating: data.recovery_self_rating,
      sleep_hours: data.sleep_hours,
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
        .select("input_path_preference, measurement_weight_kg")
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
    const weight = profileRes.data?.measurement_weight_kg != null
      ? Number(profileRes.data.measurement_weight_kg) : null;
    const path: "device" | "manual" = profileRes.data?.input_path_preference === "device" ? "device" : "manual";
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
        },
        { onConflict: "user_id,entry_date" },
      )
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    // Fire-and-forget vision parse. On success it flips parse_status='parsed',
    // which triggers calculate-score via the DB webhook.
    try {
      const fnUrl = `${process.env.SUPABASE_URL}/functions/v1/parse-device-upload`;
      void fetch(fnUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ upload_id: row?.id, user_id: context.userId, entry_date }),
      }).catch(() => {});
    } catch { /* ignore */ }

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

export type TodayMeal = {
  id: string;
  meal_description: string | null;
  meal_photo_url: string | null;
  claude_score_status: string;
  claude_quality_score: number | null;
  created_at: string;
};

export const getTodayMeals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TodayMeal[]> => {
    const { data, error } = await context.supabase
      .from("shield_nutrition_logs")
      .select("id, meal_description, meal_photo_url, claude_score_status, claude_quality_score, created_at, deleted, entry_date")
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
    // Reset the three dimension scores + status so score-nutrition reruns clean.
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
        calorie_estimate_status: "pending",
      })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { id: data.id };
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

