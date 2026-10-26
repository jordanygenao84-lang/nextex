import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getUserWorkspaces, isSuperAdmin } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const userClient = createClient();
    const { data: { user } } = await userClient.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: { code: "AUTH_REQUIRED", message: "Sesión de usuario requerida." } },
        { status: 401 }
      );
    }

    const superAdmin = await isSuperAdmin(user.id);
    if (!superAdmin) {
      const allowedWorkspaces = await getUserWorkspaces(user.id);
      if (allowedWorkspaces.length === 0) {
        return NextResponse.json(
          { error: { code: "NOT_FOUND", message: "Recurso no encontrado." } },
          { status: 404 }
        );
      }
    }

    const serviceClient = createServiceClient();
    const { data: agents, error } = await (serviceClient.from("fleet_agents") as any)
      .select("id, name, status, last_seen_at, capabilities, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: { code: "DB_ERROR", message: error.message } }, { status: 500 });
    }

    const agentList = agents || [];
    const now = Date.now();
    const ninetySecondsMs = 90 * 1000;

    let runningJobsQuery = (serviceClient.from("fleet_jobs") as any)
      .select("id, name, target_url, vus, started_at, agent_id")
      .eq("status", "running");

    if (!superAdmin) {
      runningJobsQuery = runningJobsQuery.eq("created_by", user.id);
    }

    const { data: runningJobs } = await runningJobsQuery;

    const runningJobsByAgent = new Map<string, any>();
    if (runningJobs) {
      for (const j of runningJobs) {
        if (j.agent_id) runningJobsByAgent.set(j.agent_id, j);
      }
    }

    const enrichedAgents = agentList.map((agent: any) => {
      const lastSeenTime = agent.last_seen_at ? new Date(agent.last_seen_at).getTime() : 0;
      const isOnline = lastSeenTime > 0 && now - lastSeenTime <= ninetySecondsMs;
      const currentJob = runningJobsByAgent.get(agent.id) || null;

      let effectiveStatus = "offline";
      if (isOnline) {
        effectiveStatus = currentJob ? "busy" : agent.status === "offline" ? "online" : agent.status;
      }

      return {
        ...agent,
        status: effectiveStatus,
        is_online: isOnline,
        current_job: currentJob,
      };
    });

    return NextResponse.json({ agents: enrichedAgents });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message || "Error al listar agentes." } },
      { status: 500 }
    );
  }
}
