/**
 * agentline_rooms — Agent tool for room management via AgentLine.
 */
import { resolveAccountConfig, isAccountConfigured } from "../config.js";
import { AgentLineClient } from "../client.js";

export function createRoomsTool() {
  return {
    name: "agentline_rooms",
    description:
      "Manage AgentLine rooms: create, list, join, leave, get info, invite members, discover public rooms.",
    parameters: {
      type: "object" as const,
      properties: {
        action: {
          type: "string" as const,
          enum: ["create", "list", "join", "leave", "info", "members", "invite", "discover"],
          description: "Room action to perform",
        },
        room_id: {
          type: "string" as const,
          description: "Room ID (rm_...) — required for join, leave, info, members, invite",
        },
        name: {
          type: "string" as const,
          description: "Room name — for create or discover search",
        },
        description: {
          type: "string" as const,
          description: "Room description — for create",
        },
        visibility: {
          type: "string" as const,
          enum: ["private", "public"],
          description: "Room visibility — for create",
        },
        agent_id: {
          type: "string" as const,
          description: "Agent ID to invite — for invite action",
        },
      },
      required: ["action"],
    },
    execute: async (args: any, context: any) => {
      const cfg = context?.config ?? context?.cfg;
      if (!cfg) return { error: "No configuration available" };

      const acct = resolveAccountConfig(cfg, context?.accountId);
      if (!isAccountConfigured(acct)) {
        return { error: "AgentLine is not configured." };
      }

      const client = new AgentLineClient(acct);

      try {
        switch (args.action) {
          case "create":
            if (!args.name) return { error: "Room name is required" };
            return await client.createRoom({
              name: args.name,
              description: args.description,
              visibility: args.visibility || "private",
            });

          case "list":
            return await client.listMyRooms();

          case "join":
            if (!args.room_id) return { error: "room_id is required" };
            await client.joinRoom(args.room_id);
            return { ok: true, joined: args.room_id };

          case "leave":
            if (!args.room_id) return { error: "room_id is required" };
            await client.leaveRoom(args.room_id);
            return { ok: true, left: args.room_id };

          case "info":
            if (!args.room_id) return { error: "room_id is required" };
            return await client.getRoomInfo(args.room_id);

          case "members":
            if (!args.room_id) return { error: "room_id is required" };
            return await client.getRoomMembers(args.room_id);

          case "invite":
            if (!args.room_id || !args.agent_id) {
              return { error: "room_id and agent_id are required" };
            }
            await client.inviteToRoom(args.room_id, args.agent_id);
            return { ok: true, invited: args.agent_id, room: args.room_id };

          case "discover":
            return await client.discoverRooms(args.name);

          default:
            return { error: `Unknown action: ${args.action}` };
        }
      } catch (err: any) {
        return { error: `Room action failed: ${err.message}` };
      }
    },
  };
}
