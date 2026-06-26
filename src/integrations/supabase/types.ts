export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      body_measurement_events: {
        Row: {
          arm_cm: number | null
          body_fat_pct: number | null
          created_at: string
          entry_date: string
          hip_cm: number | null
          id: string
          lean_mass_kg: number | null
          notes: string | null
          source: string
          thigh_cm: number | null
          user_id: string
          waist_cm: number | null
          weight_kg: number | null
        }
        Insert: {
          arm_cm?: number | null
          body_fat_pct?: number | null
          created_at?: string
          entry_date?: string
          hip_cm?: number | null
          id?: string
          lean_mass_kg?: number | null
          notes?: string | null
          source?: string
          thigh_cm?: number | null
          user_id: string
          waist_cm?: number | null
          weight_kg?: number | null
        }
        Update: {
          arm_cm?: number | null
          body_fat_pct?: number | null
          created_at?: string
          entry_date?: string
          hip_cm?: number | null
          id?: string
          lean_mass_kg?: number | null
          notes?: string | null
          source?: string
          thigh_cm?: number | null
          user_id?: string
          waist_cm?: number | null
          weight_kg?: number | null
        }
        Relationships: []
      }
      body_scan_photos: {
        Row: {
          captured_at: string
          created_at: string
          id: string
          photo_url: string
          user_id: string
        }
        Insert: {
          captured_at?: string
          created_at?: string
          id?: string
          photo_url: string
          user_id: string
        }
        Update: {
          captured_at?: string
          created_at?: string
          id?: string
          photo_url?: string
          user_id?: string
        }
        Relationships: []
      }
      daily_ai_insights: {
        Row: {
          content: string
          created_at: string
          id: string
          insight_date: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          insight_date: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          insight_date?: string
          user_id?: string
        }
        Relationships: []
      }
      daily_coaching_cards: {
        Row: {
          card_date: string
          card_type: string
          content: string
          created_at: string | null
          id: string
          user_id: string
        }
        Insert: {
          card_date: string
          card_type: string
          content: string
          created_at?: string | null
          id?: string
          user_id: string
        }
        Update: {
          card_date?: string
          card_type?: string
          content?: string
          created_at?: string | null
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      daily_macro_targets: {
        Row: {
          bmr: number
          calculated_at: string
          created_at: string
          effective_end_date: string | null
          effective_start_date: string
          formula_used: string
          id: string
          review_id: string | null
          source: string
          target_calories: number
          target_carbs_g: number
          target_fat_g: number
          target_protein_g: number
          tdee: number
          updated_at: string
          user_id: string
        }
        Insert: {
          bmr: number
          calculated_at?: string
          created_at?: string
          effective_end_date?: string | null
          effective_start_date: string
          formula_used: string
          id?: string
          review_id?: string | null
          source?: string
          target_calories: number
          target_carbs_g: number
          target_fat_g: number
          target_protein_g: number
          tdee: number
          updated_at?: string
          user_id: string
        }
        Update: {
          bmr?: number
          calculated_at?: string
          created_at?: string
          effective_end_date?: string | null
          effective_start_date?: string
          formula_used?: string
          id?: string
          review_id?: string | null
          source?: string
          target_calories?: number
          target_carbs_g?: number
          target_fat_g?: number
          target_protein_g?: number
          tdee?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_macro_targets_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "nutrition_weekly_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      exercise_image_cache: {
        Row: {
          exercise_name: string
          exercise_name_key: string
          fetched_at: string
          license: string | null
          license_author: string | null
          original_url: string | null
          storage_path: string
          wger_exercise_id: number | null
        }
        Insert: {
          exercise_name: string
          exercise_name_key: string
          fetched_at?: string
          license?: string | null
          license_author?: string | null
          original_url?: string | null
          storage_path: string
          wger_exercise_id?: number | null
        }
        Update: {
          exercise_name?: string
          exercise_name_key?: string
          fetched_at?: string
          license?: string | null
          license_author?: string | null
          original_url?: string | null
          storage_path?: string
          wger_exercise_id?: number | null
        }
        Relationships: []
      }
      hydration_events: {
        Row: {
          amount_ml: number
          created_at: string
          entry_date: string
          id: string
          user_id: string
        }
        Insert: {
          amount_ml: number
          created_at?: string
          entry_date?: string
          id?: string
          user_id: string
        }
        Update: {
          amount_ml?: number
          created_at?: string
          entry_date?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      nutrition_daily_summaries: {
        Row: {
          compliance_pct: number | null
          meal_count: number | null
          summary_date: string
          total_carbs: number | null
          total_fat: number | null
          total_fiber: number | null
          total_protein: number | null
          total_sodium: number | null
          user_id: string
        }
        Insert: {
          compliance_pct?: number | null
          meal_count?: number | null
          summary_date: string
          total_carbs?: number | null
          total_fat?: number | null
          total_fiber?: number | null
          total_protein?: number | null
          total_sodium?: number | null
          user_id: string
        }
        Update: {
          compliance_pct?: number | null
          meal_count?: number | null
          summary_date?: string
          total_carbs?: number | null
          total_fat?: number | null
          total_fiber?: number | null
          total_protein?: number | null
          total_sodium?: number | null
          user_id?: string
        }
        Relationships: []
      }
      nutrition_meal_full_analysis: {
        Row: {
          body_response: string | null
          carbs_g: number | null
          coach_insight: string | null
          created_at: string | null
          digestion_profile: string | null
          entry_date: string
          fat_g: number | null
          fiber_g: number | null
          flags: string[] | null
          food_sources: string[] | null
          full_haiku_output: Json | null
          id: string
          meal_id: string | null
          meal_time: string | null
          micronutrients: Json | null
          potassium_mg: number | null
          protein_g: number | null
          quality_assessment: string | null
          satiety_factors: string | null
          sodium_mg: number | null
          sugar_g: number | null
          timing_implications: string | null
          user_id: string
        }
        Insert: {
          body_response?: string | null
          carbs_g?: number | null
          coach_insight?: string | null
          created_at?: string | null
          digestion_profile?: string | null
          entry_date: string
          fat_g?: number | null
          fiber_g?: number | null
          flags?: string[] | null
          food_sources?: string[] | null
          full_haiku_output?: Json | null
          id?: string
          meal_id?: string | null
          meal_time?: string | null
          micronutrients?: Json | null
          potassium_mg?: number | null
          protein_g?: number | null
          quality_assessment?: string | null
          satiety_factors?: string | null
          sodium_mg?: number | null
          sugar_g?: number | null
          timing_implications?: string | null
          user_id: string
        }
        Update: {
          body_response?: string | null
          carbs_g?: number | null
          coach_insight?: string | null
          created_at?: string | null
          digestion_profile?: string | null
          entry_date?: string
          fat_g?: number | null
          fiber_g?: number | null
          flags?: string[] | null
          food_sources?: string[] | null
          full_haiku_output?: Json | null
          id?: string
          meal_id?: string | null
          meal_time?: string | null
          micronutrients?: Json | null
          potassium_mg?: number | null
          protein_g?: number | null
          quality_assessment?: string | null
          satiety_factors?: string | null
          sodium_mg?: number | null
          sugar_g?: number | null
          timing_implications?: string | null
          user_id?: string
        }
        Relationships: []
      }
      nutrition_weekly_reviews: {
        Row: {
          abnormal_week: boolean
          adherence_pct: number
          adjustment_kcal: number
          applied_at: string | null
          applied_target_id: string | null
          avg_rir: number | null
          avg_strain_value: number | null
          blended_tdee: number | null
          confidence_tier: string | null
          consecutive_deficit_weeks: number | null
          created_at: string
          days_logged: number
          decision: string
          eligible: boolean
          flag_reason: string | null
          id: string
          new_observed_tdee: number | null
          new_target_calories: number | null
          old_observed_tdee: number | null
          old_target_calories: number | null
          raw_target_calories: number | null
          timezone_used: string
          training_load_index: number | null
          user_id: string
          week_end_date: string
          week_start_date: string
          weekly_sets_avg: number | null
          weigh_in_count: number
          weight_stall_detected: boolean | null
          weight_trend_kg_per_week: number | null
        }
        Insert: {
          abnormal_week?: boolean
          adherence_pct?: number
          adjustment_kcal?: number
          applied_at?: string | null
          applied_target_id?: string | null
          avg_rir?: number | null
          avg_strain_value?: number | null
          blended_tdee?: number | null
          confidence_tier?: string | null
          consecutive_deficit_weeks?: number | null
          created_at?: string
          days_logged?: number
          decision: string
          eligible?: boolean
          flag_reason?: string | null
          id?: string
          new_observed_tdee?: number | null
          new_target_calories?: number | null
          old_observed_tdee?: number | null
          old_target_calories?: number | null
          raw_target_calories?: number | null
          timezone_used: string
          training_load_index?: number | null
          user_id: string
          week_end_date: string
          week_start_date: string
          weekly_sets_avg?: number | null
          weigh_in_count?: number
          weight_stall_detected?: boolean | null
          weight_trend_kg_per_week?: number | null
        }
        Update: {
          abnormal_week?: boolean
          adherence_pct?: number
          adjustment_kcal?: number
          applied_at?: string | null
          applied_target_id?: string | null
          avg_rir?: number | null
          avg_strain_value?: number | null
          blended_tdee?: number | null
          confidence_tier?: string | null
          consecutive_deficit_weeks?: number | null
          created_at?: string
          days_logged?: number
          decision?: string
          eligible?: boolean
          flag_reason?: string | null
          id?: string
          new_observed_tdee?: number | null
          new_target_calories?: number | null
          old_observed_tdee?: number | null
          old_target_calories?: number | null
          raw_target_calories?: number | null
          timezone_used?: string
          training_load_index?: number | null
          user_id?: string
          week_end_date?: string
          week_start_date?: string
          weekly_sets_avg?: number | null
          weigh_in_count?: number
          weight_stall_detected?: boolean | null
          weight_trend_kg_per_week?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "nutrition_weekly_reviews_applied_target_fkey"
            columns: ["applied_target_id"]
            isOneToOne: false
            referencedRelation: "daily_macro_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      pre_session_checks: {
        Row: {
          created_at: string
          entry_date: string
          id: string
          session_readiness: number
          user_id: string
        }
        Insert: {
          created_at?: string
          entry_date: string
          id?: string
          session_readiness: number
          user_id: string
        }
        Update: {
          created_at?: string
          entry_date?: string
          id?: string
          session_readiness?: number
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          age: number | null
          behavioral_input_preference: string | null
          biological_sex: string | null
          body_data_type: string | null
          coaching_time: string | null
          created_at: string
          dexa_body_fat_pct: number | null
          dexa_lean_mass_kg: number | null
          disclaimer_accepted_at: string | null
          eating_pattern: string | null
          equipment_access: string | null
          experience_level: string | null
          goal: string | null
          id: string
          input_path_preference: string | null
          measurement_height_cm: number | null
          measurement_hip_cm: number | null
          measurement_waist_cm: number | null
          measurement_weight_kg: number | null
          name: string | null
          plan_unlock_date: string | null
          profile_completed_at: string | null
          soft_reset_at: string | null
          timezone: string | null
          training_day_codes: string[] | null
          training_days_per_week: number | null
          updated_at: string
          user_id: string
          user_marked_abnormal_week_start: string | null
        }
        Insert: {
          age?: number | null
          behavioral_input_preference?: string | null
          biological_sex?: string | null
          body_data_type?: string | null
          coaching_time?: string | null
          created_at?: string
          dexa_body_fat_pct?: number | null
          dexa_lean_mass_kg?: number | null
          disclaimer_accepted_at?: string | null
          eating_pattern?: string | null
          equipment_access?: string | null
          experience_level?: string | null
          goal?: string | null
          id?: string
          input_path_preference?: string | null
          measurement_height_cm?: number | null
          measurement_hip_cm?: number | null
          measurement_waist_cm?: number | null
          measurement_weight_kg?: number | null
          name?: string | null
          plan_unlock_date?: string | null
          profile_completed_at?: string | null
          soft_reset_at?: string | null
          timezone?: string | null
          training_day_codes?: string[] | null
          training_days_per_week?: number | null
          updated_at?: string
          user_id: string
          user_marked_abnormal_week_start?: string | null
        }
        Update: {
          age?: number | null
          behavioral_input_preference?: string | null
          biological_sex?: string | null
          body_data_type?: string | null
          coaching_time?: string | null
          created_at?: string
          dexa_body_fat_pct?: number | null
          dexa_lean_mass_kg?: number | null
          disclaimer_accepted_at?: string | null
          eating_pattern?: string | null
          equipment_access?: string | null
          experience_level?: string | null
          goal?: string | null
          id?: string
          input_path_preference?: string | null
          measurement_height_cm?: number | null
          measurement_hip_cm?: number | null
          measurement_waist_cm?: number | null
          measurement_weight_kg?: number | null
          name?: string | null
          plan_unlock_date?: string | null
          profile_completed_at?: string | null
          soft_reset_at?: string | null
          timezone?: string | null
          training_day_codes?: string[] | null
          training_days_per_week?: number | null
          updated_at?: string
          user_id?: string
          user_marked_abnormal_week_start?: string | null
        }
        Relationships: []
      }
      readiness_scores: {
        Row: {
          confidence_level: string | null
          confidence_reason: string | null
          created_at: string
          engine_version: string
          fatigue_adjustment: number
          final_score: number
          id: string
          input_path: string | null
          nudge_message: string | null
          pillar_breakdown: Json
          pre_session_adjustment: number
          score_date: string
          user_id: string
        }
        Insert: {
          confidence_level?: string | null
          confidence_reason?: string | null
          created_at?: string
          engine_version?: string
          fatigue_adjustment?: number
          final_score: number
          id?: string
          input_path?: string | null
          nudge_message?: string | null
          pillar_breakdown: Json
          pre_session_adjustment?: number
          score_date: string
          user_id: string
        }
        Update: {
          confidence_level?: string | null
          confidence_reason?: string | null
          created_at?: string
          engine_version?: string
          fatigue_adjustment?: number
          final_score?: number
          id?: string
          input_path?: string | null
          nudge_message?: string | null
          pillar_breakdown?: Json
          pre_session_adjustment?: number
          score_date?: string
          user_id?: string
        }
        Relationships: []
      }
      shield_device_uploads: {
        Row: {
          created_at: string
          device_source: string | null
          entry_date: string
          id: string
          parse_status: string
          parsed_date: string | null
          parsed_hrv: number | null
          parsed_rhr: number | null
          parsed_sleep_hours: number | null
          parsed_sleep_stages: Json | null
          screenshot_url: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_source?: string | null
          entry_date: string
          id?: string
          parse_status?: string
          parsed_date?: string | null
          parsed_hrv?: number | null
          parsed_rhr?: number | null
          parsed_sleep_hours?: number | null
          parsed_sleep_stages?: Json | null
          screenshot_url: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_source?: string | null
          entry_date?: string
          id?: string
          parse_status?: string
          parsed_date?: string | null
          parsed_hrv?: number | null
          parsed_rhr?: number | null
          parsed_sleep_hours?: number | null
          parsed_sleep_stages?: Json | null
          screenshot_url?: string
          user_id?: string
        }
        Relationships: []
      }
      shield_manual_inputs: {
        Row: {
          created_at: string
          entry_date: string
          hydration_ml: number
          id: string
          mood_emoji: string | null
          recovery_self_rating: number | null
          recovery_source: string | null
          sleep_hours: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          entry_date: string
          hydration_ml?: number
          id?: string
          mood_emoji?: string | null
          recovery_self_rating?: number | null
          recovery_source?: string | null
          sleep_hours?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          entry_date?: string
          hydration_ml?: number
          id?: string
          mood_emoji?: string | null
          recovery_self_rating?: number | null
          recovery_source?: string | null
          sleep_hours?: number | null
          user_id?: string
        }
        Relationships: []
      }
      shield_nutrition_logs: {
        Row: {
          calorie_estimate_status: string
          carb_quality_score: number | null
          claude_quality_score: number | null
          claude_score_status: string
          confirmed_items: Json | null
          correction_count: number
          created_at: string
          deleted: boolean
          entry_date: string
          estimated_calories: number | null
          estimated_carbs_g: number | null
          estimated_fat_g: number | null
          estimated_items: Json | null
          estimated_protein_g: number | null
          id: string
          meal_description: string | null
          meal_photo_url: string | null
          meal_slot: string | null
          original_estimated_calories: number | null
          original_estimated_carbs_g: number | null
          original_estimated_fat_g: number | null
          original_estimated_items: Json | null
          original_estimated_protein_g: number | null
          protein_tier: number | null
          timing_score: number | null
          updated_at: string
          user_confirmed_vision: boolean
          user_corrected: boolean
          user_id: string
          vision_confidence: number | null
          vision_detected_items: Json | null
          vision_provider: string | null
        }
        Insert: {
          calorie_estimate_status?: string
          carb_quality_score?: number | null
          claude_quality_score?: number | null
          claude_score_status?: string
          confirmed_items?: Json | null
          correction_count?: number
          created_at?: string
          deleted?: boolean
          entry_date: string
          estimated_calories?: number | null
          estimated_carbs_g?: number | null
          estimated_fat_g?: number | null
          estimated_items?: Json | null
          estimated_protein_g?: number | null
          id?: string
          meal_description?: string | null
          meal_photo_url?: string | null
          meal_slot?: string | null
          original_estimated_calories?: number | null
          original_estimated_carbs_g?: number | null
          original_estimated_fat_g?: number | null
          original_estimated_items?: Json | null
          original_estimated_protein_g?: number | null
          protein_tier?: number | null
          timing_score?: number | null
          updated_at?: string
          user_confirmed_vision?: boolean
          user_corrected?: boolean
          user_id: string
          vision_confidence?: number | null
          vision_detected_items?: Json | null
          vision_provider?: string | null
        }
        Update: {
          calorie_estimate_status?: string
          carb_quality_score?: number | null
          claude_quality_score?: number | null
          claude_score_status?: string
          confirmed_items?: Json | null
          correction_count?: number
          created_at?: string
          deleted?: boolean
          entry_date?: string
          estimated_calories?: number | null
          estimated_carbs_g?: number | null
          estimated_fat_g?: number | null
          estimated_items?: Json | null
          estimated_protein_g?: number | null
          id?: string
          meal_description?: string | null
          meal_photo_url?: string | null
          meal_slot?: string | null
          original_estimated_calories?: number | null
          original_estimated_carbs_g?: number | null
          original_estimated_fat_g?: number | null
          original_estimated_items?: Json | null
          original_estimated_protein_g?: number | null
          protein_tier?: number | null
          timing_score?: number | null
          updated_at?: string
          user_confirmed_vision?: boolean
          user_corrected?: boolean
          user_id?: string
          vision_confidence?: number | null
          vision_detected_items?: Json | null
          vision_provider?: string | null
        }
        Relationships: []
      }
      shield_training_logs: {
        Row: {
          created_at: string
          entry_date: string
          id: string
          session_notes: string | null
          strain_value: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          entry_date: string
          id?: string
          session_notes?: string | null
          strain_value?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          entry_date?: string
          id?: string
          session_notes?: string | null
          strain_value?: number | null
          user_id?: string
        }
        Relationships: []
      }
      weekly_plans: {
        Row: {
          created_at: string
          generated_by: string
          id: string
          is_locked: boolean
          plan_data: Json
          unlock_date: string
          user_id: string
          week_start_date: string
        }
        Insert: {
          created_at?: string
          generated_by?: string
          id?: string
          is_locked?: boolean
          plan_data: Json
          unlock_date: string
          user_id: string
          week_start_date: string
        }
        Update: {
          created_at?: string
          generated_by?: string
          id?: string
          is_locked?: boolean
          plan_data?: Json
          unlock_date?: string
          user_id?: string
          week_start_date?: string
        }
        Relationships: []
      }
      workout_set_logs: {
        Row: {
          completed: boolean
          created_at: string
          entry_date: string
          exercise_name: string
          id: string
          muscle_group: string | null
          reps_completed: number | null
          rest_seconds_actual: number | null
          rir: number | null
          rpe: number | null
          set_number: number
          target_reps: number | null
          target_weight_kg: number | null
          updated_at: string
          user_id: string
          weight_kg: number | null
        }
        Insert: {
          completed?: boolean
          created_at?: string
          entry_date: string
          exercise_name: string
          id?: string
          muscle_group?: string | null
          reps_completed?: number | null
          rest_seconds_actual?: number | null
          rir?: number | null
          rpe?: number | null
          set_number: number
          target_reps?: number | null
          target_weight_kg?: number | null
          updated_at?: string
          user_id: string
          weight_kg?: number | null
        }
        Update: {
          completed?: boolean
          created_at?: string
          entry_date?: string
          exercise_name?: string
          id?: string
          muscle_group?: string | null
          reps_completed?: number | null
          rest_seconds_actual?: number | null
          rir?: number | null
          rpe?: number | null
          set_number?: number
          target_reps?: number | null
          target_weight_kg?: number | null
          updated_at?: string
          user_id?: string
          weight_kg?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_onboarding_macros: {
        Args: {
          p_bmr: number
          p_effective_start_date: string
          p_formula_used: string
          p_target_calories: number
          p_target_carbs_g: number
          p_target_fat_g: number
          p_target_protein_g: number
          p_tdee: number
          p_user_id: string
        }
        Returns: string
      }
      apply_weekly_macro_review: {
        Args: {
          p_abnormal_week: boolean
          p_adherence_pct: number
          p_adjustment_kcal: number
          p_blended_tdee: number
          p_bmr: number
          p_confidence_tier: string
          p_days_logged: number
          p_decision: string
          p_effective_start_date: string
          p_eligible: boolean
          p_flag_reason: string
          p_new_observed_tdee: number
          p_new_target_calories: number
          p_old_observed_tdee: number
          p_old_target_calories: number
          p_raw_target_calories: number
          p_review_id: string
          p_target_carbs_g: number
          p_target_fat_g: number
          p_target_protein_g: number
          p_timezone_used: string
          p_user_id: string
          p_week_end_date: string
          p_week_start_date: string
          p_weigh_in_count: number
        }
        Returns: string
      }
      get_dispatch_secret: { Args: never; Returns: string }
      increment_hydration: { Args: { p_amount_ml: number }; Returns: number }
      restore_meal: {
        Args: { p_meal_id: string; p_user_id: string }
        Returns: undefined
      }
      shield_dispatch_calculate_score: {
        Args: { _entry_date: string; _user_id: string }
        Returns: undefined
      }
      shield_dispatch_parse_device_upload: {
        Args: { _entry_date: string; _upload_id: string; _user_id: string }
        Returns: undefined
      }
      shield_dispatch_score_nutrition: {
        Args: { _id: string }
        Returns: undefined
      }
      soft_delete_meal: {
        Args: { p_meal_id: string; p_user_id: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
