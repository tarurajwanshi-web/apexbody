// Nutrition client-side helpers.

import { supabase } from "@/integrations/supabase/client";

export async function triggerWeeklyMacroReview(): Promise<{
  status: "computed" | "already_computed" | "not_monday";
  review_id?: string;
  decision?: string;
  applied_target_id?: string;
  error?: string;
}> {
  try {
    // Get auth session
    const { data: session } = await supabase.auth.getSession();
    const token = session?.session?.access_token;

    if (!token) {
      throw new Error("Not authenticated");
    }

    // Get Supabase URL from environment
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    if (!supabaseUrl) {
      throw new Error("Supabase URL not configured");
    }

    // Call the edge function
    const response = await fetch(
      `${supabaseUrl}/functions/v1/trigger-weekly-macro-review`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      },
    );

    // Handle 204 No Content (not Monday in user's timezone)
    if (response.status === 204) {
      return { status: "not_monday" };
    }

    // Parse JSON response
    const data = await response.json();

    // Check for errors
    if (!response.ok) {
      console.error(
        "[triggerWeeklyMacroReview] HTTP error",
        response.status,
        data,
      );
      throw new Error(data.error || "Failed to trigger macro review");
    }

    return data;
  } catch (e) {
    console.error("[triggerWeeklyMacroReview] exception", e);
    throw e;
  }
}
