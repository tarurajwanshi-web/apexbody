import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "get_recent_workouts",
  title: "Get recent workouts",
  description:
    "Return the signed-in user's recent completed workout sets (exercise, weight, reps, RIR, muscle group, date). Use this to reason about training volume, intensity, and progression.",
  inputSchema: {
    days: z
      .number()
      .int()
      .min(1)
      .max(90)
      .default(14)
      .describe("How many days back to fetch. Default 14."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .default(100)
      .describe("Max sets to return. Default 100."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ days, limit }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const supabase = supabaseForUser(ctx);
    const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from("workout_set_logs")
      .select(
        "entry_date, exercise_name, muscle_group, weight_kg, reps_completed, rir, completed",
      )
      .eq("user_id", ctx.getUserId())
      .eq("completed", true)
      .gte("entry_date", since)
      .order("entry_date", { ascending: false })
      .limit(limit);
    if (error)
      return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { sets: data ?? [] },
    };
  },
});
