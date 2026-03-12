/**
 * AgentLine ChannelPlugin — defines meta, capabilities, config,
 * outbound (send via signed envelopes), gateway (start webhook/polling),
 * security, messaging, and status adapters.
 */
import type { ChannelPlugin, ClawdbotConfig } from "openclaw/plugin-sdk";
import {
  buildBaseChannelStatusSummary,
  buildChannelConfigSchema,
  createDefaultChannelRuntimeState,
  DEFAULT_ACCOUNT_ID,
  deleteAccountFromConfigSection,
  setAccountEnabledInConfigSection,
} from "openclaw/plugin-sdk";
import {
  resolveChannelConfig,
  resolveAccounts,
  resolveAccountConfig,
  isAccountConfigured,
  displayPrefix,
} from "./config.js";
import { AgentLineClient } from "./client.js";
import { buildSessionKey } from "./session-key.js";
import { getAgentLineRuntime } from "./runtime.js";
import { startPoller, stopPoller } from "./poller.js";
import { startWsClient, stopWsClient } from "./ws-client.js";
import type {
  AgentLineAccountConfig,
  AgentLineChannelConfig,
  MessageAttachment,
} from "./types.js";

// ── Types ────────────────────────────────────────────────────────

export interface ResolvedAgentLineAccount {
  accountId: string;
  name: string;
  enabled: boolean;
  configured: boolean;
  config: AgentLineAccountConfig;
  hubUrl?: string;
  agentId?: string;
  deliveryMode?: "webhook" | "polling" | "websocket";
}

type CoreConfig = any;

// ── Account resolution ───────────────────────────────────────────

function resolveAgentLineAccount(params: {
  cfg: CoreConfig;
  accountId?: string;
}): ResolvedAgentLineAccount {
  const channelCfg = resolveChannelConfig(params.cfg);
  const accounts = resolveAccounts(channelCfg);
  const id = params.accountId || Object.keys(accounts)[0] || "default";
  const acct = accounts[id] || ({} as AgentLineAccountConfig);

  return {
    accountId: id,
    name: id === "default" ? "AgentLine" : `AgentLine:${id}`,
    enabled: acct.enabled !== false,
    configured: isAccountConfigured(acct),
    config: acct,
    hubUrl: acct.hubUrl,
    agentId: acct.agentId,
    deliveryMode: acct.deliveryMode || "websocket",
  };
}

function listAgentLineAccountIds(cfg: CoreConfig): string[] {
  const channelCfg = resolveChannelConfig(cfg);
  return Object.keys(resolveAccounts(channelCfg));
}

function resolveDefaultAccountId(cfg: CoreConfig): string {
  const ids = listAgentLineAccountIds(cfg);
  return ids[0] || "default";
}

// ── Normalize helpers ────────────────────────────────────────────

function normalizeAgentLineTarget(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("ag_") || trimmed.startsWith("rm_")) return trimmed;
  if (trimmed.startsWith("agentline:")) return trimmed.slice("agentline:".length);
  return trimmed;
}

function looksLikeAgentLineId(raw: string): boolean {
  const t = raw.trim();
  return t.startsWith("ag_") || t.startsWith("rm_") || t.startsWith("agentline:");
}

// ── Config schema ────────────────────────────────────────────────

const agentLineConfigSchema = {
  type: "object" as const,
  additionalProperties: false as const,
  properties: {
    enabled: { type: "boolean" as const },
    hubUrl: { type: "string" as const, description: "AgentLine Hub URL" },
    agentId: { type: "string" as const, description: "Agent ID (ag_...)" },
    keyId: { type: "string" as const, description: "Key ID for signing" },
    privateKey: { type: "string" as const, description: "Ed25519 private key (base64)" },
    publicKey: { type: "string" as const, description: "Ed25519 public key (base64)" },
    deliveryMode: {
      type: "string" as const,
      enum: ["websocket", "webhook", "polling"],
    },
    pollIntervalMs: { type: "number" as const },
    webhookToken: { type: "string" as const },
    allowFrom: {
      type: "array" as const,
      items: { type: "string" as const },
    },
    accounts: {
      type: "object" as const,
      additionalProperties: {
        type: "object" as const,
        properties: {
          enabled: { type: "boolean" as const },
          hubUrl: { type: "string" as const },
          agentId: { type: "string" as const },
          keyId: { type: "string" as const },
          privateKey: { type: "string" as const },
          publicKey: { type: "string" as const },
          deliveryMode: { type: "string" as const, enum: ["websocket", "webhook", "polling"] },
          pollIntervalMs: { type: "number" as const },
          webhookToken: { type: "string" as const },
        },
      },
    },
  },
};

// ── Channel Plugin ───────────────────────────────────────────────

