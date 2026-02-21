/**
 * Multi-agent OS startup and teardown for the gateway.
 *
 * Wires together:
 *   1. Auto task generation hooks (conversation -> tasks)
 *   2. Scheduler service (ready tasks -> agent assignment)
 *   3. Autonomy service (agent loops that pick up and execute tasks)
 *   4. Telegram comms forwarding (comms messages -> Telegram)
 */

import { loadConfig } from "../config/config.js";
import type { OpenClawConfig } from "../config/types.js";
import {
  forwardToTelegram,
  isTelegramForwardEnabled,
  type TelegramForwardConfig,
} from "../comms/telegram-forward.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { createSchedulerFromConfig, type SchedulerService } from "../scheduler/service.js";
import {
  registerAutoTaskGenerationHooks,
  unregisterAutoTaskGenerationHooks,
} from "../tasks/auto-generate-hook.js";
import { isMultiAgentOsEnabled, resolveMultiAgentOsGate } from "../tasks/feature-gate.js";
import { getSharedCommsStore, getSharedIdentityStore, getSharedTaskStore, initSharedAutonomyService, resetSharedStores } from "../tasks/store-registry.js";
import type { CommsStore } from "../comms/store.js";
import { createLlmExecutor } from "../autonomy/llm-executor.js";

const log = createSubsystemLogger("multi-agent");

export type MultiAgentHandle = {
  stop: () => void;
};

function getCommsStore(_cfg: OpenClawConfig): CommsStore {
  return getSharedCommsStore();
}

/**
 * Patch CommsStore.sendMessage to also forward messages to Telegram.
 *
 * Uses prototype patching (single centralized hook) rather than requiring
 * changes to every call-site. The original method is preserved and restored
 * on teardown.
 */
function hookCommsForwarding(
  commsStore: CommsStore,
  forwardConfig: TelegramForwardConfig,
): () => void {
  const original = commsStore.sendMessage.bind(commsStore);

  commsStore.sendMessage = function patchedSendMessage(input) {
    const message = original(input);

    const cfg = loadConfig();
    if (isTelegramForwardEnabled(cfg)) {
      const channel = commsStore.getChannel(input.channelId);
      if (channel) {
        forwardToTelegram(forwardConfig, channel, message).catch((err) => {
          log.error(`telegram forward failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
    }

    return message;
  };

  return () => {
    commsStore.sendMessage = original;
  };
}

/**
 * Start multi-agent OS services for the gateway.
 *
 * Returns a handle with a `stop()` method for clean shutdown.
 * All services respect their feature gates — disabled features are no-ops.
 */
export function startMultiAgentServices(opts: {
  cfg: OpenClawConfig;
  telegramSender?: TelegramForwardConfig["sender"];
  telegramChatId?: string;
  /** Optional broadcast callback so scheduler/autonomy changes reach the kanban UI. */
  broadcast?: (event: string, payload: unknown) => void;
}): MultiAgentHandle {
  const { cfg, telegramSender, telegramChatId, broadcast } = opts;
  const teardowns: Array<() => void> = [];

  if (!isMultiAgentOsEnabled(cfg)) {
    log.info("multi-agent OS disabled; skipping service startup");
    return { stop: () => {} };
  }

  log.info("starting multi-agent OS services");

  // 1. Auto task generation from conversations
  registerAutoTaskGenerationHooks(cfg);
  teardowns.push(() => unregisterAutoTaskGenerationHooks());

  // 2. Scheduler (auto-assign tasks to agents)
  let scheduler: SchedulerService | null = null;
  try {
    scheduler = createSchedulerFromConfig();
    if (scheduler) {
      // Subscribe to the scheduler's TaskStore so changes broadcast to the kanban UI.
      if (broadcast) {
        const unsub = scheduler.subscribeTaskChanges((event) => {
          broadcast("tasks.changed", event);
        });
        teardowns.push(unsub);
      }
      scheduler.start();
      teardowns.push(() => scheduler?.stop());
      log.info("scheduler started");
    } else {
      log.info("scheduler disabled by config");
    }
  } catch (err) {
    log.error(`scheduler failed to start: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3. Autonomy (auto-start agent loops on gateway boot)
  const gate = resolveMultiAgentOsGate(cfg);
  if (gate.autonomyEnabled) {
    try {
      const autonomyCfg = {
        ...cfg.multiAgentOs?.autonomy,
        tickIntervalMs: cfg.multiAgentOs?.autonomy?.tickIntervalMs ?? 30_000,
      };

      const autonomySvc = initSharedAutonomyService(
        {
          taskStore: getSharedTaskStore(),
          identityStore: getSharedIdentityStore(),
          commsStore: getSharedCommsStore(),
          workExecutor: createLlmExecutor(),
          onFleetCycle: broadcast ? (result, agentStatus) => {
            broadcast("autonomy.cycle", { cycle: result, agent: agentStatus });
          } : undefined,
          onFleetPhaseChange: broadcast ? (agentId, from, to) => {
            broadcast("autonomy.phase", { agentId, from, to });
          } : undefined,
        },
        autonomyCfg,
      );
      autonomySvc.start();
      // No manual teardown needed — resetSharedStores() handles it
      log.info(`autonomy auto-started (tick: ${autonomyCfg.tickIntervalMs}ms)`);
    } catch (err) {
      log.error(`autonomy failed to auto-start: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    log.info("autonomy disabled by config (set multiAgentOs.autonomy.enabled = true to auto-start)");
  }

  // 4. Telegram comms forwarding
  const commsTargetChatId = gate.commsTelegramGroupId ?? telegramChatId;
  if (gate.commsTelegramForward && telegramSender && commsTargetChatId) {
    try {
      const commsStore = getCommsStore(cfg);
      if (commsStore) {
        const unhook = hookCommsForwarding(commsStore, {
          chatId: commsTargetChatId,
          sender: telegramSender,
        });
        teardowns.push(unhook);
        log.info(
          `telegram comms forwarding enabled → ${gate.commsTelegramGroupId ? "group " + gate.commsTelegramGroupId : "primary DM"}`,
        );
      }
    } catch (err) {
      log.error(`telegram forward setup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (gate.commsTelegramForward) {
    log.info("telegram comms forwarding configured but no sender/chatId available (Telegram not started?)");
  }

  return {
    stop: () => {
      for (const fn of teardowns.reverse()) {
        try {
          fn();
        } catch {}
      }
      resetSharedStores();
      log.info("multi-agent OS services stopped");
    },
  };
}
