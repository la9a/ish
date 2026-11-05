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
      auth_ip_locks: {
        Row: {
          ip: string
          locked_until: string
          updated_at: string
        }
        Insert: {
          ip: string
          locked_until: string
          updated_at?: string
        }
        Update: {
          ip?: string
          locked_until?: string
          updated_at?: string
        }
        Relationships: []
      }
      auth_rate_limits: {
        Row: {
          key: string
          request_count: number
          updated_at: string
          window_started_at: string
        }
        Insert: {
          key: string
          request_count?: number
          updated_at?: string
          window_started_at?: string
        }
        Update: {
          key?: string
          request_count?: number
          updated_at?: string
          window_started_at?: string
        }
        Relationships: []
      }
      bot_commands: {
        Row: {
          action: string
          claimed_at: string | null
          claimed_by: string | null
          client_id: string
          created_at: string
          done_at: string | null
          id: string
          payload: Json
          user_id: string
        }
        Insert: {
          action: string
          claimed_at?: string | null
          claimed_by?: string | null
          client_id: string
          created_at?: string
          done_at?: string | null
          id?: string
          payload?: Json
          user_id: string
        }
        Update: {
          action?: string
          claimed_at?: string | null
          claimed_by?: string | null
          client_id?: string
          created_at?: string
          done_at?: string | null
          id?: string
          payload?: Json
          user_id?: string
        }
        Relationships: []
      }
      bot_events: {
        Row: {
          client_id: string | null
          client_title: string | null
          created_at: string
          group_id: string | null
          group_name: string | null
          id: number
          kind: string
          latency_ms: number | null
          message: string
          run_id: string | null
          user_id: string
        }
        Insert: {
          client_id?: string | null
          client_title?: string | null
          created_at?: string
          group_id?: string | null
          group_name?: string | null
          id?: number
          kind?: string
          latency_ms?: number | null
          message: string
          run_id?: string | null
          user_id: string
        }
        Update: {
          client_id?: string | null
          client_title?: string | null
          created_at?: string
          group_id?: string | null
          group_name?: string | null
          id?: number
          kind?: string
          latency_ms?: number | null
          message?: string
          run_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      bot_runs: {
        Row: {
          client_id: string
          id: string
          method: string
          mode: string
          schedule_at: string | null
          started_at: string
          status: string
          stopped_at: string | null
          updated_at: string
          user_id: string
          worker_id: string | null
        }
        Insert: {
          client_id: string
          id?: string
          method?: string
          mode?: string
          schedule_at?: string | null
          started_at?: string
          status?: string
          stopped_at?: string | null
          updated_at?: string
          user_id: string
          worker_id?: string | null
        }
        Update: {
          client_id?: string
          id?: string
          method?: string
          mode?: string
          schedule_at?: string | null
          started_at?: string
          status?: string
          stopped_at?: string | null
          updated_at?: string
          user_id?: string
          worker_id?: string | null
        }
        Relationships: []
      }
      bot_workers: {
        Row: {
          accounts_online: number
          created_at: string
          id: string
          label: string
          last_heartbeat_at: string | null
          region: string
          token_hash: string
          user_id: string
          version: string | null
        }
        Insert: {
          accounts_online?: number
          created_at?: string
          id: string
          label?: string
          last_heartbeat_at?: string | null
          region: string
          token_hash: string
          user_id: string
          version?: string | null
        }
        Update: {
          accounts_online?: number
          created_at?: string
          id?: string
          label?: string
          last_heartbeat_at?: string | null
          region?: string
          token_hash?: string
          user_id?: string
          version?: string | null
        }
        Relationships: []
      }
      clients: {
        Row: {
          api_hash: string | null
          api_id: number | null
          biweekly_anchor: number | null
          created_at: string
          dc_id: number | null
          deleted_at: string | null
          frequency: string
          has_session: boolean
          id: string
          me_name: string | null
          method: string
          monthly_days: number[] | null
          phone: string | null
          photo_url: string | null
          pinned: boolean
          schedule_env: string | null
          schedule_fim: string | null
          schedule_overrides: Json
          schedule_ras: string | null
          server_mode: boolean
          tg_session: string | null
          title: string
          updated_at: string
          user_id: string
          weekdays: number[] | null
          worker_region: string | null
        }
        Insert: {
          api_hash?: string | null
          api_id?: number | null
          biweekly_anchor?: number | null
          created_at?: string
          dc_id?: number | null
          deleted_at?: string | null
          frequency?: string
          has_session?: boolean
          id: string
          me_name?: string | null
          method?: string
          monthly_days?: number[] | null
          phone?: string | null
          photo_url?: string | null
          pinned?: boolean
          schedule_env?: string | null
          schedule_fim?: string | null
          schedule_overrides?: Json
          schedule_ras?: string | null
          server_mode?: boolean
          tg_session?: string | null
          title: string
          updated_at?: string
          user_id: string
          weekdays?: number[] | null
          worker_region?: string | null
        }
        Update: {
          api_hash?: string | null
          api_id?: number | null
          biweekly_anchor?: number | null
          created_at?: string
          dc_id?: number | null
          deleted_at?: string | null
          frequency?: string
          has_session?: boolean
          id?: string
          me_name?: string | null
          method?: string
          monthly_days?: number[] | null
          phone?: string | null
          photo_url?: string | null
          pinned?: boolean
          schedule_env?: string | null
          schedule_fim?: string | null
          schedule_overrides?: Json
          schedule_ras?: string | null
          server_mode?: boolean
          tg_session?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          weekdays?: number[] | null
          worker_region?: string | null
        }
        Relationships: []
      }
      monitor_settings: {
        Row: {
          auto_stop: boolean
          show_clock: boolean
          show_group_icons: boolean
          show_password_calc: boolean
          sound: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_stop?: boolean
          show_clock?: boolean
          show_group_icons?: boolean
          show_password_calc?: boolean
          sound?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_stop?: boolean
          show_clock?: boolean
          show_group_icons?: boolean
          show_password_calc?: boolean
          sound?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      monitored_groups: {
        Row: {
          active: boolean
          added_at: string
          client_id: string
          id: string
          input: string
          message: string
          name: string
          open_at: string | null
          photo_url: string | null
          signal_admin_ids: string[] | null
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          added_at?: string
          client_id: string
          id: string
          input: string
          message?: string
          name: string
          open_at?: string | null
          photo_url?: string | null
          signal_admin_ids?: string[] | null
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          added_at?: string
          client_id?: string
          id?: string
          input?: string
          message?: string
          name?: string
          open_at?: string | null
          photo_url?: string | null
          signal_admin_ids?: string[] | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "monitored_groups_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      consume_rate_limit: {
        Args: { p_key: string; p_limit: number; p_window_seconds: number }
        Returns: {
          allowed: boolean
          retry_after_seconds: number
        }[]
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
