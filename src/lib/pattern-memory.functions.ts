import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type RecoveryPattern = {
  pattern_type: string;
  pattern_key: string;
  description: string;
  explanation: string | null;
  protocol: string | null;
  data_points: number;
  correlation_coeff: number | null;
};

export const getRecoveryPatterns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RecoveryPattern[]> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("user_recovery_patterns")
      .select(
        "pattern_type, pattern_key, description, explanation, protocol, data_points, correlation_coeff",
      )
      .eq("user_id", userId)
      .gte("data_points", 4)
      .order("correlation_coeff", { ascending: false, nullsFirst: false })
      .limit(3);

    if (error) {
      console.error("getRecoveryPatterns error:", error);
      return [];
    }
    return (data ?? []) as RecoveryPattern[];
  });
