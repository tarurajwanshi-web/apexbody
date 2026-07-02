// APEX training-rules: deterministic envelope + plan validator + safe fallback.
// Pure module — no I/O, no Deno APIs. Consumed by generate-plan.

export type Goal =
  | "fat_loss"
  | "muscle_gain"
  | "strength"
  | "recomposition"
  | "athletic_performance";

export type Experience = "beginner" | "intermediate" | "advanced";

export type Equipment =
  | "commercial_gym"
  | "home_gym_db_only"
  | "bodyweight_only"
  | "limited_equipment";

export type Permission =
  | "green_train"
  | "yellow_modify"
  | "orange_reduce"
  | "red_recover"
  | null;

export type Confidence = "LOW" | "MEDIUM" | "HIGH" | null;

export type SessionType = "train" | "modify" | "reduce" | "recovery";
export type ProgressionModel =
  | "linear"
  | "double_progression"
  | "autoregulated"
  | "hold";

// -------- closed enums (plan_data v2) --------
export const MUSCLE_GROUPS = [
  "chest","back","shoulders","quads","hamstrings","glutes",
  "calves","biceps","triceps","forearms","core","full_body",
  "cardio","mobility",
] as const;
export type MuscleGroup = typeof MUSCLE_GROUPS[number];

export const MOVEMENT_PATTERNS = [
  "squat","hinge","horizontal_push","vertical_push",
  "horizontal_pull","vertical_pull","lunge","carry",
  "rotation","anti_rotation","locomotion","conditioning","mobility",
] as const;
export type MovementPattern = typeof MOVEMENT_PATTERNS[number];

export const EXERCISE_ROLES = [
  "primary","secondary","accessory","isolation",
  "core","conditioning","mobility","power",
] as const;
export type ExerciseRole = typeof EXERCISE_ROLES[number];

const MUSCLE_GROUP_SET = new Set<string>(MUSCLE_GROUPS);
const MOVEMENT_PATTERN_SET = new Set<string>(MOVEMENT_PATTERNS);
const EXERCISE_ROLE_SET = new Set<string>(EXERCISE_ROLES);

export const PLAN_DATA_VERSION = 2 as const;

