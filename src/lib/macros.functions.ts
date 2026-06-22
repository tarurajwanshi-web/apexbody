import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export type MacroSummary = {
  consumed_calories: number;
  consumed_protein_g: number;
  consumed_carbs_g: number;
  consumed_fat_g: number;
  meals_estimated: number;
  target_calories: number | null;
  target_protein_g: number | null;
  target_carbs_g: number | null;
  target_fat_g: number | null;
  goal: string | null;
};

export const getTodayMacroSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MacroSummary> => {
    const { data: meals } = await context.supabase
      .from("shield_nutrition_logs")
      .select("estimated_calories, estimated_protein_g, estimated_carbs_g, estimated_fat_g, calorie_estimate_status, deleted, entry_date")
      .eq("user_id", context.userId)
      .eq("entry_date", today())
      .eq("deleted", false)
      .in("calorie_estimate_status", ["estimated", "manual_edited"]);

    const sum = (key: string) =>
      (meals ?? []).reduce((s: number, m: any) => s + Number(m[key] ?? 0), 0);

    // Audit #6: select the ACTIVE effective-dated target — the row whose
    // [effective_start_date, effective_end_date) window contains today.
    // The prior `order by calculated_at` approach surfaced future-dated rows
    // (e.g. a Monday weekly-review insert that activates next Monday but is
    // calculated today) immediately, instead of waiting for them to take effect.
    const todayStr = today();
    const { data: target } = await context.supabase
      .from("daily_macro_targets")
      .select("target_calories, target_protein_g, target_carbs_g, target_fat_g, effective_start_date, effective_end_date")
      .eq("user_id", context.userId)
      .lte("effective_start_date", todayStr)
      .or(`effective_end_date.is.null,effective_end_date.gt.${todayStr}`)
      .order("effective_start_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: profile } = await context.supabase
      .from("profiles")
      .select("goal")
      .eq("user_id", context.userId)
      .maybeSingle();

    return {
      consumed_calories: Math.round(sum("estimated_calories")),
      consumed_protein_g: Math.round(sum("estimated_protein_g")),
      consumed_carbs_g: Math.round(sum("estimated_carbs_g")),
      consumed_fat_g: Math.round(sum("estimated_fat_g")),
      meals_estimated: meals?.length ?? 0,
      target_calories: target?.target_calories != null ? Number(target.target_calories) : null,
      target_protein_g: target?.target_protein_g != null ? Number(target.target_protein_g) : null,
      target_carbs_g: target?.target_carbs_g != null ? Number(target.target_carbs_g) : null,
      target_fat_g: target?.target_fat_g != null ? Number(target.target_fat_g) : null,
      goal: (profile?.goal as string | null) ?? null,
    };
  });
