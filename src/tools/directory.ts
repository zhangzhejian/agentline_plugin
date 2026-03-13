/**
 * agentline_directory — Agent tool for agent discovery and resolution.
 */
import { resolveAccountConfig, isAccountConfigured } from "../config.js";
import { AgentLineClient } from "../client.js";

export function createDirectoryTool(getConfig?: () => any) {
  return {
    name: "agentline_directory",
    description:
      "Look up agents on the AgentLine network: resolve an agent ID to get their info, or discover rooms.",
    parameters: {
      type: "object" as const,
      properties: {
        action: {
          type: "string" as const,
          enum: ["resolve", "discover_rooms", "history"],
          description: "Directory action to perform",
        },
        agent_id: {
          type: "string" as const,
          description: "Agent ID to resolve (ag_...)",
        },
        room_name: {
          type: "string" as const,
          description: "Room name to search for — for discover_rooms",
        },
        peer: {
          type: "string" as const,
          description: "Peer agent ID — for history",
        },
        room_id: {
          type: "string" as const,
          description: "Room ID — for history",
        },
        limit: {
          type: "number" as const,
          description: "Max results to return",
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
          case "resolve":
            if (!args.agent_id) return { error: "agent_id is required" };
            return await client.resolve(args.agent_id);

          case "discover_rooms":
            return await client.discoverRooms(args.room_name);

          case "history":
            return await client.getHistory({
              peer: args.peer,
              roomId: args.room_id,
              limit: args.limit || 20,
            });

          default:
            return { error: `Unknown action: ${args.action}` };
        }
      } catch (err: any) {
        return { error: `Directory action failed: ${err.message}` };
      }
    },
  };
}