// Markdown guard for plain-prose text fields.
const MARKDOWN_RX = /(\*\*|__|`|^\s*[-*]\s|^\s*#{1,6}\s)/m;

export interface EnvelopeInput {
  goal: Goal;
  experience: Experience;
  equipment: Equipment;
  trainingDaysPerWeek: number;
  permission: Permission;
  confidence: Confidence;
  nutritionModifier: string | null;
  fuellingCaution: boolean;
  systemicLoad: number;
  weeklyReduce: boolean;
  redDays7: number;
  orangeDays7: number;
}

export type EquipmentPool =
  | "barbell+db+machine+cable"
  | "db+bench+bands"
  | "bodyweight_only";

export interface Envelope {
  sessionType: SessionType;
  targetRir: [number, number];
  setsPerExercise: [number, number];
  exercisesPerSession: [number, number];
  restSeconds: [number, number];
  repRange: [number, number];
  progressionModel: ProgressionModel;
  allowedPatterns: string[];
  allowedTechniques: string[];
  equipmentPool: EquipmentPool;
  weeklyVolumeCutPct: number;
  highLoadCarryover: boolean;
  fuellingCaution: boolean;
  guardrails: string[];
  input: EnvelopeInput;
}

// -------- helpers --------
function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

// -------- envelope --------
export function resolveTrainingEnvelope(input: EnvelopeInput): Envelope {
  const {
    goal,
    experience,
    equipment,
    permission,
    confidence,
    nutritionModifier,
    fuellingCaution,
    systemicLoad,
    weeklyReduce,
  } = input;

  // Session type
  let sessionType: SessionType = "train";
  if (permission === "red_recover") sessionType = "recovery";
  else if (permission === "orange_reduce") sessionType = "reduce";
  else if (permission === "yellow_modify") sessionType = "modify";

  // Baseline RIR by goal
  let rir: [number, number] =
    goal === "athletic_performance" ? [2, 4] : [1, 3];
  if (sessionType === "recovery") rir = [4, 5];
  else if (sessionType === "reduce") rir = [2, 4];
  else if (sessionType === "modify") rir = [2, 3];
  if (experience === "beginner") rir = [Math.max(2, rir[0]), rir[1]];
  if (confidence === "LOW") rir = [Math.max(2, rir[0]), rir[1] + 1];
  if (systemicLoad >= 25) rir = [Math.max(3, rir[0]), Math.max(rir[1], 4)];
  if (fuellingCaution) rir = [Math.max(2, rir[0]), rir[1]];

  // Rep range by goal
  let reps: [number, number] =
    goal === "strength" ? [3, 6]
    : goal === "fat_loss" ? [8, 15]
    : goal === "athletic_performance" ? [3, 10]
    : [6, 12]; // muscle_gain, recomposition
  if (sessionType === "recovery") reps = [8, 15];

  // Rest by goal
  let rest: [number, number] =
    goal === "strength" ? [150, 240]
    : goal === "fat_loss" ? [45, 90]
    : goal === "athletic_performance" ? [120, 180]
    : [60, 120];
  if (sessionType === "recovery") rest = [30, 60];

  // Sets/exercises baseline
  let sets: [number, number] =
    experience === "beginner" ? [2, 3]
    : experience === "advanced" ? [3, 5]
    : [3, 4];
  let exercises: [number, number] =
    experience === "beginner" ? [3, 5] : [4, 6];
  if (sessionType === "reduce") sets = [Math.max(1, sets[0] - 1), Math.max(2, sets[1] - 1)];
  if (sessionType === "recovery") { sets = [1, 2]; exercises = [3, 5]; }

  // Progression model
  let progression: ProgressionModel =
    experience === "beginner" ? "linear"
    : experience === "advanced" ? "autoregulated"
    : "double_progression";
  if (sessionType === "recovery" || sessionType === "reduce") progression = "hold";
  if (confidence === "LOW") progression = "hold";
  if (systemicLoad >= 25) progression = "hold";

  // Allowed patterns
  const basePatterns = [
    "squat", "hinge", "horizontal_push", "horizontal_pull",
    "vertical_push", "vertical_pull", "lunge", "core",
  ];
  let patterns = [...basePatterns];
  if (goal === "muscle_gain" || goal === "recomposition") patterns.push("isolation");
  if (goal === "fat_loss") patterns.push("isolation", "conditioning");
  if (goal === "athletic_performance") patterns.push("power", "conditioning");
  if (goal === "strength") patterns = ["squat","hinge","horizontal_push","horizontal_pull","vertical_push","vertical_pull","core"];
  if (sessionType === "reduce") patterns = patterns.filter(p => p !== "conditioning" && p !== "power");
  if (sessionType === "recovery") patterns = ["mobility", "technique", "core", "conditioning_light"];

  // Techniques
  const techniques: string[] = ["straight_sets"];
  if (experience !== "beginner" && sessionType === "train" && !fuellingCaution) {
    techniques.push("antagonistic_superset");
  }
  if (experience === "advanced" && sessionType === "train" && confidence !== "LOW" && !fuellingCaution && systemicLoad < 25) {
    techniques.push("drop_set", "rest_pause");
  }

  // Equipment pool
  const equipmentPool: EquipmentPool =
    equipment === "bodyweight_only" ? "bodyweight_only"
    : equipment === "commercial_gym" ? "barbell+db+machine+cable"
    : "db+bench+bands"; // home_gym_db_only, limited_equipment

  const weeklyVolumeCutPct = weeklyReduce ? 20 : 0;

  // Guardrails (prompt-friendly)
  const guardrails: string[] = [
    `session_type=${sessionType}`,
    `goal=${goal}, experience=${experience}, equipment=${equipment}`,
    `target RIR ${rir[0]}-${rir[1]} (encode in progression_note; also emit optional target_rir per exercise)`,
    `sets per exercise ${sets[0]}-${sets[1]}, exercises per session ${exercises[0]}-${exercises[1]}`,
    `rep range ${reps[0]}-${reps[1]}, rest_seconds ${rest[0]}-${rest[1]}`,
    `progression model = ${progression}`,
    `allowed movement patterns: ${patterns.join(", ")}`,
    `allowed techniques: ${techniques.join(", ")} (never mention any other technique)`,
    `equipment pool = ${equipmentPool}`,
  ];
  if (equipmentPool === "bodyweight_only") {
    guardrails.push(
      "HARD EQUIPMENT RULE: bodyweight only. Do NOT prescribe barbell, dumbbell, kettlebell, cable, machine, sled, treadmill-only, or any loaded implement. Use bodyweight, bands, or resistance-band assisted movements only."
    );
  } else if (equipmentPool === "db+bench+bands") {
    guardrails.push(
      "HARD EQUIPMENT RULE: dumbbells + bench + bands only. Do NOT prescribe barbell, cable, machine, sled, or leg-press-style exercises."
    );
  } else {
    guardrails.push(
      "Equipment: full commercial gym (barbell, dumbbell, cable, machine, sled, cardio equipment all allowed)."
    );
  }
  if (experience === "beginner") {
    guardrails.push(
      "BEGINNER SAFETY: no Olympic lifts (snatch, clean & jerk), no deficit deadlift, jefferson, zercher, muscle-up. No drop sets, rest-pause, or giant sets. Linear progression only."
    );
  }
  if (sessionType === "recovery") {
    guardrails.push(
      "ACUTE RECOVERY: first upcoming non-rest day must be mobility / technique / light conditioning only — no heavy compounds. sets<=2. progression_note must contain 'recovery' or 'light' or 'technique' or 'mobility'."
    );
  } else if (sessionType === "reduce") {
    guardrails.push(
      "ACUTE REDUCE: first upcoming non-rest day drops 1 set on all exercises and holds load (progression_note must contain 'hold' or 'RIR')."
    );
  } else if (sessionType === "modify") {
    guardrails.push(
      "ACUTE MODIFY: first upcoming non-rest day keeps volume, no forced progression. progression_note on that day must mention 'warm-up' or 'readiness'."
    );
  }
  if (fuellingCaution) {
    guardrails.push(
      `FUELLING CAUTION (${nutritionModifier ?? "under-fuelled"}): do not train to failure, no drop set / rest-pause, no metabolic finishers. progression_note should mention 'stop short of failure' or 'RIR 2+'.`
    );
  }
  if (systemicLoad >= 25) {
    guardrails.push(
      `HIGH LOAD CARRYOVER (systemic_load=${systemicLoad}): force hold on first non-rest day, RIR>=3.`
    );
  }
  if (weeklyVolumeCutPct > 0) {
    guardrails.push(
      `WEEKLY VOLUME CUT: reduce total weekly sets by ~${weeklyVolumeCutPct}% (drop 1 set/exercise across the week).`
    );
  }

  return {
    sessionType,
    targetRir: rir,
    setsPerExercise: sets,
    exercisesPerSession: exercises,
    restSeconds: rest,
    repRange: reps,
    progressionModel: progression,
    allowedPatterns: patterns,
    allowedTechniques: techniques,
    equipmentPool,
    weeklyVolumeCutPct,
    highLoadCarryover: systemicLoad >= 25,
    fuellingCaution,
    guardrails,
    input: input,
  };
}

// -------- validator --------
const DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

const EQUIPMENT_BLOCKLIST: Record<EquipmentPool, RegExp[]> = {
  "bodyweight_only": [
    /barbell/i, /dumbbell/i, /kettlebell/i, /cable/i, /machine/i, /sled/i,
    /leg press/i, /smith/i, /lat pulldown/i, /pec deck/i, /treadmill/i, /rower/i, /assault bike/i,
  ],
  "db+bench+bands": [
    /barbell/i, /cable/i, /machine/i, /sled/i, /leg press/i, /smith/i,
    /lat pulldown/i, /pec deck/i,
  ],
  "barbell+db+machine+cable": [],
};

const BEGINNER_EXERCISE_DENY = [
  /snatch/i, /clean\s*&\s*jerk/i, /clean and jerk/i, /power clean/i,
  /deficit deadlift/i, /jefferson/i, /zercher/i, /muscle-?up/i,
];

const DISALLOWED_TECHNIQUE_TOKENS = [
  /drop\s*set/i, /rest[-\s]?pause/i, /myo[-\s]?rep/i, /cluster set/i,
  /giant set/i, /superset/i,
];

const TECHNIQUE_TOKEN_MAP: Record<string, RegExp> = {
  drop_set: /drop\s*set/i,
  rest_pause: /rest[-\s]?pause/i,
  antagonistic_superset: /superset/i,
};

function isoAddDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function isoWeekdayName(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return DAY_NAMES[d.getUTCDay()];
}

function parseRepsWindow(reps: string): [number, number] | null {
  const s = String(reps ?? "").trim();
  const range = s.match(/^(\d+)\s*[-–]\s*(\d+)/);
  if (range) return [parseInt(range[1],10), parseInt(range[2],10)];
  const single = s.match(/^(\d+)/);
  if (single) { const n = parseInt(single[1],10); return [n, n]; }
  return null;
}

const ALLOWED_TOP = new Set([
  "days","volume_gate_alert","plan_start_date","plan_timezone",
  "plan_data_version","training_volume_summary","exercise_media_summary",
  "cue_version",
]);
const ALLOWED_DAY = new Set(["day","date","day_name","rest","session_name","session_purpose","exercises"]);
const ALLOWED_EX = new Set([
  "name","sets","reps","rest_seconds","cue","muscle_group",
  "progression_note","target_rir","exercise_role","movement_pattern",
]);

export interface ValidationResult {
  ok: boolean;
  violations: string[];
}

export function validateGeneratedPlan(plan: any, envelope: Envelope, planStartISO: string, restMask?: boolean[]): ValidationResult {
  const v: string[] = [];
  if (!plan || typeof plan !== "object") return { ok: false, violations: ["plan is not an object"] };

  for (const k of Object.keys(plan)) if (!ALLOWED_TOP.has(k)) v.push(`unknown top-level field: ${k}`);
  const days = plan.days;
  if (!Array.isArray(days) || days.length !== 7) {
    v.push(`days must be an array of length 7 (got ${Array.isArray(days) ? days.length : typeof days})`);
    return { ok: false, violations: v };
  }

  const useMask = Array.isArray(restMask)
    && restMask.length === 7
    && restMask.filter((r) => r === false).length > 0;

  // Locate first non-rest day for acute Shield checks.
  let firstNonRestIdx = -1;

  for (let i = 0; i < 7; i++) {
    const d = days[i];
    if (!d || typeof d !== "object") { v.push(`day[${i}] is not an object`); continue; }
    for (const k of Object.keys(d)) if (!ALLOWED_DAY.has(k)) v.push(`day[${i}] has unknown field: ${k}`);
    if (d.day !== i + 1) v.push(`day[${i}].day must be ${i+1} (got ${d.day})`);
    const expectedDate = isoAddDays(planStartISO, i);
    if (d.date !== expectedDate) v.push(`day[${i}].date must be ${expectedDate} (got ${d.date})`);
    const expectedName = isoWeekdayName(expectedDate);
    if (d.day_name !== expectedName) v.push(`day[${i}].day_name must be ${expectedName} (got ${d.day_name})`);
    if (typeof d.rest !== "boolean") v.push(`day[${i}].rest must be boolean`);
    if (useMask && typeof d.rest === "boolean" && d.rest !== restMask![i]) {
      v.push(`day[${i}].rest must be ${restMask![i]} per user's chosen training days`);
    }
    if (d.rest === true) {
      if (d.session_name !== null) v.push(`day[${i}] is rest — session_name must be null`);
      if (d.session_purpose !== undefined && d.session_purpose !== null) {
        v.push(`day[${i}] is rest — session_purpose must be null`);
      }
      if (!Array.isArray(d.exercises) || d.exercises.length !== 0) v.push(`day[${i}] is rest — exercises must be []`);
      continue;
    }
    // Training day
    if (firstNonRestIdx === -1) firstNonRestIdx = i;
    if (typeof d.session_name !== "string" || d.session_name.trim().length === 0) v.push(`day[${i}].session_name required for training day`);
    if (d.session_purpose !== undefined) {
      if (typeof d.session_purpose !== "string" || !d.session_purpose.trim()) {
        v.push(`day[${i}].session_purpose must be non-empty string on training day`);
      } else if (d.session_purpose.length > 240) {
        v.push(`day[${i}].session_purpose too long (max 240)`);
      } else if (MARKDOWN_RX.test(d.session_purpose)) {
        v.push(`day[${i}].session_purpose contains markdown syntax — plain prose only`);
      }
    }
    const exs = d.exercises;
    if (!Array.isArray(exs)) { v.push(`day[${i}].exercises must be array`); continue; }
    if (exs.length < envelope.exercisesPerSession[0] || exs.length > envelope.exercisesPerSession[1]) {
      v.push(`day[${i}] has ${exs.length} exercises; envelope requires ${envelope.exercisesPerSession[0]}-${envelope.exercisesPerSession[1]}`);
    }
    for (let j = 0; j < exs.length; j++) {
      const ex = exs[j];
      if (!ex || typeof ex !== "object") { v.push(`day[${i}].exercises[${j}] not an object`); continue; }
      for (const k of Object.keys(ex)) if (!ALLOWED_EX.has(k)) v.push(`day[${i}].exercises[${j}] unknown field: ${k}`);
      const name = String(ex.name ?? "");
      if (!name) v.push(`day[${i}].exercises[${j}].name required`);
      // Equipment
      for (const rx of EQUIPMENT_BLOCKLIST[envelope.equipmentPool]) {
        if (rx.test(name)) v.push(`day[${i}].exercises[${j}] "${name}" violates equipment=${envelope.equipmentPool}`);
      }
      // Beginner
      if (envelope.input.experience === "beginner") {
        for (const rx of BEGINNER_EXERCISE_DENY) if (rx.test(name)) v.push(`day[${i}].exercises[${j}] "${name}" not allowed for beginner`);
      }
      // Sets
      const sets = Number(ex.sets);
      if (!Number.isInteger(sets) || sets < envelope.setsPerExercise[0] || sets > envelope.setsPerExercise[1]) {
        v.push(`day[${i}].exercises[${j}].sets must be int in [${envelope.setsPerExercise[0]},${envelope.setsPerExercise[1]}] (got ${ex.sets})`);
      }
      // Reps
      const repsStr = String(ex.reps ?? "");
      if (!repsStr) v.push(`day[${i}].exercises[${j}].reps required`);
      const timeBased = /\d+\s*s\b/i.test(repsStr);
      if (!timeBased) {
        const w = parseRepsWindow(repsStr);
        if (!w) v.push(`day[${i}].exercises[${j}].reps unparseable: "${repsStr}"`);
        else {
          const [lo, hi] = w;
          if (envelope.sessionType !== "recovery") {
            if (lo < envelope.repRange[0] - 1 || hi > envelope.repRange[1] + 1) {
              v.push(`day[${i}].exercises[${j}].reps "${repsStr}" outside envelope ${envelope.repRange[0]}-${envelope.repRange[1]}`);
            }
          }
        }
      } else if (envelope.sessionType !== "recovery") {
        v.push(`day[${i}].exercises[${j}] time-based reps only allowed on recovery days`);
      }
      // Rest
      const rs = Number(ex.rest_seconds);
      if (!Number.isFinite(rs) || rs < envelope.restSeconds[0] - 10 || rs > envelope.restSeconds[1] + 10) {
        v.push(`day[${i}].exercises[${j}].rest_seconds must be in [${envelope.restSeconds[0]},${envelope.restSeconds[1]}] (got ${ex.rest_seconds})`);
      }
      // cue / muscle_group / progression_note
      if (typeof ex.cue !== "string" || !ex.cue.trim() || ex.cue.length > 240) v.push(`day[${i}].exercises[${j}].cue invalid`);
      if (typeof ex.muscle_group !== "string" || !ex.muscle_group.trim()) v.push(`day[${i}].exercises[${j}].muscle_group required`);
      if (typeof ex.progression_note !== "string" || !ex.progression_note.trim()) v.push(`day[${i}].exercises[${j}].progression_note required`);
      // target_rir if present
      if (ex.target_rir !== undefined && ex.target_rir !== null) {
        const t = Number(ex.target_rir);
        if (!Number.isFinite(t) || t < envelope.targetRir[0] || t > envelope.targetRir[1]) {
          v.push(`day[${i}].exercises[${j}].target_rir ${ex.target_rir} outside [${envelope.targetRir[0]},${envelope.targetRir[1]}]`);
        }
      }
      // Technique tokens in cue/progression_note
      const blob = `${ex.cue ?? ""} ${ex.progression_note ?? ""}`;
      for (const rx of DISALLOWED_TECHNIQUE_TOKENS) {
        if (rx.test(blob)) {
          // Was that technique allowed?
          const allowedRx = Object.entries(TECHNIQUE_TOKEN_MAP).find(([, r]) => r.source === rx.source && r.flags === rx.flags);
          const allowed = allowedRx ? envelope.allowedTechniques.includes(allowedRx[0]) : false;
          if (!allowed) v.push(`day[${i}].exercises[${j}] mentions disallowed technique: "${rx.source}"`);
        }
      }
    }
  }

  // Acute Shield enforcement on first non-rest day
  if (firstNonRestIdx !== -1) {
    const d = days[firstNonRestIdx];
    if (envelope.sessionType === "recovery") {
      for (const ex of d.exercises ?? []) {
        const sets = Number(ex.sets);
        if (Number.isFinite(sets) && sets > 2) v.push(`recovery day first session: "${ex.name}" sets>2`);
        const note = String(ex.progression_note ?? "");
        if (!/recovery|light|technique|mobility/i.test(note)) v.push(`recovery day first session: "${ex.name}" progression_note must mention recovery/light/technique/mobility`);
      }
    } else if (envelope.sessionType === "reduce") {
      for (const ex of d.exercises ?? []) {
        const note = String(ex.progression_note ?? "");
        if (!/hold|rir/i.test(note)) v.push(`reduce day first session: "${ex.name}" progression_note must contain 'hold' or 'RIR'`);
      }
    } else if (envelope.sessionType === "modify") {
      const anyNote = (d.exercises ?? []).some((ex: any) => /warm.?up|readiness/i.test(String(ex.progression_note ?? "")));
      if (!anyNote) v.push(`modify day first session: at least one exercise progression_note must mention warm-up or readiness`);
    }
  }

  // plan_start_date / plan_timezone
  if (plan.plan_start_date !== undefined && plan.plan_start_date !== planStartISO) {
    v.push(`plan_start_date must be ${planStartISO} (got ${plan.plan_start_date})`);
  }

  return { ok: v.length === 0, violations: v };
}

