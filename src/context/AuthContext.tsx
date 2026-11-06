"use client";

import React, { createContext, useContext, useEffect, useState, useMemo } from "react";
import { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { Profile, Workspace } from "@/lib/supabase/types";
import { useRouter } from "next/navigation";

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  workspace: Workspace | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  workspace: null,
  isLoading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  const supabase = useMemo(() => createClient(), []);

  const fetchUserData = async (currentUser: User | null) => {
    if (!currentUser) {
      setProfile(null);
      setWorkspace(null);
      setIsLoading(false);
      return;
    }

    try {
      // 1. Obtener perfil
      const { data: profileData, error: profileErr } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", currentUser.id)
        .single();

      if (!profileErr && profileData) {
        setProfile(profileData as Profile);
      } else {
        setProfile(null);
      }

      // 2. Obtener workspace personal y verificar membresía real en workspace_members (fail-closed)
      const { data: workspaceData, error: wsErr } = await supabase
        .from("workspaces")
        .select("*")
        .eq("owner_id", currentUser.id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!wsErr && workspaceData) {
        const ws = workspaceData as Workspace;
        const { data: memberData, error: memberErr } = await (supabase
          .from("workspace_members") as any)
          .select("role")
          .eq("workspace_id", ws.id)
          .eq("user_id", currentUser.id)
          .maybeSingle();

        if (!memberErr && memberData) {
          setWorkspace(workspaceData as Workspace);
        } else {
          setWorkspace(null);
        }
      } else {
        setWorkspace(null);
      }
    } catch (err) {
      console.error("Error al cargar datos del perfil:", err);
      setProfile(null);
      setWorkspace(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const initialUser = session?.user ?? null;
        setUser(initialUser);
        await fetchUserData(initialUser);
      } catch (err) {
        console.error("Error al inicializar sesión:", err);
        setIsLoading(false);
      }
    };

    initializeAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        const currentUser = session?.user ?? null;
        setUser(currentUser);
        await fetchUserData(currentUser);
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase]);

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
      setUser(null);
      setProfile(null);
      setWorkspace(null);
      router.push("/login");
      router.refresh();
    } catch (err) {
      console.error("Error al cerrar sesión:", err);
    }
  };

  const refreshProfile = async () => {
    if (user) {
      await fetchUserData(user);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        workspace,
        isLoading,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
