/**
 * agentline_send — Agent tool for sending messages via AgentLine.
 */
import { resolveAccountConfig, isAccountConfigured } from "../config.js";
import { AgentLineClient } from "../client.js";
import { getConfig as getAppConfig } from "../runtime.js";
import type { MessageAttachment } from "../types.js";

export function createMessagingTool() {
  return {
    name: "agentline_send",
    description:
      "Send a message to another agent or room via AgentLine. " +
      "Use ag_* for direct messages, rm_* for rooms. " +
      "Set type to 'result' or 'error' to terminate a topic. " +
      "Attach files via file_urls (array of URLs).",
    parameters: {
      type: "object" as const,
      properties: {
        to: {
          type: "string" as const,
          description: "Target agent ID (ag_...) or room ID (rm_...)",
        },
        text: {
          type: "string" as const,
          description: "Message text to send",
        },
        topic: {
          type: "string" as const,
          description: "Topic name for the conversation",
        },
        goal: {
          type: "string" as const,
          description: "Goal of the conversation — declares why the topic exists",
        },
        type: {
          type: "string" as const,
          enum: ["message", "result", "error"],
          description: "Message type: 'message' (default), 'result' (task done), 'error' (task failed)",
        },
        reply_to: {
          type: "string" as const,
          description: "Message ID to reply to",
        },
        mentions: {
          type: "array" as const,
          items: { type: "string" as const },
          description: 'Agent IDs to mention (e.g. ["ag_xxx"]). Use ["@all"] to mention everyone.',
        },
        file_urls: {
          type: "array" as const,
          items: { type: "string" as const },
          description: "URLs of files to attach to the message",
        },
      },
      required: ["to", "text"],
    },
    execute: async (toolCallId: any, args: any, signal?: any, onUpdate?: any) => {
      const cfg = getAppConfig();
      if (!cfg) return { error: "No configuration available" };

      const acct = resolveAccountConfig(cfg);
      if (!isAccountConfigured(acct)) {
        return { error: "AgentLine is not configured. Set hubUrl, agentId, keyId, and privateKey." };
      }

      try {
        const client = new AgentLineClient(acct);
        const msgType = args.type || "message";

        // Build attachments from file_urls
        const attachments: MessageAttachment[] | undefined =
          args.file_urls && args.file_urls.length > 0
            ? args.file_urls.map((url: string) => ({
                filename: url.split("/").pop() || "attachment",
                url,
              }))
            : undefined;

        if (msgType === "message") {
          const result = await client.sendMessage(args.to, args.text, {
            replyTo: args.reply_to,
            topic: args.topic,
            goal: args.goal,
            mentions: args.mentions,
            attachments,
          });
          return { ok: true, hub_msg_id: result.hub_msg_id, to: args.to };
        }

        // result/error types — use sendTypedMessage for topic termination
        const result = await client.sendTypedMessage(args.to, msgType, args.text, {
          replyTo: args.reply_to,
          topic: args.topic,
        });
        return { ok: true, hub_msg_id: result.hub_msg_id, to: args.to, type: msgType };
      } catch (err: any) {
        return { error: `Failed to send: ${err.message}` };
      }
    },
  };
}
