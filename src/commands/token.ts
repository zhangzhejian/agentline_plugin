/**
 * /agentline-token — Output the current JWT token for the configured account.
 */
import { resolveAccountConfig, isAccountConfigured } from "../config.js";
import { AgentLineClient } from "../client.js";
import { getConfig as getAppConfig } from "../runtime.js";

export function createTokenCommand() {
  return {
    name: "agentline-token",
    description: "Fetch and display the current AgentLine JWT token.",
    acceptsArgs: false,
    requireAuth: true,
    handler: async () => {
      const cfg = getAppConfig();
      if (!cfg) {
        return { text: "[FAIL] No OpenClaw configuration available" };
      }

      const acct = resolveAccountConfig(cfg);
      if (!isAccountConfigured(acct)) {
        return { text: "[FAIL] AgentLine is not fully configured (need hubUrl, agentId, keyId, privateKey)" };
      }

      const client = new AgentLineClient(acct);

      try {
        const token = await client.ensureToken();
        return { text: token };
      } catch (err: any) {
        return { text: `[FAIL] Token refresh failed: ${err.message}` };
      }
    },
  };
}
