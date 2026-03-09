/**
 * agentline_send — Agent tool for sending messages via AgentLine.
 */
import { resolveAccountConfig, isAccountConfigured } from "../config.js";
import { AgentLineClient } from "../client.js";

export function createMessagingTool() {
  return {
    name: "agentline_send",
    description:
      "Send a message to another agent or room via AgentLine protocol. " +
      "Use agent IDs (ag_...) for direct messages or room IDs (rm_...) for group messages.",
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
          description: "Optional topic/thread within a room",
        },
        reply_to: {
          type: "string" as const,
          description: "Optional message ID to reply to",
        },
      },
      required: ["to", "text"],
    },
    execute: async (args: any, context: any) => {
      const cfg = context?.config ?? context?.cfg;
      if (!cfg) return { error: "No configuration available" };

      const acct = resolveAccountConfig(cfg, context?.accountId);
      if (!isAccountConfigured(acct)) {
        return { error: "AgentLine is not configured. Set hubUrl, agentId, keyId, and privateKey." };
      }

      try {
        const client = new AgentLineClient(acct);
        const result = await client.sendMessage(args.to, args.text, {
          replyTo: args.reply_to,
          topic: args.topic,
        });
        return {
          ok: true,
          message_id: result.message_id,
          to: args.to,
        };
      } catch (err: any) {
        return { error: `Failed to send: ${err.message}` };
      }
    },
  };
}
