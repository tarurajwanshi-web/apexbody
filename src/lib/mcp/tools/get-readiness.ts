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
  name: "get_readiness",
  title: "Get readiness scores",
  description:
    "Return the signed-in user's recent daily readiness scores. Use this to gauge current recovery state before recommending training load.",
  inputSchema: {
    days: z.number().int().min(1).max(60).default(7).describe("How many recent days. Default 7."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ days }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const supabase = supabaseForUser(ctx);
    const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from("readiness_scores")
      .select("score_date, final_score")
      .eq("user_id", ctx.getUserId())
      .gte("score_date", since)
      .order("score_date", { ascending: false });
    if (error)
      return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { readiness: data ?? [] },
    };
  },
});
