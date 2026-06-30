// Shared signal-quality helpers — used by parse-device-upload and
// calculate-score so screenshot validation and scoring validation stay
// identical. Pure functions, no I/O, no Deno deps.

export type Validity = "valid" | "suspicious" | "invalid" | "missing";
export type Freshness = "fresh" | "stale" | "missing" | "future_date" | "unknown";
export type Confidence = "HIGH" | "MEDIUM" | "LOW";

// Allowed reason codes (top-level set). Keep in sync with calculate-score
// and any UI consumers. New codes must be added here so callers can rely on
// string-literal stability.
export const REASON = {
  DEVICE_SIGNAL_STALE: "DEVICE_SIGNAL_STALE",
  DEVICE_PARTIAL_PARSE: "DEVICE_PARTIAL_PARSE",
  DEVICE_PROXY_SCORE_ONLY: "DEVICE_PROXY_SCORE_ONLY",
  MANUAL_FALLBACK_REQUIRED: "MANUAL_FALLBACK_REQUIRED",
  HRV_HIGH_CONFIDENCE: "HRV_HIGH_CONFIDENCE",
  HRV_MISSING: "HRV_MISSING",
  HRV_SUSPICIOUS_RANGE: "HRV_SUSPICIOUS_RANGE",
  HRV_INVALID_RANGE: "HRV_INVALID_RANGE",
  RHR_MISSING: "RHR_MISSING",
  RHR_SUSPICIOUS_RANGE: "RHR_SUSPICIOUS_RANGE",
  RHR_INVALID_RANGE: "RHR_INVALID_RANGE",
  SLEEP_MISSING: "SLEEP_MISSING",
  SLEEP_SUSPICIOUS_RANGE: "SLEEP_SUSPICIOUS_RANGE",
  SLEEP_INVALID_RANGE: "SLEEP_INVALID_RANGE",
  MANUAL_RECOVERY_DISCOUNTED: "MANUAL_RECOVERY_DISCOUNTED",
  LOW_SLEEP_CONFIDENCE: "LOW_SLEEP_CONFIDENCE",
  HIGH_LOAD_CARRYOVER: "HIGH_LOAD_CARRYOVER",
  TRAINING_LOAD_CARRYOVER: "TRAINING_LOAD_CARRYOVER",
  PRE_SESSION_LOW_READINESS: "PRE_SESSION_LOW_READINESS",
  HYDRATION_BELOW_TARGET: "HYDRATION_BELOW_TARGET",
  PROTEIN_LOW_FOR_GOAL: "PROTEIN_LOW_FOR_GOAL",
  DEFICIT_CAUTION_LOW_RECOVERY: "DEFICIT_CAUTION_LOW_RECOVERY",
  NUTRITION_NOT_LOGGED: "NUTRITION_NOT_LOGGED",
  USER_MANUAL_OVERRIDE_USED: "USER_MANUAL_OVERRIDE_USED",
} as const;
export type ReasonCode = typeof REASON[keyof typeof REASON];

export type Classification = {
  validity: Validity;
  value: number | null; // null if invalid/missing
  reason_codes: ReasonCode[];
};

export function classifyHrv(v: number | null | undefined): Classification {
  if (v == null || !Number.isFinite(Number(v))) {
    return { validity: "missing", value: null, reason_codes: [REASON.HRV_MISSING] };
  }
  const n = Number(v);
  if (n < 10 || n > 250) {
    return { validity: "invalid", value: null, reason_codes: [REASON.HRV_INVALID_RANGE] };
  }
  if (n < 20 || n > 150) {
    return { validity: "suspicious", value: n, reason_codes: [REASON.HRV_SUSPICIOUS_RANGE] };
  }
  return { validity: "valid", value: n, reason_codes: [] };
}

export function classifyRhr(v: number | null | undefined): Classification {
  if (v == null || !Number.isFinite(Number(v))) {
    return { validity: "missing", value: null, reason_codes: [REASON.RHR_MISSING] };
  }
  const n = Number(v);
  if (n < 30 || n > 120) {
    return { validity: "invalid", value: null, reason_codes: [REASON.RHR_INVALID_RANGE] };
  }
  if (n < 40 || n > 90) {
    return { validity: "suspicious", value: n, reason_codes: [REASON.RHR_SUSPICIOUS_RANGE] };
  }
  return { validity: "valid", value: n, reason_codes: [] };
}

export function classifySleep(v: number | null | undefined): Classification {
  if (v == null || !Number.isFinite(Number(v))) {
    return { validity: "missing", value: null, reason_codes: [REASON.SLEEP_MISSING] };
  }
  const n = Number(v);
  if (n < 0 || n > 14) {
    return { validity: "invalid", value: null, reason_codes: [REASON.SLEEP_INVALID_RANGE] };
  }
  if (n < 3 || n > 11) {
    return { validity: "suspicious", value: n, reason_codes: [REASON.SLEEP_SUSPICIOUS_RANGE] };
  }
  return { validity: "valid", value: n, reason_codes: [] };
}

// parsed_date vs entry_date freshness.
// future = parsed_date strictly after entry_date.
// stale  = parsed_date more than 2 days older than entry_date.
// fresh  = within ±2 days.
// missing= parsed_date null/empty.
export function classifyFreshness(
  parsed_date: string | null | undefined,
  entry_date: string,
): Freshness {
  if (!parsed_date) return "missing";
  const p = Date.parse(parsed_date + "T00:00:00Z");
  const e = Date.parse(entry_date + "T00:00:00Z");
  if (!Number.isFinite(p) || !Number.isFinite(e)) return "unknown";
  const diffDays = Math.round((e - p) / 86400000);
  if (diffDays < 0) return "future_date";
  if (diffDays > 2) return "stale";
  return "fresh";
}

// Confidence rule for a device-signal SET (the whole upload, or a per-metric
// row). "No HRV → never HIGH" and "proxy-only → MEDIUM at best".
export function confidenceFromDeviceSet(args: {
  hrvOk: boolean; // valid or suspicious
  rhrOk: boolean;
  sleepOk: boolean;
  freshness: Freshness;
  providerProxyOnly: boolean; // only recovery_score/body_battery visible
}): Confidence {
  if (args.freshness === "future_date") return "LOW";
  if (args.providerProxyOnly) {
    return args.freshness === "stale" ? "LOW" : "MEDIUM";
  }
  if (!args.hrvOk) {
    // no HRV → never HIGH
    if (args.sleepOk || args.rhrOk) return "MEDIUM";
    return "LOW";
  }
  // HRV present
  if (args.freshness === "stale") return "MEDIUM";
  if (args.hrvOk && args.sleepOk) return "HIGH";
  if (args.hrvOk && args.rhrOk) return "HIGH";
  return "MEDIUM";
}

// Confidence for a single metric given its own validity + freshness.
export function confidenceForMetric(
  validity: Validity,
  freshness: Freshness,
): Confidence {
  if (validity === "invalid" || validity === "missing") return "LOW";
  if (freshness === "future_date") return "LOW";
  if (validity === "suspicious") return "MEDIUM";
  if (freshness === "stale") return "MEDIUM";
  return "HIGH";
}

export function dedupe<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}
