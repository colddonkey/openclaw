/**
 * Multi-agent OS startup and teardown for the gateway.
 *
 * Wires together:
 *   1. Auto task generation hooks (conversation -> tasks)
 *   2. Scheduler service (ready tasks -> agent assignment)
 *   3. Telegram comms forwarding (comms messages -> Telegram)
 */

import path from "node:path";
import { loadConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import type { OpenClawConfig } from "../config/types.js";
import { CommsStore } from "../comms/store.js";
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

const log = createSubsystemLogger("multi-agent");

export type MultiAgentHandle = {
  stop: () => void;
};

let _commsStore: CommsStore | null = null;

function getCommsStore(cfg: OpenClawConfig): CommsStore | null {
  if (_commsStore) return _commsStore;
  const base = cfg.multiAgentOs?.dbPath
    ? path.dirname(cfg.multiAgentOs.dbPath)
    : path.join(resolveStateDir(), "tasks");
  _commsStore = new CommsStore(path.join(base, "comms.sqlite"));
  return _commsStore;
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
}): MultiAgentHandle {
  const { cfg, telegramSender, telegramChatId } = opts;
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
      scheduler.start();
      teardowns.push(() => scheduler?.stop());
      log.info("scheduler started");
    } else {
      log.info("scheduler disabled by config");
    }
  } catch (err) {
    log.error(`scheduler failed to start: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3. Telegram comms forwarding
  const gate = resolveMultiAgentOsGate(cfg);
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
      _commsStore = null;
      log.info("multi-agent OS services stopped");
    },
  };
}
