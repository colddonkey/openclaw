import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { GatewayRequestHandlerOptions } from "openclaw/plugin-sdk/core";
import type { TaskerSmsConfig } from "./config.js";

type ReadJsonBodyResult = { ok: true; value: unknown } | { ok: false; error: string };

async function readJsonBodyWithLimit(
  req: IncomingMessage,
  opts: { maxBytes: number },
): Promise<ReadJsonBodyResult> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > opts.maxBytes) {
        req.destroy();
        resolve({ ok: false, error: "body too large" });
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        resolve({ ok: true, value: JSON.parse(raw) });
      } catch {
        resolve({ ok: false, error: "invalid JSON" });
      }
    });
    req.on("error", () => resolve({ ok: false, error: "read error" }));
  });
}

const REPLY_PATH = "/tasker-sms-reply";

type ReplyPayload = {
  to: string;
  message: string;
};

function isReplyPayload(value: unknown): value is ReplyPayload {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.to === "string" && typeof obj.message === "string";
}

function safeTokenCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function sendJson(res: ServerResponse, status: number, data: Record<string, unknown>): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

function findSmsNode(nodeRegistry: {
  listConnected(): Array<{
    nodeId: string;
    platform?: string;
    commands: string[];
  }>;
}): string | null {
  const nodes = nodeRegistry.listConnected();
  for (const node of nodes) {
    if (node.commands.includes("sms.send")) {
      return node.nodeId;
    }
  }
  return null;
}

export function createSmsReplyGatewayMethod() {
  return async function handleSmsReply(opts: GatewayRequestHandlerOptions): Promise<void> {
    const { params, respond, context } = opts;
    const to = typeof params.to === "string" ? params.to.trim() : "";
    const message = typeof params.message === "string" ? params.message.trim() : "";

    if (!to || !message) {
      respond(false, undefined, {
        code: -32602,
        message: "missing required params: to, message",
      });
      return;
    }

    const nodeId = findSmsNode(context.nodeRegistry);
    if (!nodeId) {
      respond(false, undefined, {
        code: -32603,
        message: "no connected Android node with sms.send capability",
      });
      return;
    }

    const result = await context.nodeRegistry.invoke({
      nodeId,
      command: "sms.send",
      params: { to, message },
      timeoutMs: 15_000,
    });

    if (result.ok) {
      console.log(`[tasker-sms] Sent SMS to ${to} via node ${nodeId}`);
      respond(true, { sent: true, nodeId });
    } else {
      console.error(`[tasker-sms] SMS send failed:`, result.error);
      respond(false, undefined, {
        code: -32603,
        message: result.error?.message ?? "sms.send failed",
      });
    }
  };
}

export function createSmsReplyHttpHandler(config: TaskerSmsConfig) {
  const expectedToken = config.webhookToken || null;

  let nodeRegistryRef: GatewayRequestHandlerOptions["context"]["nodeRegistry"] | null = null;

  function setNodeRegistry(nr: typeof nodeRegistryRef) {
    nodeRegistryRef = nr;
  }

  async function handleReplyHttp(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== REPLY_PATH) return false;

    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Allow", "POST");
      res.end("Method Not Allowed");
      return true;
    }

    if (expectedToken) {
      const provided = (req.headers["x-tasker-token"] as string | undefined) ?? "";
      if (!provided || !safeTokenCompare(provided, expectedToken)) {
        sendJson(res, 401, { error: "unauthorized" });
        return true;
      }
    }

    const bodyResult = await readJsonBodyWithLimit(req, { maxBytes: 64 * 1024 });
    if (!bodyResult.ok) {
      sendJson(res, 400, { error: bodyResult.error });
      return true;
    }

    if (!isReplyPayload(bodyResult.value)) {
      sendJson(res, 400, { error: "invalid payload: requires 'to' and 'message' fields" });
      return true;
    }

    const { to, message } = bodyResult.value;

    if (!nodeRegistryRef) {
      sendJson(res, 503, {
        error: "node registry not available yet; send a message via the gateway first",
      });
      return true;
    }

    const nodeId = findSmsNode(nodeRegistryRef);
    if (!nodeId) {
      sendJson(res, 503, { error: "no connected Android node with sms.send capability" });
      return true;
    }

    const result = await nodeRegistryRef.invoke({
      nodeId,
      command: "sms.send",
      params: { to, message },
      timeoutMs: 15_000,
    });

    if (result.ok) {
      console.log(`[tasker-sms] Sent SMS to ${to} via node ${nodeId}`);
      sendJson(res, 200, { ok: true, sent: true, nodeId });
    } else {
      console.error(`[tasker-sms] SMS send failed:`, result.error);
      sendJson(res, 502, { ok: false, error: result.error?.message ?? "sms.send failed" });
    }

    return true;
  }

  return { handleReplyHttp, setNodeRegistry };
}
