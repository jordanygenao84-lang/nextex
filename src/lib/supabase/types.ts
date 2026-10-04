export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type UserPlan = "free" | "pro" | "enterprise";
export type UserStatus = "active" | "suspended" | "pending";
export type WorkspaceRole = "owner" | "admin" | "member";

export interface Profile {
  id: string;
  full_name: string;
  avatar_url: string | null;
  plan: UserPlan;
  status: UserStatus;
  created_at: string;
  updated_at: string;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  is_personal: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceMember {
  id: string;
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  created_at: string;
}

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: {
          id: string;
          full_name: string;
          avatar_url?: string | null;
          plan?: UserPlan;
          status?: UserStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string;
          avatar_url?: string | null;
          plan?: UserPlan;
          status?: UserStatus;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      workspaces: {
        Row: Workspace;
        Insert: {
          id?: string;
          name: string;
          slug: string;
          owner_id: string;
          is_personal?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          owner_id?: string;
          is_personal?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      workspace_members: {
        Row: WorkspaceMember;
        Insert: {
          id?: string;
          workspace_id: string;
          user_id: string;
          role?: WorkspaceRole;
          created_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          user_id?: string;
          role?: WorkspaceRole;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      drain_worker: {
        Args: { p_worker_id: string; p_actor_id: string; p_reason?: string | null };
        Returns: Json;
      };
      quarantine_worker: {
        Args: { p_worker_id: string; p_actor_id: string; p_reason: string };
        Returns: Json;
      };
      release_worker_quarantine: {
        Args: { p_worker_id: string; p_actor_id: string };
        Returns: Json;
      };
      recover_worker_jobs: {
        Args: { p_batch_size?: number };
        Returns: Json;
      };
    };
    Enums: {
      user_plan: UserPlan;
      user_status: UserStatus;
      workspace_role: WorkspaceRole;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
