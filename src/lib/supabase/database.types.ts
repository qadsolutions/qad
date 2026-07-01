/**
 * Generated database types — DO NOT EDIT BY HAND (issue #22).
 *
 * Produced by `supabase gen types typescript` against the full M2 schema (all
 * migrations in supabase/migrations applied in order). Regenerate after any schema
 * change so the typed client cannot drift from the database:
 *
 *   # apply every migration to a throwaway pgvector DB, then:
 *   supabase gen types typescript --db-url <url> --schema public \
 *     > src/lib/supabase/database.types.ts
 *   # (re-add this banner; the generator does not emit it)
 *
 * Note (#69): `public.users.tenant_id` is `string | null` here — NULL only for a
 * platform_admin. This is the DB column type and is deliberately NOT the same as the
 * JWT claim type in src/lib/auth/jwt.ts (`tenant_id?: string`, never null). Every read
 * of a row's `tenant_id` must handle null; see the guards in the API routes.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          created_at: string
          id: string
          ip_address: unknown
          resource_id: string | null
          resource_type: string
          tenant_id: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          ip_address?: unknown
          resource_id?: string | null
          resource_type: string
          tenant_id?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          ip_address?: unknown
          resource_id?: string | null
          resource_type?: string
          tenant_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          tenant_id: string
          title: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          tenant_id: string
          title?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          tenant_id?: string
          title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      document_chunks: {
        Row: {
          chunk_index: number
          chunk_text: string
          created_at: string
          document_id: string
          id: string
          tenant_id: string
          token_count: number
        }
        Insert: {
          chunk_index: number
          chunk_text: string
          created_at?: string
          document_id: string
          id?: string
          tenant_id: string
          token_count: number
        }
        Update: {
          chunk_index?: number
          chunk_text?: string
          created_at?: string
          document_id?: string
          id?: string
          tenant_id?: string
          token_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "document_chunks_doc_tenant_fk"
            columns: ["document_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "document_chunks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          created_at: string
          error_detail: string | null
          file_type: Database["public"]["Enums"]["document_file_type"]
          filename: string
          id: string
          status: Database["public"]["Enums"]["document_status"]
          storage_path: string
          tenant_id: string
          version: number
        }
        Insert: {
          created_at?: string
          error_detail?: string | null
          file_type: Database["public"]["Enums"]["document_file_type"]
          filename: string
          id?: string
          status?: Database["public"]["Enums"]["document_status"]
          storage_path: string
          tenant_id: string
          version?: number
        }
        Update: {
          created_at?: string
          error_detail?: string | null
          file_type?: Database["public"]["Enums"]["document_file_type"]
          filename?: string
          id?: string
          status?: Database["public"]["Enums"]["document_status"]
          storage_path?: string
          tenant_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      embeddings: {
        Row: {
          chunk_id: string
          created_at: string
          embedding: string
          id: string
          model_version: string
          tenant_id: string
        }
        Insert: {
          chunk_id: string
          created_at?: string
          embedding: string
          id?: string
          model_version: string
          tenant_id: string
        }
        Update: {
          chunk_id?: string
          created_at?: string
          embedding?: string
          id?: string
          model_version?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "embeddings_chunk_tenant_fk"
            columns: ["chunk_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "document_chunks"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "embeddings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
          tenant_id: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
          tenant_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conv_tenant_fk"
            columns: ["conversation_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      model_calls: {
        Row: {
          completion_tokens: number
          created_at: string
          id: string
          latency_ms: number
          model_name: string
          prompt_tokens: number
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          completion_tokens: number
          created_at?: string
          id?: string
          latency_ms: number
          model_name: string
          prompt_tokens: number
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          completion_tokens?: number
          created_at?: string
          id?: string
          latency_ms?: number
          model_name?: string
          prompt_tokens?: number
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "model_calls_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "model_calls_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      retrieval_logs: {
        Row: {
          chunk_ids: string[]
          created_at: string
          id: string
          message_id: string
          similarity_scores: number[]
          tenant_id: string
        }
        Insert: {
          chunk_ids: string[]
          created_at?: string
          id?: string
          message_id: string
          similarity_scores: number[]
          tenant_id: string
        }
        Update: {
          chunk_ids?: string[]
          created_at?: string
          id?: string
          message_id?: string
          similarity_scores?: number[]
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "retrieval_logs_msg_tenant_fk"
            columns: ["message_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "retrieval_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          created_at: string
          id: string
          key: string
          tenant_id: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          tenant_id: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          tenant_id?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          plan_tier: string
          settings: Json
          slug: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          plan_tier?: string
          settings?: Json
          slug: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          plan_tier?: string
          settings?: Json
          slug?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          created_at: string
          email: string
          id: string
          role: string
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id: string
          role: string
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          role?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      match_chunks: {
        Args: {
          query_embedding: string
          p_tenant_id: string
          p_top_k?: number
          p_ef_search?: number
        }
        Returns: {
          chunk_id: string
          document_id: string
          chunk_text: string
          similarity: number
        }[]
      }
      reingest_document_chunks: {
        Args: {
          p_chunks: Json
          p_document_id: string
          p_model_version: string
          p_tenant_id: string
        }
        Returns: number
      }
    }
    Enums: {
      document_file_type: "pdf" | "docx" | "txt" | "md"
      document_status: "uploading" | "processing" | "ready" | "error"
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
      document_file_type: ["pdf", "docx", "txt", "md"],
      document_status: ["uploading", "processing", "ready", "error"],
    },
  },
} as const