// -------- fallback --------
interface FallbackExercise {
  name: string; sets: number; reps: string; rest_seconds: number;
  cue: string; muscle_group: string; progression_note: string; target_rir: number;
}
interface FallbackDayTemplate { session_name: string; exercises: FallbackExercise[]; }

function pickPool(equipmentPool: EquipmentPool): "bw" | "db" | "gym" {
  if (equipmentPool === "bodyweight_only") return "bw";
  if (equipmentPool === "db+bench+bands") return "db";
  return "gym";
}

function baseExercise(nameByPool: { bw: string; db: string; gym: string }, muscle: string, envelope: Envelope): FallbackExercise {
  const pool = pickPool(envelope.equipmentPool);
  const setsBase = envelope.setsPerExercise;
  const setCount = Math.max(setsBase[0], Math.min(setsBase[1], envelope.sessionType === "recovery" ? 2 : envelope.sessionType === "reduce" ? setsBase[0] : setsBase[0] + 1));
  const rir = envelope.targetRir[0];
  const repLow = envelope.repRange[0];
  const repHi = envelope.repRange[1];
  const reps = envelope.sessionType === "recovery" ? "10-15" : `${repLow}-${repHi}`;
  const rest = envelope.sessionType === "recovery" ? 45 : Math.round((envelope.restSeconds[0] + envelope.restSeconds[1]) / 2);
  const noteBase =
    envelope.sessionType === "recovery" ? `safe fallback — recovery/light technique, RIR ${rir}`
    : envelope.sessionType === "reduce" ? `safe fallback — hold weight, RIR ${rir}`
    : envelope.sessionType === "modify" ? `safe fallback — warm-up readiness check, hold weight`
    : `safe fallback — hold weight, RIR ${rir}`;
  return {
    name: nameByPool[pool],
    sets: setCount,
    reps,
    rest_seconds: clamp(rest, envelope.restSeconds[0], envelope.restSeconds[1]),
    cue: "Move with intent — full range, controlled tempo.",
    muscle_group: muscle,
    progression_note: noteBase,
    target_rir: rir,
  };
}

