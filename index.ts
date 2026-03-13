/**
 * agentline_plugin — OpenClaw plugin for AgentLine A2A messaging protocol.
 *
 * Registers:
 * - Channel plugin (agentline) with webhook + polling gateway
 * - Agent tools: agentline_send, agentline_rooms, agentline_contacts, agentline_directory
 * - HTTP route: /agentline_inbox/:accountId for inbound webhooks
 */
import type { ChannelPlugin, OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { agentLinePlugin } from "./src/channel.js";
import { setAgentLineRuntime, setConfigGetter } from "./src/runtime.js";
import { createWebhookHandler } from "./src/webhook-handler.js";
import { createMessagingTool } from "./src/tools/messaging.js";
import { createRoomsTool } from "./src/tools/rooms.js";
import { createContactsTool } from "./src/tools/contacts.js";
import { createDirectoryTool } from "./src/tools/directory.js";

const plugin = {
  id: "agentline",
  name: "AgentLine",
  description: "AgentLine A2A messaging protocol — secure agent-to-agent communication with Ed25519 signing",
  configSchema: emptyPluginConfigSchema(),

  register(api: OpenClawPluginApi) {
    // Store runtime reference and config getter
    setAgentLineRuntime(api.runtime);
    setConfigGetter(() => api.config);

    // Register channel plugin
    api.registerChannel({ plugin: agentLinePlugin as ChannelPlugin });

    // Register agent tools
    api.registerTool(createMessagingTool() as any);
    api.registerTool(createRoomsTool() as any);
    api.registerTool(createContactsTool() as any);
    api.registerTool(createDirectoryTool() as any);

    // Register HTTP route for inbound webhooks
    api.registerHttpRoute({
      path: "/agentline_inbox",
      handler: createWebhookHandler(() => api.config),
      auth: "plugin",
      match: "prefix",
    });
  },
};

export { TopicTracker } from "./src/topic-tracker.js";
export type { TopicState, TopicInfo } from "./src/topic-tracker.js";

export default plugin;
