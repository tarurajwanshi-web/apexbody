// Browser-safe re-export of the canonical volume-landmarks module.
// Source of truth lives in supabase/functions/_shared/volume-landmarks.ts.
// This file exists so components can import from "@/lib/volume-landmarks"
// without pulling in the _shared/ Deno path convention. Numbers cannot drift
// because both sides import the same file.
export {
  VOLUME_LANDMARKS,
  EXPERIENCE_MULTIPLIER,
  GOAL_MAV_MULTIPLIER,
  effectiveLandmarks,
  MUSCLE_GROUP_DISPLAY_ORDER,
  MUSCLE_GROUP_ALIASES,
  MUSCLE_GROUP_LABELS,
  normaliseMuscleGroup,
  type Landmarks,
} from "../../supabase/functions/_shared/volume-landmarks";
