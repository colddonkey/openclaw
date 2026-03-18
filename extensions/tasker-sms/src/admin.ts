/**
 * Admin HTTP endpoints for tasker-sms plugin.
 * - GET  /tasker-sms-health          -- health check
 * - GET  /tasker-sms-contacts        -- list all mapped contacts
 * - GET  /tasker-sms-topic?number=+1234 -- look up a specific contact's topic
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { contactCount, listContacts, getThread, normalizePhone } from "./thread-store.js";

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

/**
 * Try to handle an admin request. Returns true if handled, false to pass.
 * Called from the main webhook handler so everything is in a single
 * registered HTTP handler (avoids multi-handler gateway issues).
 */
export function tryHandleAdmin(
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/tasker-sms-health" && req.method === "GET") {
    sendJson(res, 200, {
      ok: true,
      contacts: contactCount(),
      uptime: process.uptime(),
    });
    return true;
  }

  if (url.pathname === "/tasker-sms-contacts" && req.method === "GET") {
    sendJson(res, 200, listContacts());
    return true;
  }

  if (url.pathname === "/tasker-sms-topic" && req.method === "GET") {
    const number = url.searchParams.get("number") ?? "";
    if (!number) {
      sendJson(res, 400, { error: "missing number parameter" });
      return true;
    }
    const entry = getThread(number);
    if (entry) {
      sendJson(res, 200, {
        phone: normalizePhone(number),
        name: entry.name,
        threadId: entry.threadId,
        messageCount: entry.messageCount ?? 0,
      });
    } else {
      sendJson(res, 404, { error: "not found" });
    }
    return true;
  }

  return false;
}
