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
          entity_id: string
          entity_type: string
          id: string
          org_id: string
          payload: Json
          store_id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          org_id: string
          payload?: Json
          store_id: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          org_id?: string
          payload?: Json
          store_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_audit_logs_store_org"
            columns: ["store_id", "org_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      cash_movements: {
        Row: {
          amount: number
          cash_session_id: string
          client_mutation_id: string
          created_at: string
          created_by: string
          id: string
          movement_type: Database["public"]["Enums"]["cash_movement_type"]
          org_id: string
          payment_id: string | null
          reason: string
          sale_id: string | null
          store_id: string
          terminal_id: string
        }
        Insert: {
          amount: number
          cash_session_id: string
          client_mutation_id: string
          created_at?: string
          created_by: string
          id?: string
          movement_type: Database["public"]["Enums"]["cash_movement_type"]
          org_id: string
          payment_id?: string | null
          reason: string
          sale_id?: string | null
          store_id: string
          terminal_id: string
        }
        Update: {
          amount?: number
          cash_session_id?: string
          client_mutation_id?: string
          created_at?: string
          created_by?: string
          id?: string
          movement_type?: Database["public"]["Enums"]["cash_movement_type"]
          org_id?: string
          payment_id?: string | null
          reason?: string
          sale_id?: string | null
          store_id?: string
          terminal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_movements_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_payment_scope_fk"
            columns: ["payment_id", "org_id", "store_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id", "org_id", "store_id"]
          },
          {
            foreignKeyName: "cash_movements_sale_scope_fk"
            columns: ["sale_id", "org_id", "store_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id", "org_id", "store_id"]
          },
          {
            foreignKeyName: "cash_movements_session_scope_fk"
            columns: ["cash_session_id", "org_id", "store_id", "terminal_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id", "org_id", "store_id", "terminal_id"]
          },
          {
            foreignKeyName: "cash_movements_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_sessions: {
        Row: {
          close_client_mutation_id: string | null
          closed_at: string | null
          closed_by: string | null
          counted_amount: number | null
          difference: number | null
          expected_amount: number | null
          id: string
          open_client_mutation_id: string
          opened_at: string
          opened_by: string
          opening_amount: number
          org_id: string
          status: Database["public"]["Enums"]["cash_session_status"]
          store_id: string
          terminal_id: string
        }
        Insert: {
          close_client_mutation_id?: string | null
          closed_at?: string | null
          closed_by?: string | null
          counted_amount?: number | null
          difference?: number | null
          expected_amount?: number | null
          id?: string
          open_client_mutation_id: string
          opened_at?: string
          opened_by: string
          opening_amount?: number
          org_id: string
          status?: Database["public"]["Enums"]["cash_session_status"]
          store_id: string
          terminal_id: string
        }
        Update: {
          close_client_mutation_id?: string | null
          closed_at?: string | null
          closed_by?: string | null
          counted_amount?: number | null
          difference?: number | null
          expected_amount?: number | null
          id?: string
          open_client_mutation_id?: string
          opened_at?: string
          opened_by?: string
          opening_amount?: number
          org_id?: string
          status?: Database["public"]["Enums"]["cash_session_status"]
          store_id?: string
          terminal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_sessions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_sessions_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_sessions_store_scope_fk"
            columns: ["store_id", "org_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          org_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          org_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          created_at: string
          document: string | null
          email: string | null
          id: string
          name: string
          org_id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          document?: string | null
          email?: string | null
          id?: string
          name: string
          org_id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          document?: string | null
          email?: string | null
          id?: string
          name?: string
          org_id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fiscal_documents: {
        Row: {
          adapter: string
          attempt_count: number
          cancelled_at: string | null
          created_at: string
          external_id: string | null
          id: string
          issued_at: string | null
          last_error: string | null
          last_operation:
            | Database["public"]["Enums"]["fiscal_operation_type"]
            | null
          operation_id: string | null
          org_id: string
          payload: Json
          reconciled_at: string | null
          requested_at: string | null
          sale_id: string
          status: Database["public"]["Enums"]["fiscal_document_status"]
          store_id: string
          unknown_at: string | null
          updated_at: string
        }
        Insert: {
          adapter?: string
          attempt_count?: number
          cancelled_at?: string | null
          created_at?: string
          external_id?: string | null
          id?: string
          issued_at?: string | null
          last_error?: string | null
          last_operation?:
            | Database["public"]["Enums"]["fiscal_operation_type"]
            | null
          operation_id?: string | null
          org_id: string
          payload?: Json
          reconciled_at?: string | null
          requested_at?: string | null
          sale_id: string
          status?: Database["public"]["Enums"]["fiscal_document_status"]
          store_id: string
          unknown_at?: string | null
          updated_at?: string
        }
        Update: {
          adapter?: string
          attempt_count?: number
          cancelled_at?: string | null
          created_at?: string
          external_id?: string | null
          id?: string
          issued_at?: string | null
          last_error?: string | null
          last_operation?:
            | Database["public"]["Enums"]["fiscal_operation_type"]
            | null
          operation_id?: string | null
          org_id?: string
          payload?: Json
          reconciled_at?: string | null
          requested_at?: string | null
          sale_id?: string
          status?: Database["public"]["Enums"]["fiscal_document_status"]
          store_id?: string
          unknown_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_documents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscal_documents_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: true
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_fiscal_documents_sale_store_org"
            columns: ["sale_id", "store_id", "org_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id", "store_id", "org_id"]
          },
        ]
      }
      integration_outbox: {
        Row: {
          attempt_count: number
          created_at: string
          fiscal_document_id: string
          id: string
          idempotency_key: string
          last_error: string | null
          next_attempt_at: string
          operation_id: string
          operation_type: Database["public"]["Enums"]["fiscal_operation_type"]
          org_id: string
          provider: string
          status: Database["public"]["Enums"]["integration_outbox_status"]
          store_id: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          fiscal_document_id: string
          id?: string
          idempotency_key: string
          last_error?: string | null
          next_attempt_at?: string
          operation_id: string
          operation_type: Database["public"]["Enums"]["fiscal_operation_type"]
          org_id: string
          provider: string
          status?: Database["public"]["Enums"]["integration_outbox_status"]
          store_id: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          fiscal_document_id?: string
          id?: string
          idempotency_key?: string
          last_error?: string | null
          next_attempt_at?: string
          operation_id?: string
          operation_type?: Database["public"]["Enums"]["fiscal_operation_type"]
          org_id?: string
          provider?: string
          status?: Database["public"]["Enums"]["integration_outbox_status"]
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_outbox_fiscal_document_id_fkey"
            columns: ["fiscal_document_id"]
            isOneToOne: false
            referencedRelation: "fiscal_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_outbox_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_outbox_scope_fk"
            columns: ["fiscal_document_id", "store_id", "org_id"]
            isOneToOne: false
            referencedRelation: "fiscal_documents"
            referencedColumns: ["id", "store_id", "org_id"]
          },
          {
            foreignKeyName: "integration_outbox_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_balances: {
        Row: {
          id: string
          org_id: string
          product_id: string
          quantity: number
          store_id: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          product_id: string
          quantity?: number
          store_id: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          product_id?: string
          quantity?: number
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_inventory_balances_product_same_org"
            columns: ["product_id", "org_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "fk_inventory_balances_store_same_org"
            columns: ["store_id", "org_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "inventory_balances_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_balances_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_balances_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_movements: {
        Row: {
          actor_role: Database["public"]["Enums"]["member_role"] | null
          balance_after: number
          client_mutation_id: string | null
          created_at: string
          created_by: string
          id: string
          import_id: string | null
          import_row: number | null
          movement_seq: number
          movement_type: Database["public"]["Enums"]["inventory_movement_type"]
          org_id: string
          product_id: string
          quantity_change: number
          reason: string | null
          sale_id: string | null
          store_id: string
          terminal_id: string | null
        }
        Insert: {
          actor_role?: Database["public"]["Enums"]["member_role"] | null
          balance_after: number
          client_mutation_id?: string | null
          created_at?: string
          created_by: string
          id?: string
          import_id?: string | null
          import_row?: number | null
          movement_seq?: never
          movement_type: Database["public"]["Enums"]["inventory_movement_type"]
          org_id: string
          product_id: string
          quantity_change: number
          reason?: string | null
          sale_id?: string | null
          store_id: string
          terminal_id?: string | null
        }
        Update: {
          actor_role?: Database["public"]["Enums"]["member_role"] | null
          balance_after?: number
          client_mutation_id?: string | null
          created_at?: string
          created_by?: string
          id?: string
          import_id?: string | null
          import_row?: number | null
          movement_seq?: never
          movement_type?: Database["public"]["Enums"]["inventory_movement_type"]
          org_id?: string
          product_id?: string
          quantity_change?: number
          reason?: string | null
          sale_id?: string | null
          store_id?: string
          terminal_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_inventory_movements_product_same_org"
            columns: ["product_id", "org_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "fk_inventory_movements_sale_store_org"
            columns: ["sale_id", "store_id", "org_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id", "store_id", "org_id"]
          },
          {
            foreignKeyName: "fk_inventory_movements_store_same_org"
            columns: ["store_id", "org_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "inventory_movements_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          currency: string
          id: string
          name: string
          slug: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          id?: string
          name: string
          slug: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          name?: string
          slug?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      payment_provider_events: {
        Row: {
          created_at: string
          event_id: string
          id: string
          org_id: string
          payment_id: string
          provider_reference: string | null
          status: string
          store_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          org_id: string
          payment_id: string
          provider_reference?: string | null
          status: string
          store_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          org_id?: string
          payment_id?: string
          provider_reference?: string | null
          status?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_provider_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_provider_events_payment_scope_fk"
            columns: ["payment_id", "org_id", "store_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id", "org_id", "store_id"]
          },
          {
            foreignKeyName: "payment_provider_events_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          adapter_status: Database["public"]["Enums"]["adapter_status"]
          amount: number
          cash_session_id: string | null
          client_mutation_id: string
          created_at: string
          external_reference: string | null
          failure_code: string | null
          id: string
          method: Database["public"]["Enums"]["payment_method"]
          org_id: string
          reconciled_at: string | null
          sale_id: string
          status: Database["public"]["Enums"]["payment_status"]
          store_id: string
          unknown_at: string | null
          updated_at: string
        }
        Insert: {
          adapter_status?: Database["public"]["Enums"]["adapter_status"]
          amount: number
          cash_session_id?: string | null
          client_mutation_id: string
          created_at?: string
          external_reference?: string | null
          failure_code?: string | null
          id?: string
          method: Database["public"]["Enums"]["payment_method"]
          org_id: string
          reconciled_at?: string | null
          sale_id: string
          status?: Database["public"]["Enums"]["payment_status"]
          store_id: string
          unknown_at?: string | null
          updated_at?: string
        }
        Update: {
          adapter_status?: Database["public"]["Enums"]["adapter_status"]
          amount?: number
          cash_session_id?: string | null
          client_mutation_id?: string
          created_at?: string
          external_reference?: string | null
          failure_code?: string | null
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          org_id?: string
          reconciled_at?: string | null
          sale_id?: string
          status?: Database["public"]["Enums"]["payment_status"]
          store_id?: string
          unknown_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_payments_sale_same_org"
            columns: ["sale_id", "org_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "payments_cash_session_scope_fk"
            columns: ["cash_session_id", "org_id", "store_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id", "org_id", "store_id"]
          },
          {
            foreignKeyName: "payments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_sale_store_scope_fk"
            columns: ["sale_id", "org_id", "store_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id", "org_id", "store_id"]
          },
        ]
      }
      products: {
        Row: {
          barcode: string | null
          category_id: string | null
          cost_price: number
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          org_id: string
          sku: string
          unit_price: number
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          category_id?: string | null
          cost_price?: number
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          org_id: string
          sku: string
          unit_price: number
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          category_id?: string | null
          cost_price?: number
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
          sku?: string
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          default_role: Database["public"]["Enums"]["member_role"]
          email: string
          full_name: string
          id: string
          org_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_role?: Database["public"]["Enums"]["member_role"]
          email: string
          full_name: string
          id: string
          org_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_role?: Database["public"]["Enums"]["member_role"]
          email?: string
          full_name?: string
          id?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_idempotency_keys: {
        Row: {
          client_mutation_id: string
          created_at: string
          sale_id: string
          store_id: string
        }
        Insert: {
          client_mutation_id: string
          created_at?: string
          sale_id: string
          store_id: string
        }
        Update: {
          client_mutation_id?: string
          created_at?: string
          sale_id?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_idempotency_keys_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_idempotency_keys_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_items: {
        Row: {
          cost_price: number | null
          created_at: string
          discount: number
          id: string
          product_id: string
          product_name: string
          product_sku: string
          quantity: number
          sale_id: string
          total: number
          unit_price: number
        }
        Insert: {
          cost_price?: number | null
          created_at?: string
          discount?: number
          id?: string
          product_id: string
          product_name: string
          product_sku: string
          quantity: number
          sale_id: string
          total: number
          unit_price: number
        }
        Update: {
          cost_price?: number | null
          created_at?: string
          discount?: number
          id?: string
          product_id?: string
          product_name?: string
          product_sku?: string
          quantity?: number
          sale_id?: string
          total?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          cash_session_id: string | null
          cashier_id: string
          client_mutation_id: string
          confirmed_at: string | null
          created_at: string
          customer_id: string | null
          discount: number
          id: string
          notes: string | null
          org_id: string
          status: Database["public"]["Enums"]["sale_status"]
          store_id: string
          subtotal: number
          sync_status: Database["public"]["Enums"]["sync_status"]
          total: number
          updated_at: string
        }
        Insert: {
          cash_session_id?: string | null
          cashier_id: string
          client_mutation_id: string
          confirmed_at?: string | null
          created_at?: string
          customer_id?: string | null
          discount?: number
          id?: string
          notes?: string | null
          org_id: string
          status?: Database["public"]["Enums"]["sale_status"]
          store_id: string
          subtotal?: number
          sync_status?: Database["public"]["Enums"]["sync_status"]
          total?: number
          updated_at?: string
        }
        Update: {
          cash_session_id?: string | null
          cashier_id?: string
          client_mutation_id?: string
          confirmed_at?: string | null
          created_at?: string
          customer_id?: string | null
          discount?: number
          id?: string
          notes?: string | null
          org_id?: string
          status?: Database["public"]["Enums"]["sale_status"]
          store_id?: string
          subtotal?: number
          sync_status?: Database["public"]["Enums"]["sync_status"]
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_sales_store_same_org"
            columns: ["store_id", "org_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "sales_cash_session_scope_fk"
            columns: ["cash_session_id", "org_id", "store_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id", "org_id", "store_id"]
          },
          {
            foreignKeyName: "sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_returns: {
        Row: {
          cash_session_id: string | null
          client_mutation_id: string
          created_at: string
          header_discount_share: number
          id: string
          items_subtotal: number
          notes: string | null
          operation: string
          operator_id: string
          org_id: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_refund_status: string
          reason: string
          refund_total: number
          sale_id: string
          store_id: string
          terminal_id: string
        }
        Insert: {
          cash_session_id?: string | null
          client_mutation_id: string
          created_at?: string
          header_discount_share: number
          id?: string
          items_subtotal: number
          notes?: string | null
          operation: string
          operator_id: string
          org_id: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_refund_status: string
          reason: string
          refund_total: number
          sale_id: string
          store_id: string
          terminal_id: string
        }
        Update: {
          cash_session_id?: string | null
          client_mutation_id?: string
          created_at?: string
          header_discount_share?: number
          id?: string
          items_subtotal?: number
          notes?: string | null
          operation?: string
          operator_id?: string
          org_id?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          payment_refund_status?: string
          reason?: string
          refund_total?: number
          sale_id?: string
          store_id?: string
          terminal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_returns_sale_scope_fk"
            columns: ["sale_id", "org_id", "store_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id", "org_id", "store_id"]
          },
          {
            foreignKeyName: "sale_returns_store_scope_fk"
            columns: ["store_id", "org_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      store_members: {
        Row: {
          created_at: string
          id: string
          org_id: string
          role: Database["public"]["Enums"]["member_role"]
          store_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          role: Database["public"]["Enums"]["member_role"]
          store_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          role?: Database["public"]["Enums"]["member_role"]
          store_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_store_members_store_same_org"
            columns: ["store_id", "org_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "store_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_members_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          org_id: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          org_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stores_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      suspended_sales: {
        Row: {
          claim_id: string | null
          claimed_at: string | null
          claimed_by: string | null
          claimed_terminal_id: string | null
          client_mutation_id: string
          completed_at: string | null
          completed_sale_id: string | null
          completion_client_mutation_id: string | null
          created_at: string
          customer_id: string | null
          discount: number
          id: string
          operator_id: string
          org_id: string
          recovery_client_mutation_id: string | null
          snapshot: Json
          snapshot_version: number
          status: Database["public"]["Enums"]["suspended_sale_status"]
          store_id: string
          subtotal: number
          terminal_id: string
          total: number
          updated_at: string
        }
        Insert: {
          claim_id?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          claimed_terminal_id?: string | null
          client_mutation_id: string
          completed_at?: string | null
          completed_sale_id?: string | null
          completion_client_mutation_id?: string | null
          created_at?: string
          customer_id?: string | null
          discount: number
          id?: string
          operator_id: string
          org_id: string
          recovery_client_mutation_id?: string | null
          snapshot: Json
          snapshot_version?: number
          status?: Database["public"]["Enums"]["suspended_sale_status"]
          store_id: string
          subtotal: number
          terminal_id: string
          total: number
          updated_at?: string
        }
        Update: {
          claim_id?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          claimed_terminal_id?: string | null
          client_mutation_id?: string
          completed_at?: string | null
          completed_sale_id?: string | null
          completion_client_mutation_id?: string | null
          created_at?: string
          customer_id?: string | null
          discount?: number
          id?: string
          operator_id?: string
          org_id?: string
          recovery_client_mutation_id?: string | null
          snapshot?: Json
          snapshot_version?: number
          status?: Database["public"]["Enums"]["suspended_sale_status"]
          store_id?: string
          subtotal?: number
          terminal_id?: string
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "suspended_sales_completed_sale_scope_fk"
            columns: ["completed_sale_id", "org_id", "store_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id", "org_id", "store_id"]
          },
          {
            foreignKeyName: "suspended_sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suspended_sales_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suspended_sales_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suspended_sales_store_scope_fk"
            columns: ["store_id", "org_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      adjust_inventory: { Args: { p_payload: Json }; Returns: Json }
      append_fiscal_audit: {
        Args: { p_action: string; p_document_id: string; p_payload: Json }
        Returns: undefined
      }
      assert_sale_discount_cap: {
        Args: { p_discount: number; p_store_id: string; p_subtotal: number }
        Returns: undefined
      }
      assert_sale_payload_integrity: {
        Args: { p_payload: Json }
        Returns: undefined
      }
      build_fiscal_snapshot: { Args: { p_sale_id: string }; Returns: Json }
      category_belongs_to_org: {
        Args: { p_category_id: string; p_org_id: string }
        Returns: boolean
      }
      claim_fiscal_outbox: { Args: { p_payload?: Json }; Returns: Json }
      close_cash_session: { Args: { p_payload: Json }; Returns: Json }
      complete_suspended_sale: { Args: { p_payload: Json }; Returns: Json }
      complete_suspended_sale_core: {
        Args: { p_payload: Json; p_with_cash: boolean }
        Returns: Json
      }
      complete_suspended_sale_with_cash: {
        Args: { p_payload: Json }
        Returns: Json
      }
      create_product: {
        Args: { p_payload: Json; p_store_id: string }
        Returns: Json
      }
      current_user_org_id: { Args: never; Returns: string }
      fiscal_result_error_code: { Args: { p_payload: Json }; Returns: string }
      cancel_sale: { Args: { p_payload: Json }; Returns: Json }
      get_cash_session: { Args: { p_payload: Json }; Returns: Json }
      get_dashboard_metrics: { Args: { p_payload: Json }; Returns: Json }
      get_inventory_page: { Args: { p_payload: Json }; Returns: Json }
      get_sale_detail: { Args: { p_payload: Json }; Returns: Json }
      list_sales: { Args: { p_payload: Json }; Returns: Json }
      list_suspended_sales: { Args: { p_payload: Json }; Returns: Json }
      open_cash_session: { Args: { p_payload: Json }; Returns: Json }
      process_sale: { Args: { p_payload: Json }; Returns: Json }
      process_sale_return: { Args: { p_payload: Json }; Returns: Json }
      process_sale_core: { Args: { p_payload: Json }; Returns: Json }
      process_sale_with_cash: { Args: { p_payload: Json }; Returns: Json }
      reconcile_payment: { Args: { p_payload: Json }; Returns: Json }
      record_cash_movement: { Args: { p_payload: Json }; Returns: Json }
      record_fiscal_result: { Args: { p_payload: Json }; Returns: Json }
      record_payment_provider_event: {
        Args: { p_payload: Json }
        Returns: Json
      }
      recover_suspended_sale: { Args: { p_payload: Json }; Returns: Json }
      release_suspended_sale: { Args: { p_payload: Json }; Returns: Json }
      request_fiscal_cancel: { Args: { p_payload: Json }; Returns: Json }
      request_fiscal_issue: { Args: { p_payload: Json }; Returns: Json }
      request_fiscal_reconcile: { Args: { p_payload: Json }; Returns: Json }
      retry_fiscal_operation: { Args: { p_payload: Json }; Returns: Json }
      sale_payload_matches: {
        Args: { p_payload: Json; p_sale_id: string }
        Returns: boolean
      }
      suspend_sale: { Args: { p_payload: Json }; Returns: Json }
      update_product: {
        Args: { p_payload: Json; p_product_id: string; p_store_id: string }
        Returns: Json
      }
      user_can_manage_inventory: {
        Args: { p_store_id: string }
        Returns: boolean
      }
      user_can_view_reports: { Args: { p_store_id: string }; Returns: boolean }
      user_has_org_membership: { Args: never; Returns: boolean }
      user_has_org_role: {
        Args: {
          p_roles: Database["public"]["Enums"]["member_role"][]
          p_store_id: string
        }
        Returns: boolean
      }
      user_has_store_access: { Args: { p_store_id: string }; Returns: boolean }
      user_store_role: {
        Args: { p_store_id: string }
        Returns: Database["public"]["Enums"]["member_role"]
      }
    }
    Enums: {
      adapter_status: "configured" | "not_configured" | "error"
      cash_movement_type: "sale_cash" | "supply" | "withdrawal" | "adjustment" | "refund_cash"
      cash_session_status: "open" | "closed"
      fiscal_document_status:
        | "not_configured"
        | "pending"
        | "issued"
        | "failed"
        | "cancelled"
        | "unknown"
      fiscal_operation_type: "issue" | "cancel" | "consult"
      integration_outbox_status:
        | "pending"
        | "processing"
        | "completed"
        | "failed"
        | "unknown"
      inventory_movement_type: "sale" | "refund" | "restock" | "adjustment"
      member_role: "admin" | "cashier" | "manager"
      payment_method: "cash" | "card" | "pix" | "voucher" | "other"
      payment_status:
        | "pending"
        | "authorized"
        | "captured"
        | "failed"
        | "cancelled"
        | "refunded"
        | "unknown"
      sale_status:
        | "draft"
        | "pending_sync"
        | "confirmed"
        | "cancelled"
        | "refunded"
        | "partially_refunded"
      suspended_sale_status: "suspended" | "claimed" | "completed"
      sync_status: "pending" | "processing" | "synced" | "failed" | "conflict"
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
      adapter_status: ["configured", "not_configured", "error"],
      cash_movement_type: ["sale_cash", "supply", "withdrawal", "adjustment", "refund_cash"],
      cash_session_status: ["open", "closed"],
      fiscal_document_status: [
        "not_configured",
        "pending",
        "issued",
        "failed",
        "cancelled",
        "unknown",
      ],
      fiscal_operation_type: ["issue", "cancel", "consult"],
      integration_outbox_status: [
        "pending",
        "processing",
        "completed",
        "failed",
        "unknown",
      ],
      inventory_movement_type: ["sale", "refund", "restock", "adjustment"],
      member_role: ["admin", "cashier", "manager"],
      payment_method: ["cash", "card", "pix", "voucher", "other"],
      payment_status: [
        "pending",
        "authorized",
        "captured",
        "failed",
        "cancelled",
        "refunded",
        "unknown",
      ],
      sale_status: [
        "draft",
        "pending_sync",
        "confirmed",
        "cancelled",
        "refunded",
        "partially_refunded",
      ],
      suspended_sale_status: ["suspended", "claimed", "completed"],
      sync_status: ["pending", "processing", "synced", "failed", "conflict"],
    },
  },
} as const
