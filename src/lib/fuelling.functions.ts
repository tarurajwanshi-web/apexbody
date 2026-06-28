import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type FuellingAdequacy = {
  evaluation_date: string;
  total_sets: number;
  avg_rir: number | null;
  calories_consumed: number;
  calories_target: number;
  shortfall: number;
  severity: "underfuelled" | "marginal" | "adequate";
  severity_score: number;
  message: string;
  action: string;
  mini_explanation: string | null;
};

export const getFuellingAdequacy = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FuellingAdequacy | null> => {
    const { supabase, userId } = context;
    const today = new Date().toISOString().slice(0, 10);
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from("user_fuelling_evaluations")
      .select(
        "evaluation_date,total_sets,avg_rir,calories_consumed,calories_target,shortfall,severity,severity_score,message,action,mini_explanation",
      )
      .eq("user_id", userId)
      .gte("severity_score", 2)
      .gte("evaluation_date", twoDaysAgo)
      .lte("evaluation_date", today)
      .order("evaluation_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error("getFuellingAdequacy error:", error);
      return null;
    }
    return (data ?? null) as FuellingAdequacy | null;
  });