function fallbackSession(kind: "push" | "pull" | "lower" | "full", envelope: Envelope): FallbackDayTemplate {
  const E = envelope;
  const ex = (n: any, m: string) => baseExercise(n, m, E);
  if (kind === "push") return {
    session_name: "APEX Push A",
    exercises: [
      ex({ bw: "Push-up",           db: "DB Bench Press",    gym: "Barbell Bench Press" }, "chest"),
      ex({ bw: "Pike Push-up",      db: "DB Shoulder Press", gym: "DB Shoulder Press"   }, "shoulders"),
      ex({ bw: "Decline Push-up",   db: "DB Incline Press",  gym: "Machine Chest Press" }, "chest"),
      ex({ bw: "Bench Dip",         db: "DB Overhead Extension", gym: "Cable Triceps Pushdown" }, "triceps"),
    ],
  };
  if (kind === "pull") return {
    session_name: "APEX Pull A",
    exercises: [
      ex({ bw: "Inverted Row",      db: "DB Bent-Over Row",  gym: "Barbell Row"         }, "back"),
      ex({ bw: "Pull-up (assisted OK)", db: "DB One-Arm Row", gym: "Lat Pulldown"       }, "back"),
      ex({ bw: "Band Face Pull",    db: "DB Rear Delt Fly",  gym: "Cable Face Pull"     }, "shoulders"),
      ex({ bw: "Chin-up (assisted OK)", db: "DB Hammer Curl", gym: "Barbell Curl"       }, "biceps"),
    ],
  };
  if (kind === "lower") return {
    session_name: "APEX Lower A",
    exercises: [
      ex({ bw: "Bodyweight Squat",  db: "DB Goblet Squat",   gym: "Barbell Back Squat"  }, "quads"),
      ex({ bw: "Single-Leg RDL",    db: "DB Romanian Deadlift", gym: "Romanian Deadlift" }, "hamstrings"),
      ex({ bw: "Reverse Lunge",     db: "DB Walking Lunge",  gym: "DB Walking Lunge"    }, "quads"),
      ex({ bw: "Glute Bridge",      db: "DB Hip Thrust",     gym: "Barbell Hip Thrust"  }, "glutes"),
    ],
  };
  return {
    session_name: "APEX Full Body A",
    exercises: [
      ex({ bw: "Bodyweight Squat",  db: "DB Goblet Squat",   gym: "Barbell Back Squat"  }, "quads"),
      ex({ bw: "Push-up",           db: "DB Bench Press",    gym: "Barbell Bench Press" }, "chest"),
      ex({ bw: "Inverted Row",      db: "DB Bent-Over Row",  gym: "Barbell Row"         }, "back"),
      ex({ bw: "Glute Bridge",      db: "DB Romanian Deadlift", gym: "Romanian Deadlift" }, "glutes"),
    ],
  };
}

