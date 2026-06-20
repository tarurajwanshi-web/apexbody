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
      profiles: {
        Row: {
          created_at: string
          id: string
          input_path_preference: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          input_path_preference?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          input_path_preference?: string | null
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
          id: string
          mood_emoji: string | null
          recovery_self_rating: number | null
          sleep_hours: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          entry_date: string
          id?: string
          mood_emoji?: string | null
          recovery_self_rating?: number | null
          sleep_hours?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          entry_date?: string
          id?: string
          mood_emoji?: string | null
          recovery_self_rating?: number | null
          sleep_hours?: number | null
          user_id?: string
        }
        Relationships: []
      }
      shield_nutrition_logs: {
        Row: {
          claude_quality_score: number | null
          claude_score_status: string
          created_at: string
          entry_date: string
          id: string
          meal_description: string | null
          meal_photo_url: string | null
          user_id: string
        }
        Insert: {
          claude_quality_score?: number | null
          claude_score_status?: string
          created_at?: string
          entry_date: string
          id?: string
          meal_description?: string | null
          meal_photo_url?: string | null
          user_id: string
        }
        Update: {
          claude_quality_score?: number | null
          claude_score_status?: string
          created_at?: string
          entry_date?: string
          id?: string
          meal_description?: string | null
          meal_photo_url?: string | null
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
