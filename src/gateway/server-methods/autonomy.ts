/**
 * WebSocket API methods for the autonomy system.
 *
 * Uses the shared AutonomyService singleton from store-registry,
 * which is initialized during gateway boot in server-multi-agent.ts.
 */

import { loadConfig } from "../../config/config.js";
import { isMultiAgentOsEnabled } from "../../tasks/feature-gate.js";
import { getSharedAutonomyService, getSharedIdentityStore } from "../../tasks/store-registry.js";
import type { AutonomyService } from "../../autonomy/service.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

function getService() {
  const cfg = loadConfig();
  if (!isMultiAgentOsEnabled(cfg)) return null;
  return getSharedAutonomyService();
}

function requireService(
  respond: RespondFn,
): AutonomyService | null {
  const svc = getService();
  if (!svc) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        "autonomy is not enabled (set multiAgentOs.enabled + multiAgentOs.autonomy.enabled)",
      ),
    );
    return null;
  }
  return svc;
}

function getIdentityStore() {
  const cfg = loadConfig();
  if (!isMultiAgentOsEnabled(cfg)) return null;
  return getSharedIdentityStore();
}

export const autonomyHandlers: GatewayRequestHandlers = {
  "agents.identities.list": async ({ respond }) => {
    const store = getIdentityStore();
    if (!store) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "multiAgentOs is not enabled"));
      return;
    }
    const agents = store.listAll();
    respond(true, { agents });
  },

  "agents.identities.get": async ({ params, respond }) => {
    const store = getIdentityStore();
    if (!store) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "multiAgentOs is not enabled"));
      return;
    }
    const agentId = typeof params.agentId === "string" ? params.agentId : "";
    if (!agentId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing params.agentId"));
      return;
    }
    const agent = store.getOrCreate(agentId);
    respond(true, { agent });
  },

  "agents.identities.update": async ({ params, respond }) => {
    const store = getIdentityStore();
    if (!store) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "multiAgentOs is not enabled"));
      return;
    }
    const agentId = typeof params.agentId === "string" ? params.agentId : "";
    if (!agentId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing params.agentId"));
      return;
    }
    store.getOrCreate(agentId);
    if (typeof params.selfReflection === "string") store.updateSelfReflection(agentId, params.selfReflection);
    const seedPatch: Record<string, string> = {};
    if (typeof params.personality === "string") seedPatch.personality = params.personality;
    if (typeof params.displayName === "string") seedPatch.displayName = params.displayName;
    if (typeof params.avatarUrl === "string") seedPatch.avatarUrl = params.avatarUrl;
    if (Object.keys(seedPatch).length > 0) store.updateSeed(agentId, seedPatch);
    respond(true, { agent: store.getOrCreate(agentId) });
  },

  "autonomy.status": async ({ respond }) => {
    const svc = requireService(respond);
    if (!svc) return;
    respond(true, svc.getStatus());
  },

  "autonomy.start": async ({ respond }) => {
    const svc = requireService(respond);
    if (!svc) return;
    svc.start();
    respond(true, { ok: true, status: svc.getStatus() });
  },

  "autonomy.stop": async ({ respond }) => {
    const svc = requireService(respond);
    if (!svc) return;
    svc.stop();
    respond(true, { ok: true });
  },

  "autonomy.agent.spawn": async ({ params, respond }) => {
    const svc = requireService(respond);
    if (!svc) return;
    const agentId = params?.agentId as string;
    if (!agentId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "agentId is required"));
      return;
    }
    const loop = svc.spawnAgent(agentId);
    respond(true, { ok: true, state: loop.getState() });
  },

  "autonomy.agent.remove": async ({ params, respond }) => {
    const svc = requireService(respond);
    if (!svc) return;
    const agentId = params?.agentId as string;
    if (!agentId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "agentId is required"));
      return;
    }
    svc.removeAgent(agentId);
    respond(true, { ok: true });
  },

  "autonomy.agent.state": async ({ params, respond }) => {
    const svc = requireService(respond);
    if (!svc) return;
    const agentId = params?.agentId as string;
    if (!agentId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "agentId is required"));
      return;
    }
    const loop = svc.getLoop(agentId);
    if (!loop) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `Agent ${agentId} not found`));
      return;
    }
    respond(true, loop.getState());
  },

  "autonomy.agent.tick": async ({ params, respond }) => {
    const svc = requireService(respond);
    if (!svc) return;
    const agentId = params?.agentId as string;
    if (!agentId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "agentId is required"));
      return;
    }
    const result = await svc.tickAgent(agentId);
    if (!result) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `Agent ${agentId} not found`));
      return;
    }
    respond(true, result);
  },

  "autonomy.cycles": async ({ params, respond }) => {
    const svc = requireService(respond);
    if (!svc) return;
    const limit = typeof params?.limit === "number" ? params.limit : 20;
    respond(true, svc.getRecentCycles(limit));
  },
};
