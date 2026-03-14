/**
 * HTTP route handler for inbound AgentLine webhooks from Hub.
 * Handles POST /agentline_inbox/:accountId
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHmac } from "node:crypto";
import { dispatchInbound } from "./inbound.js";
import { resolveAccountConfig } from "./config.js";

/**
 * Parse JSON body from IncomingMessage.
 */
function parseBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        resolve({ parsed: JSON.parse(raw), raw });
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

/**
 * Verify webhook signature if webhookToken is configured.
 */
function verifyWebhookSignature(
  raw: string,
  signature: string | undefined,
  webhookToken: string,
): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", webhookToken)
    .update(raw)
    .digest("hex");
  return signature === expected || signature === `sha256=${expected}`;
}

/**
 * Create the webhook route handler for a specific config getter.
 */
export function createWebhookHandler(getConfig: () => any) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url || "/", "http://localhost");
    const pathParts = url.pathname.split("/").filter(Boolean);

    // Match /agentline_inbox/:accountId
    if (pathParts[0] !== "agentline_inbox" || !pathParts[1]) {
      return false;
    }

    const accountId = pathParts[1];
    const cfg = getConfig();
    const acct = resolveAccountConfig(cfg, accountId);

    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return true;
    }

    try {
      const { parsed: body, raw } = await parseBody(req);

      // Verify signature if token is configured
      if (acct.webhookToken) {
        const sig = req.headers["x-agentline-signature"] as string | undefined;
        if (!verifyWebhookSignature(raw, sig, acct.webhookToken)) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid signature" }));
          return true;
        }
      }

      // Extract message fields from Hub's forward format
      const senderId = body.from || body.sender_id || "unknown";
      const content = body.text || body.payload?.text || body.body || "";
      const messageId = body.message_id || body.id;
      const isRoom = body.room_id?.startsWith("rm_") || body.to?.startsWith("rm_");

      await dispatchInbound({
        cfg,
        accountId,
        senderName: body.sender_name || senderId,
        senderId,
        content,
        messageId,
        chatType: isRoom ? "group" : "direct",
        groupSubject: isRoom ? (body.room_name || body.room_id) : undefined,
        replyTarget: body.from || senderId,
        roomId: body.room_id,
        topic: body.topic,
        topicId: body.topic_id,
        mentioned: body.mentioned,
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return true;
    } catch (err: any) {
      console.error("[agentline] webhook handler error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal error" }));
      return true;
    }
  };
}
