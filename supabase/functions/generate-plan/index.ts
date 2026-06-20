// generate-plan — STUB
// Accepts { user_id } and returns a placeholder success response.
// Real Claude plan-generation logic will be implemented in the next step.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let body: { user_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    // ignore – treat as empty
  }

  if (!body.user_id) {
    return new Response(
      JSON.stringify({ ok: false, error: "user_id required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({
      ok: true,
      stub: true,
      user_id: body.user_id,
      message: "generate-plan stub — real plan generation will run here.",
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
