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
      daily_macro_targets: {
        Row: {
          bmr: number
          calculated_at: string
          created_at: string
          formula_used: string
          id: string
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
          formula_used: string
          id?: string
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
          formula_used?: string
          id?: string
          target_calories?: number
          target_carbs_g?: number
          target_fat_g?: number
          target_protein_g?: number
          tdee?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
          biological_sex: string | null
          body_data_type: string | null
          created_at: string
          dexa_body_fat_pct: number | null
          dexa_lean_mass_kg: number | null
          disclaimer_accepted_at: string | null
          equipment_access: string | null
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
          training_days_per_week: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          age?: number | null
          biological_sex?: string | null
          body_data_type?: string | null
          created_at?: string
          dexa_body_fat_pct?: number | null
          dexa_lean_mass_kg?: number | null
          disclaimer_accepted_at?: string | null
          equipment_access?: string | null
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
          training_days_per_week?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          age?: number | null
          biological_sex?: string | null
          body_data_type?: string | null
          created_at?: string
          dexa_body_fat_pct?: number | null
          dexa_lean_mass_kg?: number | null
          disclaimer_accepted_at?: string | null
          equipment_access?: string | null
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
          training_days_per_week?: number | null
          updated_at?: string
          user_id?: string
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
          created_at: string
          deleted: boolean
          entry_date: string
          estimated_calories: number | null
          estimated_carbs_g: number | null
          estimated_fat_g: number | null
          estimated_protein_g: number | null
          id: string
          meal_description: string | null
          meal_photo_url: string | null
          protein_tier: number | null
          timing_score: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          calorie_estimate_status?: string
          carb_quality_score?: number | null
          claude_quality_score?: number | null
          claude_score_status?: string
          created_at?: string
          deleted?: boolean
          entry_date: string
          estimated_calories?: number | null
          estimated_carbs_g?: number | null
          estimated_fat_g?: number | null
          estimated_protein_g?: number | null
          id?: string
          meal_description?: string | null
          meal_photo_url?: string | null
          protein_tier?: number | null
          timing_score?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          calorie_estimate_status?: string
          carb_quality_score?: number | null
          claude_quality_score?: number | null
          claude_score_status?: string
          created_at?: string
          deleted?: boolean
          entry_date?: string
          estimated_calories?: number | null
          estimated_carbs_g?: number | null
          estimated_fat_g?: number | null
          estimated_protein_g?: number | null
          id?: string
          meal_description?: string | null
          meal_photo_url?: string | null
          protein_tier?: number | null
          timing_score?: number | null
          updated_at?: string
          user_id?: string
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
          reps_completed: number | null
          set_number: number
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
          reps_completed?: number | null
          set_number: number
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
          reps_completed?: number | null
          set_number?: number
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
      increment_hydration: { Args: { p_amount_ml: number }; Returns: number }
      shield_dispatch_calculate_score: {
        Args: { _entry_date: string; _user_id: string }
        Returns: undefined
      }
      shield_dispatch_parse_device_upload: {
        Args: { _entry_date: string; _upload_id: string; _user_id: string }
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
