import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    console.log("[seed] Starting synthetic user generation...");
    const result = await seedTestUsers();
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error) {
    console.error("[seed] Error:", error);
    return new Response(
      JSON.stringify({ status: "error", message: (error as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  }
});

interface Persona {
  name: string;
  count: number;
  readinessPattern: string;
  adherence: number;
  volumePerWeek: number;
  rirPattern: string;
  goal: string;
  experience: string;
  macroPattern?: string;
}

async function seedTestUsers() {
  const personas: Persona[] = [
    { name: "consistent", count: 10, readinessPattern: "stable-high", adherence: 1.0, volumePerWeek: 16, rirPattern: "tight", goal: "muscle_gain", experience: "advanced" },
    { name: "weekend-warrior", count: 10, readinessPattern: "stable-medium", adherence: 0.4, volumePerWeek: 12, rirPattern: "varied", goal: "recomposition", experience: "intermediate" },
    { name: "yo-yoer", count: 10, readinessPattern: "oscillating", adherence: 0.8, volumePerWeek: 14, rirPattern: "tight", goal: "muscle_gain", experience: "advanced", macroPattern: "cycling" },
    { name: "low-readiness", count: 10, readinessPattern: "chronically-low", adherence: 0.7, volumePerWeek: 14, rirPattern: "high", goal: "fat_loss", experience: "intermediate" },
    { name: "new-lifter", count: 5, readinessPattern: "learning", adherence: 0.9, volumePerWeek: 8, rirPattern: "high", goal: "muscle_gain", experience: "beginner" },
    { name: "injury-recovery", count: 5, readinessPattern: "crash-recover", adherence: 0.8, volumePerWeek: 12, rirPattern: "high", goal: "fat_loss", experience: "intermediate" },
  ];

  let totalUsers = 0, totalMeals = 0, totalWorkouts = 0, totalReadiness = 0;

  for (const persona of personas) {
    for (let i = 0; i < persona.count; i++) {
      const userId = await createSyntheticUser(persona, i);
      if (!userId) continue;
      const { meals, workouts, readiness } = await generatePersona180Days(userId, persona);
      totalUsers++;
      totalMeals += meals;
      totalWorkouts += workouts;
      totalReadiness += readiness;
      console.log(`[seed] Created ${persona.name}-${i}: ${meals} meals, ${workouts} workouts, ${readiness} readiness`);
    }
  }

  return {
    status: "success",
    users_created: totalUsers,
    meals_logged: totalMeals,
    workouts_logged: totalWorkouts,
    readiness_scores: totalReadiness,
    message: `Seeded ${totalUsers} test users with 180 days of realistic data.`,
  };
}

async function createSyntheticUser(persona: Persona, index: number): Promise<string | null> {
  try {
    const email = `test-${persona.name}-${index}-${Date.now()}@apex-test.local`;
    const password = "TestPass123!";

    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authError || !authUser.user) {
      console.error(`[seed] Auth user creation failed for ${email}:`, authError);
      return null;
    }

    const userId = authUser.user.id;

    const { error: profileError } = await supabase.from("profiles").insert({
      user_id: userId,
      goal: persona.goal,
      training_days_per_week: Math.max(1, Math.min(7, Math.round(persona.volumePerWeek / 4))),
      equipment_access: "barbell,dumbbell,cable",
      experience_level: persona.experience,
      biological_sex: Math.random() > 0.5 ? "male" : "female",
      body_data_type: "measurements",
    });

    if (profileError) {
      console.error(`[seed] Profile creation failed for ${userId}:`, profileError);
      return null;
    }

    return userId;
  } catch (error) {
    console.error(`[seed] createSyntheticUser error:`, error);
    return null;
  }
}

async function generatePersona180Days(userId: string, persona: Persona) {
  const startDate = new Date("2025-12-30");
  let meals = 0, workouts = 0, readiness = 0;

  function computeBaseReadiness(pattern: string, day: number): number {
    switch (pattern) {
      case "stable-high": return 65 + Math.random() * 10 - 5;
      case "stable-medium": return 55 + Math.random() * 10 - 5;
      case "oscillating": return 55 + 15 * Math.sin(day / 20) + (Math.random() * 10 - 5);
      case "chronically-low": return 40 + Math.random() * 15 - 5;
      case "learning": return 50 + (Math.random() * 20 - 10) + day * 0.05;
      case "crash-recover":
        if (day < 30) return 70 + Math.random() * 10 - 5;
        if (day === 30) return 30;
        return 30 + (day - 30) * 0.5 + Math.random() * 10 - 5;
      default: return 50;
    }
  }

  function shouldWorkoutToday(day: number, sessionsPerWeek: number): boolean {
    const dayOfWeek = day % 7;
    const isSessionDay = [0, 2, 4, 6].includes(dayOfWeek);
    return isSessionDay && Math.random() < (sessionsPerWeek / 4);
  }

  function getExerciseForDay(day: number): string {
    const exercises = ["Squat", "Bench Press", "Deadlift", "Pull-up", "Barbell Row"];
    return exercises[Math.floor(day / 10) % exercises.length];
  }

  function getWorkingSets(p: Persona, day: number): number {
    const base = Math.ceil(p.volumePerWeek / 4);
    if (p.readinessPattern === "crash-recover" && day >= 30 && day < 120) {
      return Math.max(2, Math.ceil(base * 0.7));
    }
    return base;
  }

  function computeRIR(pattern: string): number {
    if (pattern === "tight") return Math.floor(Math.random() * 2) + 1;
    if (pattern === "varied") return Math.floor(Math.random() * 4);
    if (pattern === "high") return Math.floor(Math.random() * 3) + 2;
    return 2;
  }

  function shouldLogMeals(adherence: number): boolean {
    return Math.random() < adherence;
  }

  let weight = 80;

  for (let day = 0; day < 180; day++) {
    const currentDate = new Date(startDate);
    currentDate.setDate(currentDate.getDate() + day);
    const dateISO = currentDate.toISOString().split("T")[0];

    // READINESS
    const baseScore = computeBaseReadiness(persona.readinessPattern, day);
    const finalScore = Math.max(0, Math.min(100, Math.round(baseScore + (Math.random() * 6 - 3))));

    await supabase.from("readiness_scores").insert({
      user_id: userId,
      score_date: dateISO,
      final_score: finalScore,
      confidence_level: "high",
      input_path: "manual",
      pillar_breakdown: {
        recovery: 30,
        sleep: 22,
        nutrition: 20,
        training: 15,
        mood: 13,
      },
      engine_version: "v6.1",
    });
    readiness++;

    // WEIGHT
    const weeklyTrend = persona.goal === "muscle_gain" ? 0.125 : persona.goal === "fat_loss" ? -0.5 : 0.05;
    if (persona.readinessPattern === "crash-recover" && day >= 30) {
      weight += 0.3 / 7;
    } else {
      weight += weeklyTrend / 7;
    }
    const noisyWeight = weight + (Math.random() * 2 - 1);

    await supabase.from("body_measurement_events").insert({
      user_id: userId,
      entry_date: dateISO,
      weight_kg: parseFloat(noisyWeight.toFixed(1)),
      source: "scale",
    });

    // WORKOUTS
    if (shouldWorkoutToday(day, persona.volumePerWeek / 7)) {
      const exercise = getExerciseForDay(day);
      const sets = getWorkingSets(persona, day);
      let sessionStrain = 0;

      for (let set = 1; set <= sets; set++) {
        const baseWeight = 60 + (persona.experience === "beginner" ? 0 : 20) + Math.floor(day / 28) * 2.5;
        const rir = computeRIR(persona.rirPattern);
        const reps = 8;

        await supabase.from("workout_set_logs").insert({
          user_id: userId,
          entry_date: dateISO,
          exercise_name: exercise,
          set_number: set,
          weight_kg: baseWeight,
          reps_completed: reps,
          rir,
          completed: true,
          muscle_group: exercise.includes("Squat") ? "legs" : exercise.includes("Deadlift") ? "full_body" : "upper",
        });

        sessionStrain += Math.min(21, Math.round((set * 0.6 + (baseWeight * reps) / 1200) * 10) / 10);
      }

      await supabase.from("shield_training_logs").insert({
        user_id: userId,
        entry_date: dateISO,
        strain_value: parseFloat(sessionStrain.toFixed(1)),
        session_notes: `${exercise} session, ${sets} working sets`,
      });

      let volumeAdjustment = "full";
      if (finalScore < 45) {
        const rand = Math.random();
        volumeAdjustment = rand < 0.5 ? "reduced" : rand < 0.8 ? "recovery" : "full";
      }

      await supabase.from("pre_session_checks").insert({
        user_id: userId,
        entry_date: dateISO,
        session_readiness: finalScore,
        volume_adjustment: volumeAdjustment,
      });

      workouts++;
    }

    // MEALS
    if (shouldLogMeals(persona.adherence)) {
      const mealSlots = ["breakfast", "lunch", "dinner"];

      for (const mealSlot of mealSlots) {
        const mealCalories = mealSlot === "breakfast" ? 500 : mealSlot === "lunch" ? 700 : 800;
        let adjustedCalories = mealCalories;

        if (persona.macroPattern === "cycling") {
          const cyclePhase = Math.floor(day / 14) % 3;
          const multipliers = [0.8, 1.0, 1.15];
          adjustedCalories *= multipliers[cyclePhase];
        }

        let protein: number, carbs: number, fat: number;
        if (persona.goal === "muscle_gain") {
          protein = (adjustedCalories * 0.35) / 4;
          carbs = (adjustedCalories * 0.45) / 4;
          fat = (adjustedCalories * 0.20) / 9;
        } else if (persona.goal === "fat_loss") {
          protein = (adjustedCalories * 0.40) / 4;
          carbs = (adjustedCalories * 0.35) / 4;
          fat = (adjustedCalories * 0.25) / 9;
        } else {
          protein = (adjustedCalories * 0.35) / 4;
          carbs = (adjustedCalories * 0.40) / 4;
          fat = (adjustedCalories * 0.25) / 9;
        }

        await supabase.from("shield_nutrition_logs").insert({
          user_id: userId,
          entry_date: dateISO,
          meal_slot: mealSlot,
          estimated_calories: Math.round(adjustedCalories),
          estimated_protein_g: Math.round(protein),
          estimated_carbs_g: Math.round(carbs),
          estimated_fat_g: Math.round(fat),
          calorie_estimate_status: "manual_edited",
          claude_score_status: "skipped",
          deleted: false,
        });

        meals++;
      }
    }
  }

  return { meals, workouts, readiness };
}
