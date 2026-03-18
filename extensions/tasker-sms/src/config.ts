import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

export type TaskerSmsConfig = {
  webhookToken: string;
  telegramBotToken: string;
  telegramChatId: string;
};

/**
 * Resolve tasker-sms config from plugin config or fall back to
 * the main openclaw config (hooks.token, channels.telegram.*).
 */
export function resolveConfig(api: OpenClawPluginApi): TaskerSmsConfig | null {
  const pluginCfg = api.config as Record<string, unknown>;
  const pluginSms = pluginCfg["tasker-sms"] as Record<string, unknown> | undefined;

  if (pluginSms?.telegramBotToken && pluginSms?.telegramChatId) {
    return {
      webhookToken: String(pluginSms.webhookToken ?? ""),
      telegramBotToken: String(pluginSms.telegramBotToken),
      telegramChatId: String(pluginSms.telegramChatId),
    };
  }

  const hooksCfg = pluginCfg.hooks as { token?: string } | undefined;
  const channelsCfg = pluginCfg.channels as {
    telegram?: { botToken?: string; groups?: Record<string, unknown> };
  } | undefined;
  const tgCfg = channelsCfg?.telegram;
  const botToken = tgCfg?.botToken ?? null;
  const chatId = tgCfg?.groups ? Object.keys(tgCfg.groups)[0] ?? null : null;

  if (!botToken || !chatId) return null;

  return {
    webhookToken: hooksCfg?.token ?? "",
    telegramBotToken: botToken,
    telegramChatId: chatId,
  };
}