export const agentLinePlugin: ChannelPlugin<ResolvedAgentLineAccount> = {
  id: "agentline",
  meta: {
    id: "agentline",
    label: "AgentLine",
    selectionLabel: "AgentLine (A2A Protocol)",
    order: 110,
    quickstartAllowFrom: true,
  },
  capabilities: {
    chatTypes: ["direct", "group"],
    media: false,
    blockStreaming: true,
  },
  reload: { configPrefixes: ["channels.agentline"] },
  configSchema: {
    schema: agentLineConfigSchema,
  },
  config: {
    listAccountIds: (cfg) => listAgentLineAccountIds(cfg as CoreConfig),
    resolveAccount: (cfg, accountId) =>
      resolveAgentLineAccount({ cfg: cfg as CoreConfig, accountId }),
    defaultAccountId: (cfg) => resolveDefaultAccountId(cfg as CoreConfig),
    setAccountEnabled: ({ cfg, accountId, enabled }) => {
      const isDefault = accountId === DEFAULT_ACCOUNT_ID;
      if (isDefault) {
        return {
          ...cfg,
          channels: {
            ...(cfg as any).channels,
            agentline: {
              ...(cfg as any).channels?.agentline,
              enabled,
            },
          },
        };
      }
      const agentlineCfg = (cfg as any).channels?.agentline as AgentLineChannelConfig | undefined;
      return {
        ...cfg,
        channels: {
          ...(cfg as any).channels,
          agentline: {
            ...agentlineCfg,
            accounts: {
              ...agentlineCfg?.accounts,
              [accountId]: {
                ...agentlineCfg?.accounts?.[accountId],
                enabled,
              },
            },
          },
        },
      };
    },
    deleteAccount: ({ cfg, accountId }) => {
      const isDefault = accountId === DEFAULT_ACCOUNT_ID;
      if (isDefault) {
        const next = { ...cfg } as ClawdbotConfig;
        const nextChannels = { ...(cfg as any).channels };
        delete (nextChannels as Record<string, unknown>).agentline;
        if (Object.keys(nextChannels).length > 0) {
          next.channels = nextChannels;
        } else {
          delete next.channels;
        }
        return next;
      }
      const agentlineCfg = (cfg as any).channels?.agentline as AgentLineChannelConfig | undefined;
      const accounts = { ...agentlineCfg?.accounts };
      delete accounts[accountId];
      return {
        ...cfg,
        channels: {
          ...(cfg as any).channels,
          agentline: {
            ...agentlineCfg,
            accounts: Object.keys(accounts).length > 0 ? accounts : undefined,
          },
        },
      };
    },
    isConfigured: (account) => account.configured,
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      hubUrl: account.hubUrl,
      agentId: account.agentId,
      deliveryMode: account.deliveryMode,
    }),
    resolveAllowFrom: ({ cfg, accountId }) => {
      const account = resolveAgentLineAccount({ cfg: cfg as CoreConfig, accountId });
      return (account.config.allowFrom ?? []).map((entry) => String(entry));
    },
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.replace(/^agentline:/i, "").toLowerCase()),
  },
  security: {
    collectWarnings: ({ cfg, accountId }) => {
      const account = resolveAgentLineAccount({ cfg: cfg as CoreConfig, accountId });
      const warnings: string[] = [];
      if (!account.config.privateKey) {
        warnings.push(
          "- AgentLine private key is not configured; messages cannot be signed.",
        );
      }
      if (
        account.deliveryMode === "webhook" &&
        !account.config.webhookToken
      ) {
        warnings.push(
          "- AgentLine webhook mode is enabled but no webhookToken is set; inbound messages will not be verified.",
        );
      }
      return warnings;
    },
  },
  messaging: {
    normalizeTarget: (raw) => normalizeAgentLineTarget(raw),
    targetResolver: {
      looksLikeId: looksLikeAgentLineId,
      hint: "<ag_id|rm_id>",
    },
  },
  resolver: {
    resolveTargets: async ({ inputs, kind }) => {
      return inputs.map((input) => {
        const normalized = normalizeAgentLineTarget(input);
        if (!normalized) {
          return { input, resolved: false, note: "invalid AgentLine target" };
        }
        if (kind === "group" && !normalized.startsWith("rm_")) {
          return { input, resolved: false, note: "expected room target (rm_...)" };
        }
        return {
          input,
          resolved: true,
          id: normalized,
          name: normalized,
        };
      });
    },
  },
  directory: {
    self: async ({ cfg, accountId }) => {
      const account = resolveAgentLineAccount({ cfg: cfg as CoreConfig, accountId });
      if (!account.configured || !account.agentId) return null;
      try {
        const client = new AgentLineClient(account.config);
        const info = await client.resolve(account.agentId);
        return { kind: "user", id: info.agent_id, name: info.display_name || info.agent_id };
      } catch {
        return { kind: "user", id: account.agentId, name: account.agentId };
      }
    },
    listPeers: async ({ cfg, accountId, query, limit }) => {
      const account = resolveAgentLineAccount({ cfg: cfg as CoreConfig, accountId });
      if (!account.configured) return [];
      try {
        const client = new AgentLineClient(account.config);
        const contacts = await client.listContacts();
        const q = query?.trim().toLowerCase() ?? "";
        return contacts
          .filter((c) => !q || c.agent_id.toLowerCase().includes(q) || c.display_name?.toLowerCase().includes(q))
          .slice(0, limit && limit > 0 ? limit : undefined)
          .map((c) => ({ kind: "user" as const, id: c.agent_id, name: c.display_name || c.agent_id }));
      } catch {
        return [];
      }
    },
    listGroups: async ({ cfg, accountId, query, limit }) => {
      const account = resolveAgentLineAccount({ cfg: cfg as CoreConfig, accountId });
      if (!account.configured) return [];
      try {
        const client = new AgentLineClient(account.config);
        const rooms = await client.listMyRooms();
        const q = query?.trim().toLowerCase() ?? "";
        return rooms
          .filter((r) => !q || r.room_id.toLowerCase().includes(q) || r.name?.toLowerCase().includes(q))
          .slice(0, limit && limit > 0 ? limit : undefined)
          .map((r) => ({ kind: "group" as const, id: r.room_id, name: r.name || r.room_id }));
      } catch {
        return [];
      }
    },
  },
  outbound: {
    deliveryMode: "direct",
    chunker: (text, limit) => getAgentLineRuntime().channel.text.chunkMarkdownText(text, limit),
    chunkerMode: "markdown",
    textChunkLimit: 4000,
    sendText: async ({ cfg, to, text, accountId }) => {
      const account = resolveAgentLineAccount({ cfg: cfg as CoreConfig, accountId: accountId ?? undefined });
      const client = new AgentLineClient(account.config);
      const result = await client.sendMessage(to, text);
      return {
        channel: "agentline",
        ok: true,
        messageId: result.message_id,
      };
    },
    sendMedia: async ({ cfg, to, text, mediaUrl, accountId }) => {
      const account = resolveAgentLineAccount({ cfg: cfg as CoreConfig, accountId: accountId ?? undefined });
      const client = new AgentLineClient(account.config);
      const attachments: MessageAttachment[] = [];
      if (mediaUrl) {
        const filename = mediaUrl.split("/").pop() || "attachment";
        attachments.push({ filename, url: mediaUrl });
      }
      const result = await client.sendMessage(to, text, {
        attachments: attachments.length > 0 ? attachments : undefined,
      });
      return {
        channel: "agentline",
        ok: true,
        messageId: result.message_id,
      };
    },
  },
  status: {
    defaultRuntime: createDefaultChannelRuntimeState(DEFAULT_ACCOUNT_ID),
    buildChannelSummary: ({ snapshot }) => ({
      ...buildBaseChannelStatusSummary(snapshot),
    }),
    buildAccountSnapshot: ({ account, runtime }) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
      name: account.name,
      hubUrl: account.hubUrl,
      agentId: account.agentId,
      deliveryMode: account.deliveryMode,
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
    }),
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      if (!account.configured) {
        throw new Error(
          `AgentLine is not configured for account "${account.accountId}" (need hubUrl, agentId, keyId, privateKey).`,
        );
      }

      const dp = displayPrefix(account.accountId, ctx.cfg);
      ctx.log?.info(`[${dp}] starting AgentLine gateway (${account.deliveryMode} mode)`);

      const client = new AgentLineClient(account.config);
      const mode = account.deliveryMode || "websocket";

      if (mode === "websocket") {
        ctx.log?.info(`[${dp}] starting WebSocket connection to Hub`);
        startWsClient({
          client,
          accountId: account.accountId,
          cfg: ctx.cfg,
          abortSignal: ctx.abortSignal,
          log: ctx.log,
        });
      } else if (mode === "webhook") {
        const webhookUrl = ctx.runtime.gateway?.getExternalUrl?.();
        if (webhookUrl) {
          try {
            await client.registerEndpoint(
              `${webhookUrl}/agentline_inbox/${account.accountId}`,
              account.config.webhookToken,
            );
            ctx.log?.info(`[${dp}] webhook endpoint registered`);
          } catch (err: any) {
            ctx.log?.error(`[${dp}] failed to register webhook: ${err.message}`);
          }
        } else {
          ctx.log?.warn(`[${dp}] webhook mode but no external URL available, falling back to polling`);
        }
        startPoller({
          client,
          accountId: account.accountId,
          cfg: ctx.cfg,
          intervalMs: account.config.pollIntervalMs || 5000,
          abortSignal: ctx.abortSignal,
          log: ctx.log,
        });
      } else {
        startPoller({
          client,
          accountId: account.accountId,
          cfg: ctx.cfg,
          intervalMs: account.config.pollIntervalMs || 5000,
          abortSignal: ctx.abortSignal,
          log: ctx.log,
        });
      }

      ctx.setStatus({ accountId: ctx.accountId, running: true, lastStartAt: new Date() });

      return {
        stop: async () => {
          stopWsClient(account.accountId);
          stopPoller(account.accountId);
          ctx.setStatus({ accountId: ctx.accountId, running: false, lastStopAt: new Date() });
        },
      };
    },
  },
};
