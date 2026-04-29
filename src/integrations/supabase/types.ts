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
      api_key_status: {
        Row: {
          exhausted_at: string | null
          id: string
          key_name: string
          last_error: string | null
          last_status: number | null
          provider: string
          reset_at: string | null
          updated_at: string
        }
        Insert: {
          exhausted_at?: string | null
          id?: string
          key_name: string
          last_error?: string | null
          last_status?: number | null
          provider: string
          reset_at?: string | null
          updated_at?: string
        }
        Update: {
          exhausted_at?: string | null
          id?: string
          key_name?: string
          last_error?: string | null
          last_status?: number | null
          provider?: string
          reset_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      atmosphere_cache: {
        Row: {
          atmosphere_summary: string
          created_at: string
          yelp_id: string
        }
        Insert: {
          atmosphere_summary: string
          created_at?: string
          yelp_id: string
        }
        Update: {
          atmosphere_summary?: string
          created_at?: string
          yelp_id?: string
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      feedback: {
        Row: {
          created_at: string
          device_id: string | null
          id: string
          message: string
          sender_email: string | null
        }
        Insert: {
          created_at?: string
          device_id?: string | null
          id?: string
          message: string
          sender_email?: string | null
        }
        Update: {
          created_at?: string
          device_id?: string | null
          id?: string
          message?: string
          sender_email?: string | null
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          cities: string[]
          created_at: string
          device_id: string
          enabled: boolean
          endpoint: string
          frequency: string
          id: string
          last_notified_at: string | null
          p256dh: string
          preferred_hour: number
          timezone: string
          updated_at: string
        }
        Insert: {
          auth: string
          cities?: string[]
          created_at?: string
          device_id: string
          enabled?: boolean
          endpoint: string
          frequency?: string
          id?: string
          last_notified_at?: string | null
          p256dh: string
          preferred_hour?: number
          timezone?: string
          updated_at?: string
        }
        Update: {
          auth?: string
          cities?: string[]
          created_at?: string
          device_id?: string
          enabled?: boolean
          endpoint?: string
          frequency?: string
          id?: string
          last_notified_at?: string | null
          p256dh?: string
          preferred_hour?: number
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      restaurant_categories: {
        Row: {
          aliases: string[]
          titles: string[]
          updated_at: string
          yelp_id: string
        }
        Insert: {
          aliases?: string[]
          titles?: string[]
          updated_at?: string
          yelp_id: string
        }
        Update: {
          aliases?: string[]
          titles?: string[]
          updated_at?: string
          yelp_id?: string
        }
        Relationships: []
      }
      restaurant_metrics: {
        Row: {
          address: string | null
          coordinates: Json | null
          google_place_id: string | null
          image_url: string | null
          name: string | null
          phone: string | null
          price_level: number | null
          rating: number | null
          review_count: number | null
          updated_at: string
          url: string | null
          yelp_id: string
        }
        Insert: {
          address?: string | null
          coordinates?: Json | null
          google_place_id?: string | null
          image_url?: string | null
          name?: string | null
          phone?: string | null
          price_level?: number | null
          rating?: number | null
          review_count?: number | null
          updated_at?: string
          url?: string | null
          yelp_id: string
        }
        Update: {
          address?: string | null
          coordinates?: Json | null
          google_place_id?: string | null
          image_url?: string | null
          name?: string | null
          phone?: string | null
          price_level?: number | null
          rating?: number | null
          review_count?: number | null
          updated_at?: string
          url?: string | null
          yelp_id?: string
        }
        Relationships: []
      }
      restaurant_sightings: {
        Row: {
          city: string
          first_seen_at: string
          is_new_discovery: boolean
          yelp_id: string
        }
        Insert: {
          city: string
          first_seen_at?: string
          is_new_discovery?: boolean
          yelp_id: string
        }
        Update: {
          city?: string
          first_seen_at?: string
          is_new_discovery?: boolean
          yelp_id?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
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
