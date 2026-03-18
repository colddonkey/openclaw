import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { resolveConfig } from "./src/config.js";
import { createTaskerSmsWebhookHandler } from "./src/webhook.js";
import { createSmsReplyGatewayMethod, createSmsReplyHttpHandler } from "./src/reply.js";

const plugin = {
  id: "tasker-sms",
  name: "Tasker SMS",
  description:
    "Receive SMS via Tasker Android webhook and relay to Telegram forum topics, with outbound reply support via Android node",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    const config = resolveConfig(api);
    if (!config) {
      console.warn(
        "[tasker-sms] No Telegram config found. Set tasker-sms plugin config or configure channels.telegram in openclaw.json",
      );
      return;
    }

    // Admin endpoints are handled inside the webhook handler (single handler
    // avoids gateway multi-handler routing quirks).
    api.registerHttpHandler(createTaskerSmsWebhookHandler(config));

    const { handleReplyHttp, setNodeRegistry } = createSmsReplyHttpHandler(config);
    api.registerHttpHandler(handleReplyHttp);

    const gatewayMethodHandler = createSmsReplyGatewayMethod();
    api.registerGatewayMethod("tasker-sms.reply", (opts) => {
      setNodeRegistry(opts.context.nodeRegistry);
      return gatewayMethodHandler(opts);
    });
  },
};

export default plugin;
