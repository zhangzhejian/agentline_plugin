/**
 * Configuration resolution for AgentLine channel.
 * Supports single-account and multi-account setups.
 */
import type { AgentLineAccountConfig, AgentLineChannelConfig } from "./types.js";

export function resolveChannelConfig(cfg: any): AgentLineChannelConfig {
  return (cfg?.channels?.agentline ?? {}) as AgentLineChannelConfig;
}

/** Resolve all account configs, supporting both single and multi-account. */
export function resolveAccounts(
  channelCfg: AgentLineChannelConfig,
): Record<string, AgentLineAccountConfig> {
  if (channelCfg.accounts && Object.keys(channelCfg.accounts).length > 0) {
    return channelCfg.accounts;
  }
  // Single-account fallback
  return {
    default: {
      enabled: channelCfg.enabled,
      hubUrl: channelCfg.hubUrl,
      agentId: channelCfg.agentId,
      keyId: channelCfg.keyId,
      privateKey: channelCfg.privateKey,
      publicKey: channelCfg.publicKey,
      deliveryMode: channelCfg.deliveryMode,
      pollIntervalMs: channelCfg.pollIntervalMs,
      webhookToken: channelCfg.webhookToken,
      allowFrom: channelCfg.allowFrom,
    },
  };
}

export function resolveAccountConfig(
  cfg: any,
  accountId?: string,
): AgentLineAccountConfig {
  const channelCfg = resolveChannelConfig(cfg);
  const accounts = resolveAccounts(channelCfg);
  const id = accountId || "default";
  return accounts[id] || accounts[Object.keys(accounts)[0]] || {};
}

export function isAccountConfigured(acct: AgentLineAccountConfig): boolean {
  return !!(acct.hubUrl && acct.agentId && acct.keyId && acct.privateKey);
}

export function countAccounts(cfg: any): number {
  const channelCfg = resolveChannelConfig(cfg);
  return Object.keys(resolveAccounts(channelCfg)).length;
}

/** Display prefix for logs and messages. */
export function displayPrefix(accountId: string, cfg: any): string {
  const total = countAccounts(cfg);
  if (total <= 1 && accountId === "default") return "AgentLine";
  return `AgentLine:${accountId}`;
}
