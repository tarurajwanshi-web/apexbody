import { auth, defineMcp } from "@lovable.dev/mcp-js";
import getRecentWorkouts from "./tools/get-recent-workouts";
import getReadiness from "./tools/get-readiness";
import getBodyMeasurements from "./tools/get-body-measurements";
import logBodyWeight from "./tools/log-body-weight";

// The OAuth issuer MUST be the direct Supabase host — the .lovable.cloud proxy
// fails mcp-js's RFC 8414 issuer check. VITE_SUPABASE_PROJECT_ID is inlined at
// build time; the fallback keeps the issuer well-formed if unset during the
// throwaway manifest-extract eval.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "apex-mcp",
  title: "APEX",
  version: "0.1.0",
  instructions:
    "Tools for APEX — a body-recomp coaching app. Read the signed-in user's recent workouts, readiness scores, and body measurements, and log new body weight entries. All calls run as the signed-in user under row-level security.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [getRecentWorkouts, getReadiness, getBodyMeasurements, logBodyWeight],
});
