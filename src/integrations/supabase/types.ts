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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      ai_conversation_state: {
        Row: {
          ai_disabled_reason: string | null
          ai_paused_until: string | null
          auto_msg_count_window: number
          conversation_id: string
          conversation_summary: string | null
          id: string
          updated_at: string
          window_started_at: string
        }
        Insert: {
          ai_disabled_reason?: string | null
          ai_paused_until?: string | null
          auto_msg_count_window?: number
          conversation_id: string
          conversation_summary?: string | null
          id?: string
          updated_at?: string
          window_started_at?: string
        }
        Update: {
          ai_disabled_reason?: string | null
          ai_paused_until?: string | null
          auto_msg_count_window?: number
          conversation_id?: string
          conversation_summary?: string | null
          id?: string
          updated_at?: string
          window_started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_conversation_state_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: true
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_logs: {
        Row: {
          conversation_id: string | null
          created_at: string
          error_message: string | null
          id: string
          input_excerpt: string | null
          latency_ms: number | null
          model: string
          output_text: string | null
          prompt_version: string | null
          provider: string
          request_id: string | null
          status: string
          team_id: string | null
          tokens_in: number | null
          tokens_out: number | null
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          input_excerpt?: string | null
          latency_ms?: number | null
          model: string
          output_text?: string | null
          prompt_version?: string | null
          provider: string
          request_id?: string | null
          status?: string
          team_id?: string | null
          tokens_in?: number | null
          tokens_out?: number | null
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          input_excerpt?: string | null
          latency_ms?: number | null
          model?: string
          output_text?: string | null
          prompt_version?: string | null
          provider?: string
          request_id?: string | null
          status?: string
          team_id?: string | null
          tokens_in?: number | null
          tokens_out?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_logs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_logs_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_provider_configs: {
        Row: {
          active: boolean
          created_at: string
          id: string
          key_ref: string | null
          max_tokens: number | null
          model: string
          provider: string
          temperature: number | null
          top_p: number | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          key_ref?: string | null
          max_tokens?: number | null
          model: string
          provider: string
          temperature?: number | null
          top_p?: number | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          key_ref?: string | null
          max_tokens?: number | null
          model?: string
          provider?: string
          temperature?: number | null
          top_p?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      ai_settings: {
        Row: {
          anti_spam_seconds: number
          base_system_prompt: string
          created_at: string
          enable_auto_summary: boolean
          enabled_global: boolean
          fallback_offhours_message: string
          human_request_pause_hours: number
          id: string
          max_messages_per_hour: number
          memory_message_count: number
          policies_json: Json | null
          timezone: string
          updated_at: string
        }
        Insert: {
          anti_spam_seconds?: number
          base_system_prompt?: string
          created_at?: string
          enable_auto_summary?: boolean
          enabled_global?: boolean
          fallback_offhours_message?: string
          human_request_pause_hours?: number
          id?: string
          max_messages_per_hour?: number
          memory_message_count?: number
          policies_json?: Json | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          anti_spam_seconds?: number
          base_system_prompt?: string
          created_at?: string
          enable_auto_summary?: boolean
          enabled_global?: boolean
          fallback_offhours_message?: string
          human_request_pause_hours?: number
          id?: string
          max_messages_per_hour?: number
          memory_message_count?: number
          policies_json?: Json | null
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_team_settings: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          prompt_override: string | null
          schedule_json: Json
          team_id: string
          throttling_json: Json | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          prompt_override?: string | null
          schedule_json?: Json
          team_id: string
          throttling_json?: Json | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          prompt_override?: string | null
          schedule_json?: Json
          team_id?: string
          throttling_json?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_team_settings_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: true
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          chat_lid: string | null
          created_at: string
          group_name: string | null
          id: string
          is_group: boolean
          lid: string | null
          lid_collected_at: string | null
          lid_source: string | null
          name: string
          phone: string | null
          profile_picture_url: string | null
          tags: string[] | null
          updated_at: string
          whatsapp_display_name: string | null
        }
        Insert: {
          chat_lid?: string | null
          created_at?: string
          group_name?: string | null
          id?: string
          is_group?: boolean
          lid?: string | null
          lid_collected_at?: string | null
          lid_source?: string | null
          name: string
          phone?: string | null
          profile_picture_url?: string | null
          tags?: string[] | null
          updated_at?: string
          whatsapp_display_name?: string | null
        }
        Update: {
          chat_lid?: string | null
          created_at?: string
          group_name?: string | null
          id?: string
          is_group?: boolean
          lid?: string | null
          lid_collected_at?: string | null
          lid_source?: string | null
          name?: string
          phone?: string | null
          profile_picture_url?: string | null
          tags?: string[] | null
          updated_at?: string
          whatsapp_display_name?: string | null
        }
        Relationships: []
      }
      conversation_labels: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          label_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          label_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          label_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_labels_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_labels_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "labels"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_participant_state: {
        Row: {
          conversation_id: string
          created_at: string
          current_participant_id: string | null
          id: string
          identification_asked: boolean
          last_confirmed_at: string | null
          updated_at: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          current_participant_id?: string | null
          id?: string
          identification_asked?: boolean
          last_confirmed_at?: string | null
          updated_at?: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          current_participant_id?: string | null
          id?: string
          identification_asked?: boolean
          last_confirmed_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_participant_state_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: true
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_participant_state_current_participant_id_fkey"
            columns: ["current_participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_resolution: {
        Row: {
          approved_by: string | null
          category: string | null
          conversation_id: string | null
          created_at: string
          id: string
          resolution_steps: Json | null
          resolution_summary: string | null
          snippet_generated: boolean | null
          team_id: string | null
        }
        Insert: {
          approved_by?: string | null
          category?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          resolution_steps?: Json | null
          resolution_summary?: string | null
          snippet_generated?: boolean | null
          team_id?: string | null
        }
        Update: {
          approved_by?: string | null
          category?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          resolution_steps?: Json | null
          resolution_summary?: string | null
          snippet_generated?: boolean | null
          team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversation_resolution_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: true
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_resolution_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          assigned_to: string | null
          contact_id: string
          created_at: string
          id: string
          last_message_at: string | null
          marked_unread: boolean | null
          priority: string | null
          snoozed_until: string | null
          status: Database["public"]["Enums"]["conversation_status"]
          unread_count: number
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          contact_id: string
          created_at?: string
          id?: string
          last_message_at?: string | null
          marked_unread?: boolean | null
          priority?: string | null
          snoozed_until?: string | null
          status?: Database["public"]["Enums"]["conversation_status"]
          unread_count?: number
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          contact_id?: string
          created_at?: string
          id?: string
          last_message_at?: string | null
          marked_unread?: boolean | null
          priority?: string | null
          snoozed_until?: string | null
          status?: Database["public"]["Enums"]["conversation_status"]
          unread_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      entities: {
        Row: {
          created_at: string
          id: string
          name: string
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          type?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      kb_embeddings: {
        Row: {
          created_at: string
          embedding: string | null
          id: string
          model_name: string
          snippet_id: string | null
          team_id: string | null
        }
        Insert: {
          created_at?: string
          embedding?: string | null
          id?: string
          model_name?: string
          snippet_id?: string | null
          team_id?: string | null
        }
        Update: {
          created_at?: string
          embedding?: string | null
          id?: string
          model_name?: string
          snippet_id?: string | null
          team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kb_embeddings_snippet_id_fkey"
            columns: ["snippet_id"]
            isOneToOne: false
            referencedRelation: "kb_snippets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kb_embeddings_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_snippets: {
        Row: {
          approved: boolean
          category: string
          confidence_score: number | null
          created_at: string
          id: string
          problem_text: string
          solution_text: string
          source: string | null
          tags: Json | null
          team_id: string | null
          title: string
          updated_at: string
          used_count: number | null
        }
        Insert: {
          approved?: boolean
          category?: string
          confidence_score?: number | null
          created_at?: string
          id?: string
          problem_text: string
          solution_text: string
          source?: string | null
          tags?: Json | null
          team_id?: string | null
          title: string
          updated_at?: string
          used_count?: number | null
        }
        Update: {
          approved?: boolean
          category?: string
          confidence_score?: number | null
          created_at?: string
          id?: string
          problem_text?: string
          solution_text?: string
          source?: string | null
          tags?: Json | null
          team_id?: string | null
          title?: string
          updated_at?: string
          used_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "kb_snippets_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      labels: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      message_feedback: {
        Row: {
          conversation_id: string | null
          created_at: string
          created_by: string | null
          id: string
          message_id: string | null
          rating: string
          reason: string | null
          save_as_procedure: boolean | null
          team_id: string | null
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          message_id?: string | null
          rating: string
          reason?: string | null
          save_as_procedure?: boolean | null
          team_id?: string | null
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          message_id?: string | null
          rating?: string
          reason?: string | null
          save_as_procedure?: boolean | null
          team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "message_feedback_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_feedback_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_feedback_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string | null
          conversation_id: string
          delivered_at: string | null
          id: string
          media_url: string | null
          message_type: Database["public"]["Enums"]["message_type"]
          read_at: string | null
          sender_id: string | null
          sender_type: Database["public"]["Enums"]["sender_type"]
          sent_at: string
          whatsapp_message_id: string | null
        }
        Insert: {
          content?: string | null
          conversation_id: string
          delivered_at?: string | null
          id?: string
          media_url?: string | null
          message_type?: Database["public"]["Enums"]["message_type"]
          read_at?: string | null
          sender_id?: string | null
          sender_type: Database["public"]["Enums"]["sender_type"]
          sent_at?: string
          whatsapp_message_id?: string | null
        }
        Update: {
          content?: string | null
          conversation_id?: string
          delivered_at?: string | null
          id?: string
          media_url?: string | null
          message_type?: Database["public"]["Enums"]["message_type"]
          read_at?: string | null
          sender_id?: string | null
          sender_type?: Database["public"]["Enums"]["sender_type"]
          sent_at?: string
          whatsapp_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      participants: {
        Row: {
          confidence: number
          contact_id: string
          created_at: string
          entity_id: string | null
          id: string
          is_primary: boolean
          name: string
          role_type: string | null
          updated_at: string
        }
        Insert: {
          confidence?: number
          contact_id: string
          created_at?: string
          entity_id?: string | null
          id?: string
          is_primary?: boolean
          name: string
          role_type?: string | null
          updated_at?: string
        }
        Update: {
          confidence?: number
          contact_id?: string
          created_at?: string
          entity_id?: string | null
          id?: string
          is_primary?: boolean
          name?: string
          role_type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "participants_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "participants_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          id: string
          is_active: boolean
          name: string
          team_id: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          id: string
          is_active?: boolean
          name: string
          team_id?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          id?: string
          is_active?: boolean
          name?: string
          team_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_access_conversation: {
        Args: { _conversation_id: string; _user_id: string }
        Returns: boolean
      }
      cleanup_old_ai_logs: { Args: never; Returns: undefined }
      cleanup_old_messages: { Args: never; Returns: undefined }
      detect_display_name_type: {
        Args: { display_name: string }
        Returns: string
      }
      get_user_team_id: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      match_kb_snippets: {
        Args: {
          filter_team_id?: string
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          category: string
          id: string
          problem_text: string
          similarity: number
          snippet_id: string
          solution_text: string
          tags: Json
          title: string
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "agent"
      conversation_status: "open" | "resolved"
      message_type: "text" | "image" | "video" | "audio" | "document"
      sender_type: "contact" | "agent"
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
    Enums: {
      app_role: ["admin", "agent"],
      conversation_status: ["open", "resolved"],
      message_type: ["text", "image", "video", "audio", "document"],
      sender_type: ["contact", "agent"],
    },
  },
} as const