function recoverySession(envelope: Envelope): FallbackDayTemplate {
  const rir = envelope.targetRir[0];
  const mk = (name: string, muscle: string): FallbackExercise => ({
    name, sets: 2, reps: "10-15", rest_seconds: 45,
    cue: "Move slow, breathe deep, keep tension low.",
    muscle_group: muscle,
    progression_note: `safe fallback — recovery/light technique, RIR ${rir}`,
    target_rir: rir,
  });
  return {
    session_name: "APEX Recovery",
    exercises: [
      mk("Cat-Cow Flow", "mobility"),
      mk("World's Greatest Stretch", "mobility"),
      mk("Bird Dog", "core"),
      mk("Easy Walk / Bike (10 min)", "cardio"),
    ],
  };
}

function pickWeekPatterns(days: number): Array<"push"|"pull"|"lower"|"full"> {
  if (days <= 3) return ["full","full","full"];
  if (days === 4) return ["upper" as any === "upper" ? "full" : "full", "lower","full","lower"] as any;
  // Simpler: fall back to Push/Pull/Lower rotation
  if (days === 4) return ["push","pull","lower","full"];
  if (days === 5) return ["push","pull","lower","full","full"];
  return ["push","pull","lower","push","pull","lower"];
}

export function buildFallbackPlan(
  envelope: Envelope,
  planStartISO: string,
  planTimezone: string,
  trainingDaysPerWeek: number,
  restMask?: boolean[],
): any {
  const daysCount = clamp(trainingDaysPerWeek || 3, 2, 6);
  const patterns: Array<"push"|"pull"|"lower"|"full"> =
    daysCount === 2 ? ["full","full"]
    : daysCount === 3 ? ["full","full","full"]
    : daysCount === 4 ? ["push","pull","lower","full"]
    : daysCount === 5 ? ["push","pull","lower","full","full"]
    : ["push","pull","lower","push","pull","lower"];

  // Rest/train indices. If a caller-supplied restMask is valid, honour it
  // exactly (deterministic pin from profile.training_day_codes). Otherwise
  // fall back to the historical even-spread across the week.
  const useMask = Array.isArray(restMask)
    && restMask.length === 7
    && restMask.filter((r) => r === false).length > 0;
  const trainingIdx = new Set<number>();
  if (useMask) {
    for (let i = 0; i < 7; i++) if (restMask![i] === false) trainingIdx.add(i);
  } else {
    for (let i = 0; i < daysCount; i++) {
      trainingIdx.add(Math.round((i * 7) / daysCount) % 7);
    }
    let cursor = 0;
    while (trainingIdx.size < daysCount && cursor < 7) {
      if (!trainingIdx.has(cursor)) trainingIdx.add(cursor);
      cursor++;
    }
  }

  // First non-rest gets recovery/reduce/modify treatment via envelope
  const days: any[] = [];
  let pIdx = 0;
  let firstNonRestApplied = false;
  for (let i = 0; i < 7; i++) {
    const date = isoAddDays(planStartISO, i);
    const day_name = isoWeekdayName(date);
    if (!trainingIdx.has(i)) {
      days.push({ day: i + 1, date, day_name, rest: true, session_name: null, exercises: [] });
      continue;
    }
    let template: FallbackDayTemplate;
    if (!firstNonRestApplied && envelope.sessionType === "recovery") {
      template = recoverySession(envelope);
    } else {
      template = fallbackSession(patterns[pIdx % patterns.length], envelope);
    }
    firstNonRestApplied = true;
    pIdx++;
    days.push({
      day: i + 1, date, day_name, rest: false,
      session_name: template.session_name,
      exercises: template.exercises,
    });
  }

  return {
    plan_start_date: planStartISO,
    plan_timezone: planTimezone,
    days,
    volume_gate_alert: envelope.sessionType === "recovery"
      ? "Safe fallback plan generated — first training day is recovery/mobility focused."
      : "Safe fallback plan generated — conservative sets and load. Review before next week.",
  };
}

// -------- rolling start date --------
export function resolvePlanStartISO(
  now: Date,
  timezone: string,
  hasCompletedWorkoutToday: boolean,
): { planStartISO: string; localToday: string } {
  // Compute local calendar date + local hour using Intl.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const y = parts.find(p => p.type === "year")!.value;
  const m = parts.find(p => p.type === "month")!.value;
  const d = parts.find(p => p.type === "day")!.value;
  const hStr = parts.find(p => p.type === "hour")!.value;
  const localToday = `${y}-${m}-${d}`;
  const localHour = parseInt(hStr, 10);
  const startToday = localHour < 12 && !hasCompletedWorkoutToday;
  const planStartISO = startToday ? localToday : isoAddDays(localToday, 1);
  return { planStartISO, localToday };
}
