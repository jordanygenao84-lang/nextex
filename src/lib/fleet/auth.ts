import { createServiceClient } from "@/lib/supabase/server";
import crypto from "crypto";

export interface FleetAgentRecord {
  id: string;
  name: string;
  api_key_hash: string;
  status: string;
  last_seen_at: string | null;
  capabilities: {
    max_vus?: number;
    engines?: string[];
    [key: string]: any;
  };
  created_at: string;
}

export async function verifyFleetAgent(req: Request): Promise<{ agent: FleetAgentRecord; supabase: any } | null> {
  const token = req.headers.get("x-fleet-key");
  if (!token || typeof token !== "string" || !token.trim()) {
    return null;
  }

  const tokenHash = crypto.createHash("sha256").update(token.trim()).digest("hex");
  const supabase = createServiceClient();

  const { data: agent, error } = await (supabase.from("fleet_agents") as any)
    .select("*")
    .eq("api_key_hash", tokenHash)
    .maybeSingle();

  if (error || !agent || !agent.api_key_hash) {
    return null;
  }

  const expectedBuffer = Buffer.from(agent.api_key_hash, "hex");
  const actualBuffer = Buffer.from(tokenHash, "hex");

  if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
    return null;
  }

  return { agent: agent as FleetAgentRecord, supabase };
}
