// Nutrition server-fn wrappers. Thin RPC adapters for client code.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type TriggerWeeklyMacroReviewResult =
  | {
      status: "computed";
      user_id: string;
      decision?: string;
      applied_target_id?: string | null;
    }
  | {
      status: "already_computed";
      review_id: string;
      decision?: string;
      applied_target_id?: string | null;
    }
  | { status: "not_monday" }
  | { status: "error"; error: string };

/**
 * Invoke the JWT-gated `trigger-weekly-macro-review` edge function as the
 * signed-in user. The middleware-bound `supabase` client carries the user's
 * bearer token, so `functions.invoke` forwards it automatically.
 */
export const triggerWeeklyMacroReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TriggerWeeklyMacroReviewResult> => {
    try {
      const { data, error } = await context.supabase.functions.invoke(
        "trigger-weekly-macro-review",
        { body: {} },
      );
      if (error) {
        return { status: "error", error: error.message ?? String(error) };
      }
      if (data && typeof data === "object" && "status" in data) {
        return data as TriggerWeeklyMacroReviewResult;
      }
      return { status: "error", error: "unexpected response shape" };
    } catch (e) {
      return {
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      };
    }
  });
