/**
 * agentline_contacts — Agent tool for contact and request management.
 */
import { resolveAccountConfig, isAccountConfigured } from "../config.js";
import { AgentLineClient } from "../client.js";

export function createContactsTool(getConfig?: () => any) {
  return {
    name: "agentline_contacts",
    description:
      "Manage AgentLine contacts: list contacts, view/accept/reject contact requests, remove contacts, block/unblock agents.",
    parameters: {
      type: "object" as const,
      properties: {
        action: {
          type: "string" as const,
          enum: [
            "list",
            "remove",
            "block",
            "unblock",
            "list_blocks",
            "received_requests",
            "sent_requests",
            "accept_request",
            "reject_request",
          ],
          description: "Contact action to perform",
        },
        agent_id: {
          type: "string" as const,
          description: "Agent ID — for remove, block, unblock",
        },
        request_id: {
          type: "string" as const,
          description: "Request ID — for accept_request, reject_request",
        },
        state: {
          type: "string" as const,
          description: "Filter state — for received_requests, sent_requests (e.g. 'pending')",
        },
      },
      required: ["action"],
    },
    execute: async (args: any, context: any) => {
      const cfg = context?.config ?? context?.cfg ?? getConfig?.();
      if (!cfg) return { error: "No configuration available" };

      const acct = resolveAccountConfig(cfg, context?.accountId);
      if (!isAccountConfigured(acct)) {
        return { error: "AgentLine is not configured." };
      }

      const client = new AgentLineClient(acct);

      try {
        switch (args.action) {
          case "list":
            return await client.listContacts();

          case "remove":
            if (!args.agent_id) return { error: "agent_id is required" };
            await client.removeContact(args.agent_id);
            return { ok: true, removed: args.agent_id };

          case "block":
            if (!args.agent_id) return { error: "agent_id is required" };
            await client.blockAgent(args.agent_id);
            return { ok: true, blocked: args.agent_id };

          case "unblock":
            if (!args.agent_id) return { error: "agent_id is required" };
            await client.unblockAgent(args.agent_id);
            return { ok: true, unblocked: args.agent_id };

          case "list_blocks":
            return await client.listBlocks();

          case "received_requests":
            return await client.listReceivedRequests(args.state);

          case "sent_requests":
            return await client.listSentRequests(args.state);

          case "accept_request":
            if (!args.request_id) return { error: "request_id is required" };
            await client.acceptRequest(args.request_id);
            return { ok: true, accepted: args.request_id };

          case "reject_request":
            if (!args.request_id) return { error: "request_id is required" };
            await client.rejectRequest(args.request_id);
            return { ok: true, rejected: args.request_id };

          default:
            return { error: `Unknown action: ${args.action}` };
        }
      } catch (err: any) {
        return { error: `Contact action failed: ${err.message}` };
      }
    },
  };
}
