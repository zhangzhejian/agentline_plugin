/**
 * agentline_plugin — OpenClaw plugin for AgentLine A2A messaging protocol.
 *
 * Registers:
 * - Channel plugin (agentline) with WebSocket + polling gateway
 * - Agent tools: agentline_send, agentline_upload, agentline_rooms, agentline_topics, agentline_contacts, agentline_account, agentline_directory
 * - Commands: /agentline-healthcheck, /agentline-token
 * - CLI: openclaw agentline-register
 */
import type { ChannelPlugin, OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { agentLinePlugin } from "./src/channel.js";
import { setAgentLineRuntime, setConfigGetter } from "./src/runtime.js";
import { createMessagingTool, createUploadTool } from "./src/tools/messaging.js";
import { createRoomsTool } from "./src/tools/rooms.js";
import { createContactsTool } from "./src/tools/contacts.js";
import { createDirectoryTool } from "./src/tools/directory.js";
import { createTopicsTool } from "./src/tools/topics.js";
import { createAccountTool } from "./src/tools/account.js";
import { createNotifyTool } from "./src/tools/notify.js";
import { createHealthcheckCommand } from "./src/commands/healthcheck.js";
import { createTokenCommand } from "./src/commands/token.js";
import { createRegisterCli } from "./src/commands/register.js";

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
    api.registerTool(createTopicsTool() as any);
    api.registerTool(createContactsTool() as any);
    api.registerTool(createAccountTool() as any);
    api.registerTool(createDirectoryTool() as any);
    api.registerTool(createUploadTool() as any);
    api.registerTool(createNotifyTool() as any);

    // Register commands
    api.registerCommand(createHealthcheckCommand() as any);
    api.registerCommand(createTokenCommand() as any);

    // Register CLI command
    const registerCli = createRegisterCli();
    api.registerCli(registerCli.setup, { commands: registerCli.commands });
  },
};

export { TopicTracker } from "./src/topic-tracker.js";
export type { TopicState, TopicInfo } from "./src/topic-tracker.js";

export default plugin;
