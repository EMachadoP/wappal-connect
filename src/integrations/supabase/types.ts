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
      agents: {
        Row: {
          can_close_protocols: boolean
          created_at: string
          id: string
          is_active: boolean
          name: string
          phone: string | null
          profile_id: string | null
          role: string | null
          updated_at: string
        }
        Insert: {
          can_close_protocols?: boolean
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          phone?: string | null
          profile_id?: string | null
          role?: string | null
          updated_at?: string
        }
        Update: {
          can_close_protocols?: boolean
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          phone?: string | null
          profile_id?: string | null
          role?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agents_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_conversation_locks: {
        Row: {
          conversation_id: string
          locked_at: string
        }
        Insert: {
          conversation_id: string
          locked_at?: string
        }
        Update: {
          conversation_id?: string
          locked_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_conversation_locks_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: true
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_conversation_state: {
        Row: {
          ai_disabled_reason: string | null
          ai_paused_until: string | null
          auto_msg_count_window: number
          bot_detection_triggered: boolean | null
          bot_likelihood: number | null
          consecutive_auto_msgs: number | null
          conversation_id: string
          conversation_summary: string | null
          id: string
          last_human_inbound_at: string | null
          updated_at: string
          window_started_at: string
        }
        Insert: {
          ai_disabled_reason?: string | null
          ai_paused_until?: string | null
          auto_msg_count_window?: number
          bot_detection_triggered?: boolean | null
          bot_likelihood?: number | null
          consecutive_auto_msgs?: number | null
          conversation_id: string
          conversation_summary?: string | null
          id?: string
          last_human_inbound_at?: string | null
          updated_at?: string
          window_started_at?: string
        }
        Update: {
          ai_disabled_reason?: string | null
          ai_paused_until?: string | null
          auto_msg_count_window?: number
          bot_detection_triggered?: boolean | null
          bot_likelihood?: number | null
          consecutive_auto_msgs?: number | null
          conversation_id?: string
          conversation_summary?: string | null
          id?: string
          last_human_inbound_at?: string | null
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
      ai_events: {
        Row: {
          conversation_id: string
          created_at: string | null
          created_by: string | null
          event_type: string
          id: string
          message: string | null
          metadata: Json | null
        }
        Insert: {
          conversation_id: string
          created_at?: string | null
          created_by?: string | null
          event_type: string
          id?: string
          message?: string | null
          metadata?: Json | null
        }
        Update: {
          conversation_id?: string
          created_at?: string | null
          created_by?: string | null
          event_type?: string
          id?: string
          message?: string | null
          metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_events_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
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
          meta: Json | null
          model: string
          output_text: string | null
          prompt_version: string | null
          provider: string
          request_id: string | null
          skip_reason: string | null
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
          meta?: Json | null
          model: string
          output_text?: string | null
          prompt_version?: string | null
          provider: string
          request_id?: string | null
          skip_reason?: string | null
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
          meta?: Json | null
          model?: string
          output_text?: string | null
          prompt_version?: string | null
          provider?: string
          request_id?: string | null
          skip_reason?: string | null
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
          schedule_json: Json | null
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
          schedule_json?: Json | null
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
          schedule_json?: Json | null
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
      ai_usage_logs: {
        Row: {
          conversation_id: string | null
          cost_usd: number | null
          created_at: string
          estimated: boolean | null
          id: string
          input_tokens: number
          latency_ms: number | null
          message_id: string | null
          mode: string
          model: string
          output_tokens: number
          provider: string
          team_id: string | null
          total_tokens: number | null
          user_id: string | null
        }
        Insert: {
          conversation_id?: string | null
          cost_usd?: number | null
          created_at?: string
          estimated?: boolean | null
          id?: string
          input_tokens?: number
          latency_ms?: number | null
          message_id?: string | null
          mode?: string
          model: string
          output_tokens?: number
          provider: string
          team_id?: string | null
          total_tokens?: number | null
          user_id?: string | null
        }
        Update: {
          conversation_id?: string | null
          cost_usd?: number | null
          created_at?: string
          estimated?: boolean | null
          id?: string
          input_tokens?: number
          latency_ms?: number | null
          message_id?: string | null
          mode?: string
          model?: string
          output_tokens?: number
          provider?: string
          team_id?: string | null
          total_tokens?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_logs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_logs_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_logs_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string | null
          entity_id: string | null
          entity_type: string
          id: string
          ip_address: string | null
          new_data: Json | null
          old_data: Json | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string | null
          entity_id?: string | null
          entity_type: string
          id?: string
          ip_address?: string | null
          new_data?: Json | null
          old_data?: Json | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          ip_address?: string | null
          new_data?: Json | null
          old_data?: Json | null
        }
        Relationships: []
      }
      condominiums: {
        Row: {
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      contact_aliases: {
        Row: {
          alias_key: string
          contact_id: string
          created_at: string
        }
        Insert: {
          alias_key: string
          contact_id: string
          created_at?: string
        }
        Update: {
          alias_key?: string
          contact_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_aliases_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_condominiums: {
        Row: {
          condominium_id: string
          contact_id: string
          created_at: string
          id: string
          is_default: boolean
        }
        Insert: {
          condominium_id: string
          contact_id: string
          created_at?: string
          id?: string
          is_default?: boolean
        }
        Update: {
          condominium_id?: string
          contact_id?: string
          created_at?: string
          id?: string
          is_default?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "contact_condominiums_condominium_id_fkey"
            columns: ["condominium_id"]
            isOneToOne: false
            referencedRelation: "condominiums"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_condominiums_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_merge_map: {
        Row: {
          chat_key: string | null
          id: string
          merged_at: string | null
          new_contact_id: string | null
          old_contact_id: string | null
        }
        Insert: {
          chat_key?: string | null
          id?: string
          merged_at?: string | null
          new_contact_id?: string | null
          old_contact_id?: string | null
        }
        Update: {
          chat_key?: string | null
          id?: string
          merged_at?: string | null
          new_contact_id?: string | null
          old_contact_id?: string | null
        }
        Relationships: []
      }
      contacts: {
        Row: {
          chat_key: string | null
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
          chat_key?: string | null
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
          chat_key?: string | null
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
      contacts_backup_20260115: {
        Row: {
          chat_key: string | null
          chat_lid: string | null
          created_at: string | null
          group_name: string | null
          id: string | null
          is_group: boolean | null
          lid: string | null
          lid_collected_at: string | null
          lid_source: string | null
          name: string | null
          phone: string | null
          profile_picture_url: string | null
          tags: string[] | null
          updated_at: string | null
          whatsapp_display_name: string | null
        }
        Insert: {
          chat_key?: string | null
          chat_lid?: string | null
          created_at?: string | null
          group_name?: string | null
          id?: string | null
          is_group?: boolean | null
          lid?: string | null
          lid_collected_at?: string | null
          lid_source?: string | null
          name?: string | null
          phone?: string | null
          profile_picture_url?: string | null
          tags?: string[] | null
          updated_at?: string | null
          whatsapp_display_name?: string | null
        }
        Update: {
          chat_key?: string | null
          chat_lid?: string | null
          created_at?: string | null
          group_name?: string | null
          id?: string | null
          is_group?: boolean | null
          lid?: string | null
          lid_collected_at?: string | null
          lid_source?: string | null
          name?: string | null
          phone?: string | null
          profile_picture_url?: string | null
          tags?: string[] | null
          updated_at?: string | null
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
          last_read_at: string | null
          last_read_message_id: string | null
          updated_at: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          current_participant_id?: string | null
          id?: string
          identification_asked?: boolean
          last_confirmed_at?: string | null
          last_read_at?: string | null
          last_read_message_id?: string | null
          updated_at?: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          current_participant_id?: string | null
          id?: string
          identification_asked?: boolean
          last_confirmed_at?: string | null
          last_read_at?: string | null
          last_read_message_id?: string | null
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
          {
            foreignKeyName: "conversation_participant_state_last_read_message_id_fkey"
            columns: ["last_read_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
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
          active_condominium_confidence: number | null
          active_condominium_id: string | null
          active_condominium_set_at: string | null
          active_condominium_set_by: string | null
          ai_mode: string | null
          ai_paused_until: string | null
          assigned_at: string | null
          assigned_by: string | null
          assigned_to: string | null
          chat_id: string | null
          contact_id: string | null
          created_at: string
          human_control: boolean | null
          human_control_at: string | null
          id: string
          is_group: boolean | null
          last_human_message_at: string | null
          last_message: string | null
          last_message_at: string | null
          last_message_type: string | null
          marked_unread: boolean | null
          pending_field: string | null
          pending_payload: Json | null
          pending_set_at: string | null
          priority: string | null
          processing_token: string | null
          processing_until: string | null
          protocol: string | null
          reopened_at: string | null
          reopened_by: string | null
          resolved_at: string | null
          resolved_by: string | null
          snoozed_until: string | null
          status: Database["public"]["Enums"]["conversation_status"]
          thread_key: string
          title: string | null
          typing_by_user_id: string | null
          typing_lock_until: string | null
          unread_count: number
          updated_at: string
        }
        Insert: {
          active_condominium_confidence?: number | null
          active_condominium_id?: string | null
          active_condominium_set_at?: string | null
          active_condominium_set_by?: string | null
          ai_mode?: string | null
          ai_paused_until?: string | null
          assigned_at?: string | null
          assigned_by?: string | null
          assigned_to?: string | null
          chat_id?: string | null
          contact_id?: string | null
          created_at?: string
          human_control?: boolean | null
          human_control_at?: string | null
          id?: string
          is_group?: boolean | null
          last_human_message_at?: string | null
          last_message?: string | null
          last_message_at?: string | null
          last_message_type?: string | null
          marked_unread?: boolean | null
          pending_field?: string | null
          pending_payload?: Json | null
          pending_set_at?: string | null
          priority?: string | null
          processing_token?: string | null
          processing_until?: string | null
          protocol?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          snoozed_until?: string | null
          status?: Database["public"]["Enums"]["conversation_status"]
          thread_key: string
          title?: string | null
          typing_by_user_id?: string | null
          typing_lock_until?: string | null
          unread_count?: number
          updated_at?: string
        }
        Update: {
          active_condominium_confidence?: number | null
          active_condominium_id?: string | null
          active_condominium_set_at?: string | null
          active_condominium_set_by?: string | null
          ai_mode?: string | null
          ai_paused_until?: string | null
          assigned_at?: string | null
          assigned_by?: string | null
          assigned_to?: string | null
          chat_id?: string | null
          contact_id?: string | null
          created_at?: string
          human_control?: boolean | null
          human_control_at?: string | null
          id?: string
          is_group?: boolean | null
          last_human_message_at?: string | null
          last_message?: string | null
          last_message_at?: string | null
          last_message_type?: string | null
          marked_unread?: boolean | null
          pending_field?: string | null
          pending_payload?: Json | null
          pending_set_at?: string | null
          priority?: string | null
          processing_token?: string | null
          processing_until?: string | null
          protocol?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          snoozed_until?: string | null
          status?: Database["public"]["Enums"]["conversation_status"]
          thread_key?: string
          title?: string | null
          typing_by_user_id?: string | null
          typing_lock_until?: string | null
          unread_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_active_condominium_id_fkey"
            columns: ["active_condominium_id"]
            isOneToOne: false
            referencedRelation: "condominiums"
            referencedColumns: ["id"]
          },
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
      conversations_backup_20260115: {
        Row: {
          active_condominium_confidence: number | null
          active_condominium_id: string | null
          active_condominium_set_at: string | null
          active_condominium_set_by: string | null
          ai_mode: string | null
          ai_paused_until: string | null
          assigned_at: string | null
          assigned_by: string | null
          assigned_to: string | null
          chat_id: string | null
          contact_id: string | null
          created_at: string | null
          human_control: boolean | null
          id: string | null
          last_message: string | null
          last_message_at: string | null
          last_message_type: string | null
          marked_unread: boolean | null
          priority: string | null
          protocol: string | null
          reopened_at: string | null
          reopened_by: string | null
          resolved_at: string | null
          resolved_by: string | null
          snoozed_until: string | null
          status: Database["public"]["Enums"]["conversation_status"] | null
          thread_key: string | null
          typing_by_user_id: string | null
          typing_lock_until: string | null
          unread_count: number | null
          updated_at: string | null
        }
        Insert: {
          active_condominium_confidence?: number | null
          active_condominium_id?: string | null
          active_condominium_set_at?: string | null
          active_condominium_set_by?: string | null
          ai_mode?: string | null
          ai_paused_until?: string | null
          assigned_at?: string | null
          assigned_by?: string | null
          assigned_to?: string | null
          chat_id?: string | null
          contact_id?: string | null
          created_at?: string | null
          human_control?: boolean | null
          id?: string | null
          last_message?: string | null
          last_message_at?: string | null
          last_message_type?: string | null
          marked_unread?: boolean | null
          priority?: string | null
          protocol?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          snoozed_until?: string | null
          status?: Database["public"]["Enums"]["conversation_status"] | null
          thread_key?: string | null
          typing_by_user_id?: string | null
          typing_lock_until?: string | null
          unread_count?: number | null
          updated_at?: string | null
        }
        Update: {
          active_condominium_confidence?: number | null
          active_condominium_id?: string | null
          active_condominium_set_at?: string | null
          active_condominium_set_by?: string | null
          ai_mode?: string | null
          ai_paused_until?: string | null
          assigned_at?: string | null
          assigned_by?: string | null
          assigned_to?: string | null
          chat_id?: string | null
          contact_id?: string | null
          created_at?: string | null
          human_control?: boolean | null
          id?: string | null
          last_message?: string | null
          last_message_at?: string | null
          last_message_type?: string | null
          marked_unread?: boolean | null
          priority?: string | null
          protocol?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          snoozed_until?: string | null
          status?: Database["public"]["Enums"]["conversation_status"] | null
          thread_key?: string | null
          typing_by_user_id?: string | null
          typing_lock_until?: string | null
          unread_count?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      employee_phones: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          phone: string
          profile_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          phone: string
          profile_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          phone?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_phones_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      integrations_settings: {
        Row: {
          asana_enabled: boolean
          asana_project_id: string | null
          asana_section_admin: string | null
          asana_section_financeiro: string | null
          asana_section_operacional: string | null
          asana_section_support: string | null
          created_at: string
          id: string
          updated_at: string
          whatsapp_group_id: string | null
          whatsapp_notifications_enabled: boolean
        }
        Insert: {
          asana_enabled?: boolean
          asana_project_id?: string | null
          asana_section_admin?: string | null
          asana_section_financeiro?: string | null
          asana_section_operacional?: string | null
          asana_section_support?: string | null
          created_at?: string
          id?: string
          updated_at?: string
          whatsapp_group_id?: string | null
          whatsapp_notifications_enabled?: boolean
        }
        Update: {
          asana_enabled?: boolean
          asana_project_id?: string | null
          asana_section_admin?: string | null
          asana_section_financeiro?: string | null
          asana_section_operacional?: string | null
          asana_section_support?: string | null
          created_at?: string
          id?: string
          updated_at?: string
          whatsapp_group_id?: string | null
          whatsapp_notifications_enabled?: boolean
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
      material_requests: {
        Row: {
          created_at: string
          id: string
          items: Json
          status: string
          work_item_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          items?: Json
          status?: string
          work_item_id: string
        }
        Update: {
          created_at?: string
          id?: string
          items?: Json
          status?: string
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "material_requests_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "protocol_work_items"
            referencedColumns: ["id"]
          },
        ]
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
      message_outbox: {
        Row: {
          conversation_id: string | null
          created_at: string | null
          error: string | null
          id: string
          idempotency_key: string
          payload: Json
          provider: string
          provider_message_id: string | null
          recipient: string
          sent_at: string | null
          status: string
          to_chat_id: string | null
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string | null
          error?: string | null
          id?: string
          idempotency_key: string
          payload: Json
          provider?: string
          provider_message_id?: string | null
          recipient: string
          sent_at?: string | null
          status?: string
          to_chat_id?: string | null
        }
        Update: {
          conversation_id?: string | null
          created_at?: string | null
          error?: string | null
          id?: string
          idempotency_key?: string
          payload?: Json
          provider?: string
          provider_message_id?: string | null
          recipient?: string
          sent_at?: string | null
          status?: string
          to_chat_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "message_outbox_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          agent_id: string | null
          agent_name: string | null
          chat_id: string | null
          client_message_id: string | null
          content: string | null
          conversation_id: string
          created_at: string
          delivered_at: string | null
          direction: string | null
          id: string
          media_url: string | null
          message_type: Database["public"]["Enums"]["message_type"]
          provider: string | null
          provider_message_id: string
          raw_payload: Json | null
          read_at: string | null
          sender_id: string | null
          sender_name: string | null
          sender_phone: string | null
          sender_type: Database["public"]["Enums"]["sender_type"]
          sent_at: string
          status: string | null
          transcribed_at: string | null
          transcript: string | null
          transcript_provider: string | null
          whatsapp_message_id: string | null
        }
        Insert: {
          agent_id?: string | null
          agent_name?: string | null
          chat_id?: string | null
          client_message_id?: string | null
          content?: string | null
          conversation_id: string
          created_at?: string
          delivered_at?: string | null
          direction?: string | null
          id?: string
          media_url?: string | null
          message_type?: Database["public"]["Enums"]["message_type"]
          provider?: string | null
          provider_message_id: string
          raw_payload?: Json | null
          read_at?: string | null
          sender_id?: string | null
          sender_name?: string | null
          sender_phone?: string | null
          sender_type: Database["public"]["Enums"]["sender_type"]
          sent_at?: string
          status?: string | null
          transcribed_at?: string | null
          transcript?: string | null
          transcript_provider?: string | null
          whatsapp_message_id?: string | null
        }
        Update: {
          agent_id?: string | null
          agent_name?: string | null
          chat_id?: string | null
          client_message_id?: string | null
          content?: string | null
          conversation_id?: string
          created_at?: string
          delivered_at?: string | null
          direction?: string | null
          id?: string
          media_url?: string | null
          message_type?: Database["public"]["Enums"]["message_type"]
          provider?: string | null
          provider_message_id?: string
          raw_payload?: Json | null
          read_at?: string | null
          sender_id?: string | null
          sender_name?: string | null
          sender_phone?: string | null
          sender_type?: Database["public"]["Enums"]["sender_type"]
          sent_at?: string
          status?: string | null
          transcribed_at?: string | null
          transcript?: string | null
          transcript_provider?: string | null
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
      messages_backup_20260115: {
        Row: {
          agent_id: string | null
          agent_name: string | null
          chat_id: string | null
          client_message_id: string | null
          content: string | null
          conversation_id: string | null
          delivered_at: string | null
          direction: string | null
          id: string | null
          media_url: string | null
          message_type: Database["public"]["Enums"]["message_type"] | null
          provider: string | null
          provider_message_id: string | null
          raw_payload: Json | null
          read_at: string | null
          sender_id: string | null
          sender_name: string | null
          sender_phone: string | null
          sender_type: Database["public"]["Enums"]["sender_type"] | null
          sent_at: string | null
          status: string | null
          transcribed_at: string | null
          transcript: string | null
          transcript_provider: string | null
          whatsapp_message_id: string | null
        }
        Insert: {
          agent_id?: string | null
          agent_name?: string | null
          chat_id?: string | null
          client_message_id?: string | null
          content?: string | null
          conversation_id?: string | null
          delivered_at?: string | null
          direction?: string | null
          id?: string | null
          media_url?: string | null
          message_type?: Database["public"]["Enums"]["message_type"] | null
          provider?: string | null
          provider_message_id?: string | null
          raw_payload?: Json | null
          read_at?: string | null
          sender_id?: string | null
          sender_name?: string | null
          sender_phone?: string | null
          sender_type?: Database["public"]["Enums"]["sender_type"] | null
          sent_at?: string | null
          status?: string | null
          transcribed_at?: string | null
          transcript?: string | null
          transcript_provider?: string | null
          whatsapp_message_id?: string | null
        }
        Update: {
          agent_id?: string | null
          agent_name?: string | null
          chat_id?: string | null
          client_message_id?: string | null
          content?: string | null
          conversation_id?: string | null
          delivered_at?: string | null
          direction?: string | null
          id?: string | null
          media_url?: string | null
          message_type?: Database["public"]["Enums"]["message_type"] | null
          provider?: string | null
          provider_message_id?: string | null
          raw_payload?: Json | null
          read_at?: string | null
          sender_id?: string | null
          sender_name?: string | null
          sender_phone?: string | null
          sender_type?: Database["public"]["Enums"]["sender_type"] | null
          sent_at?: string | null
          status?: string | null
          transcribed_at?: string | null
          transcript?: string | null
          transcript_provider?: string | null
          whatsapp_message_id?: string | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          conversation_id: string | null
          created_at: string
          dedupe_key: string
          error_message: string | null
          id: string
          notification_type: string
          sent_at: string | null
          status: string
          zapi_response_id: string | null
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          dedupe_key: string
          error_message?: string | null
          id?: string
          notification_type?: string
          sent_at?: string | null
          status?: string
          zapi_response_id?: string | null
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          dedupe_key?: string
          error_message?: string | null
          id?: string
          notification_type?: string
          sent_at?: string | null
          status?: string
          zapi_response_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_conversation_id_fkey"
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
      participants_backup_20260115: {
        Row: {
          confidence: number | null
          contact_id: string | null
          created_at: string | null
          entity_id: string | null
          id: string | null
          is_primary: boolean | null
          name: string | null
          role_type: string | null
          updated_at: string | null
        }
        Insert: {
          confidence?: number | null
          contact_id?: string | null
          created_at?: string | null
          entity_id?: string | null
          id?: string | null
          is_primary?: boolean | null
          name?: string | null
          role_type?: string | null
          updated_at?: string | null
        }
        Update: {
          confidence?: number | null
          contact_id?: string | null
          created_at?: string | null
          entity_id?: string | null
          id?: string | null
          is_primary?: boolean | null
          name?: string | null
          role_type?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      plan_items: {
        Row: {
          assignment_group_id: string | null
          condominium_id: string | null
          created_at: string
          created_by: string | null
          end_minute: number
          id: string
          is_fixed: boolean | null
          manual_notes: string | null
          manual_title: string | null
          plan_date: string
          sequence: number
          source: string | null
          start_minute: number
          technician_id: string
          work_item_id: string | null
        }
        Insert: {
          assignment_group_id?: string | null
          condominium_id?: string | null
          created_at?: string
          created_by?: string | null
          end_minute: number
          id?: string
          is_fixed?: boolean | null
          manual_notes?: string | null
          manual_title?: string | null
          plan_date: string
          sequence?: number
          source?: string | null
          start_minute: number
          technician_id: string
          work_item_id?: string | null
        }
        Update: {
          assignment_group_id?: string | null
          condominium_id?: string | null
          created_at?: string
          created_by?: string | null
          end_minute?: number
          id?: string
          is_fixed?: boolean | null
          manual_notes?: string | null
          manual_title?: string | null
          plan_date?: string
          sequence?: number
          source?: string | null
          start_minute?: number
          technician_id?: string
          work_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plan_items_condominium_id_fkey"
            columns: ["condominium_id"]
            isOneToOne: false
            referencedRelation: "condominiums"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_items_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "technicians"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_items_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "protocol_work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      planner_locks: {
        Row: {
          id: number
          lock_key: string
          locked_at: string
        }
        Insert: {
          id?: number
          lock_key: string
          locked_at?: string
        }
        Update: {
          id?: number
          lock_key?: string
          locked_at?: string
        }
        Relationships: []
      }
      profile_whatsapp_ids: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          profile_id: string
          wa_id: string
          wa_type: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          profile_id: string
          wa_id: string
          wa_type?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          profile_id?: string
          wa_id?: string
          wa_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_whatsapp_ids_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
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
          display_name?: string | null
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
          display_name?: string | null
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
      protocol_notifications: {
        Row: {
          channel: string
          created_at: string | null
          error: string | null
          id: string
          protocol_id: string
          recipient: string | null
          sent_at: string
          status: string | null
        }
        Insert: {
          channel: string
          created_at?: string | null
          error?: string | null
          id?: string
          protocol_id: string
          recipient?: string | null
          sent_at?: string
          status?: string | null
        }
        Update: {
          channel?: string
          created_at?: string | null
          error?: string | null
          id?: string
          protocol_id?: string
          recipient?: string | null
          sent_at?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "protocol_notifications_protocol_id_fkey"
            columns: ["protocol_id"]
            isOneToOne: false
            referencedRelation: "protocols"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protocol_notifications_protocol_id_fkey"
            columns: ["protocol_id"]
            isOneToOne: false
            referencedRelation: "v_planning_week"
            referencedColumns: ["protocol_id"]
          },
        ]
      }
      protocol_sequences: {
        Row: {
          created_at: string | null
          last_sequence: number
          updated_at: string | null
          year_month: string
        }
        Insert: {
          created_at?: string | null
          last_sequence?: number
          updated_at?: string | null
          year_month: string
        }
        Update: {
          created_at?: string | null
          last_sequence?: number
          updated_at?: string | null
          year_month?: string
        }
        Relationships: []
      }
      protocol_work_items: {
        Row: {
          assignment_group_id: string | null
          category: string
          created_at: string
          criticality: string
          due_date: string | null
          estimated_minutes: number
          id: string
          location_text: string | null
          priority: string
          protocol_id: string
          required_people: number
          required_skill_codes: string[]
          sla_business_days: number
          status: string
          title: string
        }
        Insert: {
          assignment_group_id?: string | null
          category: string
          created_at?: string
          criticality?: string
          due_date?: string | null
          estimated_minutes?: number
          id?: string
          location_text?: string | null
          priority?: string
          protocol_id: string
          required_people?: number
          required_skill_codes?: string[]
          sla_business_days?: number
          status?: string
          title: string
        }
        Update: {
          assignment_group_id?: string | null
          category?: string
          created_at?: string
          criticality?: string
          due_date?: string | null
          estimated_minutes?: number
          id?: string
          location_text?: string | null
          priority?: string
          protocol_id?: string
          required_people?: number
          required_skill_codes?: string[]
          sla_business_days?: number
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "protocol_work_items_protocol_id_fkey"
            columns: ["protocol_id"]
            isOneToOne: false
            referencedRelation: "protocols"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protocol_work_items_protocol_id_fkey"
            columns: ["protocol_id"]
            isOneToOne: false
            referencedRelation: "v_planning_week"
            referencedColumns: ["protocol_id"]
          },
        ]
      }
      protocols: {
        Row: {
          ai_classified: boolean | null
          ai_confidence: number | null
          ai_summary: string | null
          apartment: string | null
          asana_task_gid: string | null
          category: string | null
          condominium_id: string | null
          condominium_raw_name: string | null
          contact_id: string | null
          conversation_id: string | null
          created_at: string
          created_by_agent_id: string | null
          created_by_type: string | null
          customer_text: string | null
          due_date: string | null
          id: string
          participant_id: string | null
          priority: string
          protocol_code: string
          requester_name: string | null
          requester_role: string | null
          resolved_at: string | null
          resolved_by_agent_id: string | null
          resolved_by_name: string | null
          status: string
          summary: string | null
          tags: string[] | null
          updated_at: string
          whatsapp_group_message_id: string | null
        }
        Insert: {
          ai_classified?: boolean | null
          ai_confidence?: number | null
          ai_summary?: string | null
          apartment?: string | null
          asana_task_gid?: string | null
          category?: string | null
          condominium_id?: string | null
          condominium_raw_name?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by_agent_id?: string | null
          created_by_type?: string | null
          customer_text?: string | null
          due_date?: string | null
          id?: string
          participant_id?: string | null
          priority?: string
          protocol_code: string
          requester_name?: string | null
          requester_role?: string | null
          resolved_at?: string | null
          resolved_by_agent_id?: string | null
          resolved_by_name?: string | null
          status?: string
          summary?: string | null
          tags?: string[] | null
          updated_at?: string
          whatsapp_group_message_id?: string | null
        }
        Update: {
          ai_classified?: boolean | null
          ai_confidence?: number | null
          ai_summary?: string | null
          apartment?: string | null
          asana_task_gid?: string | null
          category?: string | null
          condominium_id?: string | null
          condominium_raw_name?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by_agent_id?: string | null
          created_by_type?: string | null
          customer_text?: string | null
          due_date?: string | null
          id?: string
          participant_id?: string | null
          priority?: string
          protocol_code?: string
          requester_name?: string | null
          requester_role?: string | null
          resolved_at?: string | null
          resolved_by_agent_id?: string | null
          resolved_by_name?: string | null
          status?: string
          summary?: string | null
          tags?: string[] | null
          updated_at?: string
          whatsapp_group_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "protocols_condominium_id_fkey"
            columns: ["condominium_id"]
            isOneToOne: false
            referencedRelation: "condominiums"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protocols_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protocols_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protocols_created_by_agent_id_fkey"
            columns: ["created_by_agent_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protocols_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
      skills: {
        Row: {
          code: string
          id: string
          label: string
        }
        Insert: {
          code: string
          id?: string
          label: string
        }
        Update: {
          code?: string
          id?: string
          label?: string
        }
        Relationships: []
      }
      system_alerts: {
        Row: {
          created_at: string | null
          id: string
          is_resolved: boolean | null
          level: string
          message: string
          metadata: Json | null
          source: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_resolved?: boolean | null
          level: string
          message: string
          metadata?: Json | null
          source: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_resolved?: boolean | null
          level?: string
          message?: string
          metadata?: Json | null
          source?: string
        }
        Relationships: []
      }
      task_templates: {
        Row: {
          active: boolean
          category: string
          created_at: string
          criticality: string
          default_materials: Json
          default_minutes: number
          id: string
          match_keywords: string[] | null
          match_priority: number | null
          required_people: number
          required_skill_codes: string[]
          sla_business_days: number
          title: string
        }
        Insert: {
          active?: boolean
          category: string
          created_at?: string
          criticality?: string
          default_materials?: Json
          default_minutes?: number
          id?: string
          match_keywords?: string[] | null
          match_priority?: number | null
          required_people?: number
          required_skill_codes?: string[]
          sla_business_days?: number
          title: string
        }
        Update: {
          active?: boolean
          category?: string
          created_at?: string
          criticality?: string
          default_materials?: Json
          default_minutes?: number
          id?: string
          match_keywords?: string[] | null
          match_priority?: number | null
          required_people?: number
          required_skill_codes?: string[]
          sla_business_days?: number
          title?: string
        }
        Relationships: []
      }
      tasks: {
        Row: {
          assignee_id: string | null
          completed_at: string | null
          conversation_id: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          due_at: string | null
          external_ref: string | null
          first_action_at: string | null
          id: string
          last_action_at: string | null
          priority: string
          remind_at: string | null
          started_at: string | null
          status: string
          title: string
          updated_at: string | null
        }
        Insert: {
          assignee_id?: string | null
          completed_at?: string | null
          conversation_id?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          external_ref?: string | null
          first_action_at?: string | null
          id?: string
          last_action_at?: string | null
          priority?: string
          remind_at?: string | null
          started_at?: string | null
          status?: string
          title: string
          updated_at?: string | null
        }
        Update: {
          assignee_id?: string | null
          completed_at?: string | null
          conversation_id?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          external_ref?: string | null
          first_action_at?: string | null
          id?: string
          last_action_at?: string | null
          priority?: string
          remind_at?: string | null
          started_at?: string | null
          status?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      technician_skills: {
        Row: {
          level: number
          skill_id: string
          technician_id: string
        }
        Insert: {
          level?: number
          skill_id: string
          technician_id: string
        }
        Update: {
          level?: number
          skill_id?: string
          technician_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "technician_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technician_skills_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "technicians"
            referencedColumns: ["id"]
          },
        ]
      }
      technicians: {
        Row: {
          created_at: string
          dispatch_priority: number
          id: string
          is_active: boolean
          is_wildcard: boolean
          name: string
        }
        Insert: {
          created_at?: string
          dispatch_priority?: number
          id?: string
          is_active?: boolean
          is_wildcard?: boolean
          name: string
        }
        Update: {
          created_at?: string
          dispatch_priority?: number
          id?: string
          is_active?: boolean
          is_wildcard?: boolean
          name?: string
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
      zapi_settings: {
        Row: {
          created_at: string
          enable_group_notifications: boolean
          forward_webhook_url: string | null
          id: string
          last_webhook_received_at: string | null
          open_tickets_group_id: string | null
          team_id: string | null
          updated_at: string
          zapi_instance_id: string | null
          zapi_security_token: string | null
          zapi_token: string | null
        }
        Insert: {
          created_at?: string
          enable_group_notifications?: boolean
          forward_webhook_url?: string | null
          id?: string
          last_webhook_received_at?: string | null
          open_tickets_group_id?: string | null
          team_id?: string | null
          updated_at?: string
          zapi_instance_id?: string | null
          zapi_security_token?: string | null
          zapi_token?: string | null
        }
        Update: {
          created_at?: string
          enable_group_notifications?: boolean
          forward_webhook_url?: string | null
          id?: string
          last_webhook_received_at?: string | null
          open_tickets_group_id?: string | null
          team_id?: string | null
          updated_at?: string
          zapi_instance_id?: string | null
          zapi_security_token?: string | null
          zapi_token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "zapi_settings_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: true
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      task_metrics_dashboard: {
        Row: {
          avg_resolution_seconds_7d: number | null
          done_today: number | null
          followups_due: number | null
          open_tasks: number | null
          overdue_tasks: number | null
        }
        Relationships: []
      }
      v_planning_week: {
        Row: {
          assignment_group_id: string | null
          condominium_id: string | null
          condominium_name: string | null
          conversation_id: string | null
          end_minute: number | null
          estimated_minutes: number | null
          id: string | null
          is_fixed: boolean | null
          manual_notes: string | null
          manual_title: string | null
          plan_date: string | null
          protocol_code: string | null
          protocol_id: string | null
          protocol_summary: string | null
          sequence: number | null
          source: string | null
          start_minute: number | null
          technician_id: string | null
          technician_name: string | null
          work_item_category: string | null
          work_item_id: string | null
          work_item_priority: string | null
          work_item_status: string | null
          work_item_title: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plan_items_condominium_id_fkey"
            columns: ["condominium_id"]
            isOneToOne: false
            referencedRelation: "condominiums"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_items_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "technicians"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_items_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "protocol_work_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protocols_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      acquire_conversation_lock: {
        Args: { p_conversation_id: string; p_ttl_seconds?: number }
        Returns: {
          ok: boolean
          token: string
          until: string
        }[]
      }
      can_access_conversation: {
        Args: { _conversation_id: string; _user_id: string }
        Returns: boolean
      }
      cleanup_expired_data: { Args: never; Returns: undefined }
      cleanup_message_outbox: { Args: never; Returns: undefined }
      cleanup_old_ai_logs: { Args: never; Returns: undefined }
      cleanup_old_messages: { Args: never; Returns: undefined }
      cleanup_old_notifications: { Args: never; Returns: undefined }
      delete_plan_item: { Args: { p_item_id: string }; Returns: Json }
      detect_display_name_type: {
        Args: { display_name: string }
        Returns: string
      }
      get_next_protocol_sequence: {
        Args: { year_month_param: string }
        Returns: number
      }
      get_user_team_id: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_unread_count: { Args: { conv_id: string }; Returns: undefined }
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
      normalize_chat_id: { Args: { raw_chat_id: string }; Returns: string }
      normalize_chat_key: { Args: { chat_id: string }; Returns: string }
      normalize_phone: { Args: { v: string }; Returns: string }
      normalize_phone_for_unique: {
        Args: { phone_val: string }
        Returns: string
      }
      release_conversation_lock: {
        Args: { p_conversation_id: string; p_token: string }
        Returns: boolean
      }
      resolve_contact_identity: {
        Args: {
          p_chat_id: string
          p_chat_lid: string
          p_lid: string
          p_name?: string
          p_phone: string
        }
        Returns: {
          chat_key: string
          contact_id: string
          out_chat_key: string
          used_key: string
        }[]
      }
      resolve_contact_identity_v6: {
        Args: {
          p_chat_id: string
          p_chat_lid: string
          p_lid: string
          p_name?: string
          p_phone: string
        }
        Returns: {
          chat_key: string
          contact_id: string
          out_chat_key: string
          used_key: string
        }[]
      }
      resolve_contact_identity_v7: {
        Args: {
          p_chat_id: string
          p_chat_lid: string
          p_lid: string
          p_name?: string
          p_phone: string
        }
        Returns: {
          chat_key: string
          contact_id: string
          out_chat_key: string
          used_key: string
        }[]
      }
      resume_expired_ai_pauses: {
        Args: never
        Returns: {
          resumed_count: number
        }[]
      }
      resume_inactive_ai_conversations: {
        Args: never
        Returns: {
          resumed_count: number
        }[]
      }
      task_metrics_by_assignee: {
        Args: { p_days?: number }
        Returns: {
          assignee_id: string
          assignee_name: string
          avg_resolution_seconds: number
          done_today: number
          followups_due: number
          open_tasks: number
          overdue_tasks: number
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "agent"
      conversation_status: "open" | "resolved"
      message_type: "text" | "image" | "video" | "audio" | "document" | "system"
      sender_type: "contact" | "agent" | "system" | "assistant"
      task_priority: "low" | "normal" | "high" | "urgent"
      task_status: "pending" | "in_progress" | "waiting" | "done" | "cancelled"
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
      message_type: ["text", "image", "video", "audio", "document", "system"],
      sender_type: ["contact", "agent", "system", "assistant"],
      task_priority: ["low", "normal", "high", "urgent"],
      task_status: ["pending", "in_progress", "waiting", "done", "cancelled"],
    },
  },
} as const
