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
  name: "log_body_weight",
  title: "Log body weight",
  description:
    "Insert a body weight measurement for the signed-in user. Use for the current day unless the caller supplies a specific entry_date (YYYY-MM-DD).",
  inputSchema: {
    weight_kg: z.number().positive().max(500).describe("Body weight in kilograms."),
    entry_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Optional YYYY-MM-DD. Defaults to today (UTC)."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  handler: async ({ weight_kg, entry_date }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const supabase = supabaseForUser(ctx);
    const date = entry_date ?? new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from("body_measurement_events")
      .insert({ user_id: ctx.getUserId(), weight_kg, entry_date: date })
      .select()
      .single();
    if (error)
      return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: `Logged ${weight_kg} kg on ${date}.` }],
      structuredContent: { row: data },
    };
  },
});
