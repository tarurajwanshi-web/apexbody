// FILE: supabase/functions/test-seed-10-users/index.ts
// 10 users × 90 days with edge cases for Engine stress testing
// Paste into Lovable, deploy, click button on dashboard

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface TestUser {
  userId: string;
  email: string;
  edgeCase: string;
  goal: string;
}

serve(async (req) => {
  // CORS
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  try {
    console.log("[test-seed] Starting 10-user, 90-day edge case test...");

    const testUsers: TestUser[] = [];

    // ============================================================================
    // EDGE CASES (10 users, each stresses different engine paths)
    // ============================================================================

    const edgeCases = [
      {
        name: "perfect-adherence",
        goal: "muscle_gain",
        description: "Logs every day, readiness stable 70+, consistent training/meals",
      },
      {
        name: "crash-recovery",
        goal: "muscle_gain",
        description:
          "Day 0-30: normal. Day 30: readiness crashes to 30, volume gate triggers. Day 30-90: recovery with volume adjustments.",
      },
      {
        name: "inconsistent-logger",
        goal: "fat_loss",
        description:
          "Sporadic meal logging (30% compliance). Readiness volatile. Nutrition engine can't adapt. Tests low-confidence gates.",
      },
      {
        name: "low-readiness-chronic",
        goal: "recomposition",
        description:
          "Readiness baseline 35-45 entire 90 days. Volume always reduced. Tests if plan de-loads infinitely or stabilizes.",
      },
      {
        name: "newbie-improvement",
        goal: "muscle_gain",
        description:
          "Day 0-14: readiness noisy (40-60), meal logging ramps up. Day 14+: stabilizes. Tests onboarding edge case.",
      },
      {
        name: "yo-yoer",
        goal: "recomposition",
        description:
          "Alternates between deficit (days 0-20, 40-60, 80-90) and surplus (days 20-40, 60-80). Tests macro oscillation.",
      },
      {
        name: "injury-recovery",
        goal: "fat_loss",
        description:
          "Day 0-20: normal. Day 21: injury event (readiness drops 20 pts, volume -50%). Day 21-90: gradual return.",
      },
      {
        name: "perfect-nutrition-bad-recovery",
        goal: "muscle_gain",
        description:
          "Logs meals perfectly, but readiness is always low (poor sleep). Tests nutrition/recovery mismatch.",
      },
      {
        name: "high-volume-low-readiness",
        goal: "strength",
        description:
          "Logs high sets/strain regardless of readiness. Tests if volume gate prevents overtraining or if user overrides.",
      },
      {
        name: "ghost-user",
        goal: "muscle_gain",
        description:
          "Days 1-20: active. Day 21-70: zero logs (vacation). Day 71-90: returns to normal. Tests signal dropout.",
      },
    ];

    // Create 10 users with edge cases
    for (const edgeCase of edgeCases) {
      const email = `test-${edgeCase.name}-${Date.now()}@apex-test.local`;
      const password = "TestPass123!";

      const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

      if (authError || !authUser.user) {
        console.error(`[test-seed] Auth failed for ${email}:`, authError);
        continue;
      }

      const userId = authUser.user.id;

      // Create profile
      const { error: profileError } = await supabase.from("profiles").insert({
        user_id: userId,
        goal: edgeCase.goal,
        training_days_per_week: 4,
        equipment_access: "barbell,dumbbell,cable",
        experience_level: "intermediate",
        biological_sex: Math.random() > 0.5 ? "male" : "female",
        body_data_type: "measurements",
      });

      if (profileError) {
        console.error(`[test-seed] Profile failed for ${userId}:`, profileError);
        continue;
      }

      testUsers.push({
        userId,
        email,
        edgeCase: edgeCase.name,
        goal: edgeCase.goal,
      });
    }

    console.log(`[test-seed] Created ${testUsers.length} test users`);

    // ============================================================================
    // GENERATE 90 DAYS OF DATA PER USER
    // ============================================================================

    const exercises = ["Squat", "Bench Press", "Deadlift", "Pull-up", "Rows"];
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 90);

    for (const user of testUsers) {
      let weight = 80;
      let readinessBaseline = 65;

      for (let dayOffset = 0; dayOffset < 90; dayOffset++) {
        const currentDate = new Date(startDate);
        currentDate.setDate(currentDate.getDate() + dayOffset);
        const dateISO = currentDate.toISOString().split("T")[0];

        // ===== READINESS (engine-specific logic per edge case) =====
        let readiness = readinessBaseline;

        if (user.edgeCase === "crash-recovery") {
          if (dayOffset <= 30) {
            readiness = 70 + Math.random() * 10 - 5;
          } else if (dayOffset === 30) {
            readiness = 30; // Crash
          } else {
            readiness = 30 + (dayOffset - 30) * 0.5 + (Math.random() * 10 - 5); // Recovery
          }
        } else if (user.edgeCase === "inconsistent-logger") {
          readiness = 50 + (Math.random() * 40 - 20); // Volatile ±20
        } else if (user.edgeCase === "low-readiness-chronic") {
          readiness = 40 + (Math.random() * 10 - 5); // Always 35-45
        } else if (user.edgeCase === "newbie-improvement") {
          if (dayOffset < 14) {
            readiness = 50 + (Math.random() * 20 - 10); // Noisy
          } else {
            readiness = 65 + (Math.random() * 10 - 5); // Stabilizes
          }
        } else if (user.edgeCase === "yo-yoer") {
          readiness = 60 + (Math.random() * 10 - 5);
        } else if (user.edgeCase === "injury-recovery") {
          if (dayOffset < 20) {
            readiness = 70;
          } else if (dayOffset === 20) {
            readiness = 50; // Injury
          } else {
            readiness = 50 + (dayOffset - 20) * 0.3;
          }
        } else if (user.edgeCase === "perfect-nutrition-bad-recovery") {
          readiness = 35 + (Math.random() * 10 - 5); // Always low
        } else if (user.edgeCase === "high-volume-low-readiness") {
          readiness = 40 + (Math.random() * 15 - 7);
        } else if (user.edgeCase === "ghost-user") {
          if (dayOffset >= 20 && dayOffset < 70) {
            readiness = 0; // No logs (skip)
          } else {
            readiness = 65 + (Math.random() * 10 - 5);
          }
        } else {
          // perfect-adherence
          readiness = 70 + (Math.random() * 10 - 5);
        }

        readiness = Math.max(0, Math.min(100, Math.round(readiness)));

        // Skip readiness if ghost user in inactive period
        if (user.edgeCase === "ghost-user" && dayOffset >= 20 && dayOffset < 70) {
          continue;
        }

        await supabase.from("readiness_scores").insert({
          user_id: user.userId,
          score_date: dateISO,
          final_score: readiness,
          confidence_level: dayOffset < 14 ? "low" : dayOffset < 30 ? "medium" : "high",
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

        // ===== WEIGHT (goal-dependent drift) =====
        const dailyTrend =
          user.goal === "muscle_gain"
            ? 0.15 / 7
            : user.goal === "fat_loss"
              ? -0.35 / 7
              : 0.05 / 7;

        weight += dailyTrend + (Math.random() * 0.4 - 0.2);

        await supabase.from("body_measurement_events").insert({
          user_id: user.userId,
          entry_date: dateISO,
          weight_kg: parseFloat(weight.toFixed(1)),
          source: "scale",
        });

        // ===== WORKOUTS (readiness-gated, edge-case-specific volume) =====
        let shouldWorkout = false;
        let workingSets = 4;
        let volumeAdjustment = "full";

        if (user.edgeCase === "perfect-adherence") {
          shouldWorkout = Math.random() < 0.85; // 85% compliance
          workingSets = 4;
        } else if (user.edgeCase === "crash-recovery") {
          shouldWorkout = dayOffset < 20 || dayOffset > 35 ? Math.random() < 0.8 : false; // Gap during recovery
          if (dayOffset > 30 && dayOffset < 50) {
            workingSets = 2; // Reduced during recovery
            volumeAdjustment = "reduced";
          }
        } else if (user.edgeCase === "inconsistent-logger") {
          shouldWorkout = Math.random() < 0.4; // 40% compliance
        } else if (user.edgeCase === "low-readiness-chronic") {
          shouldWorkout = Math.random() < 0.6;
          workingSets = 2; // Always reduced
          volumeAdjustment = "reduced";
        } else if (user.edgeCase === "newbie-improvement") {
          if (dayOffset < 14) {
            shouldWorkout = Math.random() < 0.5; // Learning phase
            workingSets = 3;
          } else {
            shouldWorkout = Math.random() < 0.75;
            workingSets = 4;
          }
        } else if (user.edgeCase === "yo-yoer") {
          shouldWorkout = Math.random() < 0.8;
          workingSets = 4;
        } else if (user.edgeCase === "injury-recovery") {
          if (dayOffset < 20) {
            shouldWorkout = Math.random() < 0.8;
            workingSets = 4;
          } else if (dayOffset < 50) {
            shouldWorkout = Math.random() < 0.5;
            workingSets = 2;
            volumeAdjustment = "recovery";
          } else {
            shouldWorkout = Math.random() < 0.75;
            workingSets = 3;
          }
        } else if (user.edgeCase === "perfect-nutrition-bad-recovery") {
          shouldWorkout = Math.random() < 0.7;
          if (readiness < 45) {
            workingSets = 2;
            volumeAdjustment = "reduced";
          }
        } else if (user.edgeCase === "high-volume-low-readiness") {
          shouldWorkout = Math.random() < 0.85; // Always pushes hard
          workingSets = 5; // High volume despite low readiness
          if (readiness < 45) {
            volumeAdjustment = "full"; // User ignores gate
          }
        } else if (user.edgeCase === "ghost-user") {
          if (dayOffset >= 20 && dayOffset < 70) {
            shouldWorkout = false; // Inactive
          } else {
            shouldWorkout = Math.random() < 0.8;
          }
        }

        // Apply readiness gate for most users
        if (readiness < 45 && user.edgeCase !== "high-volume-low-readiness") {
          workingSets = Math.max(2, Math.ceil(workingSets * 0.7));
          volumeAdjustment = Math.random() > 0.5 ? "reduced" : "recovery";
        }

        if (shouldWorkout) {
          const exercise = exercises[Math.floor(dayOffset / 18) % exercises.length];
          let sessionStrain = 0;

          for (let set = 1; set <= workingSets; set++) {
            const baseWeight = 80 + (dayOffset * 0.02);
            const rir = Math.floor(Math.random() * 3) + 1;

            await supabase.from("workout_set_logs").insert({
              user_id: user.userId,
              entry_date: dateISO,
              exercise_name: exercise,
              set_number: set,
              weight_kg: parseFloat(baseWeight.toFixed(1)),
              reps_completed: 8,
              rir,
              completed: true,
              muscle_group: exercise.includes("Squat") ? "legs" : "upper",
            });

            sessionStrain += Math.min(
              21,
              Math.round(((set * 0.6 + (baseWeight * 8) / 1200) * 10) / 10)
            );
          }

          await supabase.from("shield_training_logs").insert({
            user_id: user.userId,
            entry_date: dateISO,
            strain_value: parseFloat(sessionStrain.toFixed(1)),
            session_notes: `${exercise}, ${workingSets} sets, readiness ${readiness}`,
          });

          await supabase.from("pre_session_checks").insert({
            user_id: user.userId,
            entry_date: dateISO,
            session_readiness: readiness,
            volume_adjustment: volumeAdjustment,
          });
        }

        // ===== MEALS (compliance varies per edge case) =====
        let mealCompliance = 1.0;

        if (user.edgeCase === "inconsistent-logger") {
          mealCompliance = 0.3; // Sparse
        } else if (user.edgeCase === "newbie-improvement") {
          mealCompliance = dayOffset < 14 ? 0.5 : 0.95; // Ramps up
        } else if (user.edgeCase === "ghost-user") {
          if (dayOffset >= 20 && dayOffset < 70) {
            mealCompliance = 0; // No logs
          }
        } else if (user.edgeCase === "perfect-nutrition-bad-recovery") {
          mealCompliance = 1.0; // Logs perfectly despite bad readiness
        }

        if (Math.random() < mealCompliance) {
          const tdee =
            user.goal === "muscle_gain"
              ? 2500
              : user.goal === "fat_loss"
                ? 2000
                : 2250;

          // Yo-yoer cycles macros
          let targetTdee = tdee;
          if (user.edgeCase === "yo-yoer") {
            const cyclePhase = Math.floor(dayOffset / 20) % 3;
            targetTdee = cyclePhase === 0 ? tdee - 300 : cyclePhase === 1 ? tdee : tdee + 300;
          }

          const mealCalories = (targetTdee / 3) * (0.8 + Math.random() * 0.4);

          for (const meal of ["breakfast", "lunch", "dinner"]) {
            if (Math.random() < mealCompliance) {
              const protein = (mealCalories * 0.35) / 4;
              const carbs = (mealCalories * 0.45) / 4;
              const fat = (mealCalories * 0.2) / 9;

              await supabase.from("shield_nutrition_logs").insert({
                user_id: user.userId,
                entry_date: dateISO,
                meal_slot: meal,
                estimated_calories: Math.round(mealCalories),
                estimated_protein_g: Math.round(protein),
                estimated_carbs_g: Math.round(carbs),
                estimated_fat_g: Math.round(fat),
                calorie_estimate_status: "manual_edited",
                deleted: false,
                claude_score_status: "skipped",
              });
            }
          }
        }
      } // end 90 days

      console.log(`[test-seed] ${user.edgeCase}: complete`);
    } // end users

    return new Response(
      JSON.stringify({
        status: "success",
        users_created: testUsers.length,
        days_per_user: 90,
        edge_cases: testUsers.map((u) => u.edgeCase),
        message: `Seeded 10 users × 90 days with edge cases: ${testUsers
          .map((u) => u.edgeCase)
          .join(", ")}`,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[test-seed] Error:", errorMessage);
    return new Response(
      JSON.stringify({ status: "error", message: errorMessage }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
});
