import { appendFileSync } from "fs";

const target = "scripts/test-control-plane-fase4-10-cd.mjs";

appendFileSync(target, `
MockSupabaseClient.prototype.rpc = async function(funcName, params) {
    const authUid = this.authUid;

    if (funcName === "register_worker") {
      const { p_workspace_id, p_worker_identity, p_instance_identity, p_version, p_capabilities, p_max_concurrency, p_metadata } = params;
      if (!p_workspace_id || !p_worker_identity || !p_instance_identity) {
        return { data: { success: false, error_code: "INVALID_PARAMETERS" }, error: null };
      }

      if (authUid && !this.is_workspace_member(p_workspace_id, authUid)) {
        return { data: { success: false, error_code: "UNAUTHORIZED_WORKSPACE" }, error: null };
      }

      let existing = Array.from(this.workers.values()).find(
        (w) => w.workspace_id === p_workspace_id && w.worker_identity === p_worker_identity
      );

      if (existing) {
        if (existing.status === "QUARANTINED") {
          return { data: { success: false, error_code: "WORKER_QUARANTINED" }, error: null };
        }

        existing.instance_identity = p_instance_identity;
        existing.version = p_version || existing.version;
        existing.capabilities = p_capabilities || existing.capabilities;
        existing.max_concurrency = p_max_concurrency || existing.max_concurrency;
        existing.status = "HEALTHY";
        existing.last_heartbeat_at = new Date().toISOString();
        existing.updated_at = new Date().toISOString();
        return { data: { success: true, worker: existing }, error: null };
      }

      const newWorker = {
        id: randomUUID(),
        workspace_id: p_workspace_id,
        worker_identity: p_worker_identity,
        instance_identity: p_instance_identity,
        status: "HEALTHY",
        version: p_version || "1.0.0",
        capabilities: p_capabilities || ["ai", "database", "integrations", "http"],
        max_concurrency: p_max_concurrency || 5,
        current_concurrency: 0,
        last_heartbeat_at: new Date().toISOString(),
        registered_at: new Date().toISOString(),
        metadata: p_metadata || {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      this.workers.set(newWorker.id, newWorker);
      return { data: { success: true, worker: newWorker }, error: null };
    }

    if (funcName === "heartbeat_worker") {
      const { p_worker_id, p_instance_identity } = params;
      const worker = this.workers.get(p_worker_id);
      if (!worker) return { data: { success: false, error_code: "WORKER_NOT_FOUND" }, error: null };

      if (authUid && !this.is_workspace_member(worker.workspace_id, authUid)) {
        return { data: { success: false, error_code: "UNAUTHORIZED_WORKSPACE" }, error: null };
      }

      if (worker.status === "QUARANTINED") {
        return { data: { success: false, error_code: "WORKER_QUARANTINED", status: "QUARANTINED" }, error: null };
      }

      if (worker.instance_identity !== p_instance_identity) {
        return { data: { success: false, error_code: "INSTANCE_MISMATCH" }, error: null };
      }

      const activeLeases = Array.from(this.worker_leases.values()).filter(
        (l) => l.worker_id === p_worker_id && l.status === "active"
      ).length;

      worker.last_heartbeat_at = new Date().toISOString();
      worker.current_concurrency = activeLeases;
      if (worker.status === "STARTING" || worker.status === "STALE") {
        worker.status = "HEALTHY";
      }

      return {
        data: {
          success: true,
          status: worker.status,
          current_concurrency: activeLeases,
          last_heartbeat_at: worker.last_heartbeat_at
        },
        error: null
      };
    }

    if (funcName === "mark_worker_stale") {
      const timeoutSeconds = params.p_heartbeat_timeout_seconds || 90;
      const cutoff = Date.now() - timeoutSeconds * 1000;
      let count = 0;

      for (const w of this.workers.values()) {
        if ((w.status === "HEALTHY" || w.status === "STARTING") && new Date(w.last_heartbeat_at).getTime() < cutoff) {
          w.status = "STALE";
          count++;
        }
      }
      return { data: count, error: null };
    }

    if (funcName === "drain_worker") {
      const { p_worker_id, p_actor_id, p_reason } = params;
      const worker = this.workers.get(p_worker_id);
      if (!worker) return { data: { success: false, error_code: "WORKER_NOT_FOUND" }, error: null };

      if (authUid && !this.is_workspace_member(worker.workspace_id, authUid)) {
        return { data: { success: false, error_code: "UNAUTHORIZED_WORKSPACE" }, error: null };
      }

      if (worker.status === "QUARANTINED") {
        return { data: { success: false, error_code: "WORKER_QUARANTINED" }, error: null };
      }

      const activeLeases = Array.from(this.worker_leases.values()).filter(
        (l) => l.worker_id === p_worker_id && l.status === "active"
      ).length;

      if (activeLeases === 0) {
        worker.status = "STOPPED";
      } else {
        worker.status = "DRAINING";
      }

      return { data: { success: true, status: worker.status, active_leases: activeLeases }, error: null };
    }

    if (funcName === "quarantine_worker") {
      const { p_worker_id, p_actor_id, p_reason } = params;
      if (!p_reason || !p_reason.trim()) return { data: { success: false, error_code: "REASON_REQUIRED" }, error: null };

      const worker = this.workers.get(p_worker_id);
      if (!worker) return { data: { success: false, error_code: "WORKER_NOT_FOUND" }, error: null };

      if (authUid && !this.is_workspace_member(worker.workspace_id, authUid)) {
        return { data: { success: false, error_code: "UNAUTHORIZED_WORKSPACE" }, error: null };
      }

      worker.status = "QUARANTINED";
      worker.current_concurrency = 0;

      let revoked = 0;
      for (const l of this.worker_leases.values()) {
        if (l.worker_id === p_worker_id && l.status === "active") {
          l.status = "revoked";
          const run = this.job_runs.get(l.job_run_id);
          if (run && (run.status === "claimed" || run.status === "running")) {
            run.status = "queued";
            run.worker_id = null;
            run.fencing_token = BigInt(run.fencing_token) + 1n;
          }
          revoked++;
        }
      }

      return { data: { success: true, status: "QUARANTINED", revoked_leases: revoked }, error: null };
    }

    if (funcName === "release_worker_quarantine") {
      const { p_worker_id } = params;
      const worker = this.workers.get(p_worker_id);
      if (!worker) return { data: { success: false, error_code: "WORKER_NOT_FOUND" }, error: null };

      if (authUid && !this.is_workspace_member(worker.workspace_id, authUid)) {
        return { data: { success: false, error_code: "UNAUTHORIZED_WORKSPACE" }, error: null };
      }

      if (worker.status !== "QUARANTINED") {
        return { data: { success: false, error_code: "NOT_QUARANTINED" }, error: null };
      }

      worker.status = "STOPPED";
      worker.current_concurrency = 0;
      return { data: { success: true, status: "STOPPED" }, error: null };
    }
`;
console.log("Part 3 written");
