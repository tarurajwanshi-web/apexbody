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
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("shield_manual_inputs")
      .upsert(
        {
          user_id: context.userId,
          entry_date: today(),
          recovery_self_rating: data.recovery_self_rating,
          sleep_hours: data.sleep_hours,
        },
        { onConflict: "user_id,entry_date" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
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
    const { error } = await context.supabase
      .from("shield_device_uploads")
      .upsert(
        {
          user_id: context.userId,
          entry_date: today(),
          device_source: data.device_source,
          screenshot_url: data.screenshot_url,
          parse_status: "pending",
        },
        { onConflict: "user_id,entry_date" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const logMeal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      meal_description: z.string().min(1),
      meal_photo_url: z.string().nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("shield_nutrition_logs")
      .insert({
        user_id: context.userId,
        entry_date: today(),
        meal_description: data.meal_description,
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
      meal_description: z.string().min(1),
      meal_photo_url: z.string().nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    // Reset the three dimension scores + status so score-nutrition reruns clean.
    const { error } = await context.supabase
      .from("shield_nutrition_logs")
      .update({
        meal_description: data.meal_description,
        meal_photo_url: data.meal_photo_url ?? null,
        protein_tier: null,
        carb_quality_score: null,
        timing_score: null,
        claude_score_status: "pending",
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
} | null;

export const getTodayReadiness = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TodayReadiness> => {
    const { data, error } = await context.supabase
      .from("readiness_scores")
      .select("score_date, final_score, confidence_level, pillar_breakdown, nudge_message")
      .eq("user_id", context.userId)
      .order("score_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return null;
    if (!data) return null;
    return data as TodayReadiness;
  });
