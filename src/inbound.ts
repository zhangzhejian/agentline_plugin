/**
 * Inbound message dispatch — shared by webhook and polling paths.
 * Converts AgentLine messages to OpenClaw inbound format.
 */
import { getAgentLineRuntime } from "./runtime.js";
import { resolveAccountConfig, displayPrefix } from "./config.js";
import { AgentLineClient } from "./client.js";
import { buildSessionKey } from "./session-key.js";
import type { AgentLineAccountConfig } from "./types.js";

export interface InboundParams {
  cfg: any;
  accountId: string;
  senderName: string;
  senderId: string;
  content: string;
  messageId?: string;
  chatType: "direct" | "group";
  groupSubject?: string;
  replyTarget: string;
  roomId?: string;
  topic?: string;
}

/**
 * Route an outbound reply back to AgentLine Hub.
 */
async function sendReply(
  acct: AgentLineAccountConfig,
  target: string,
  text: string,
  options?: { topic?: string },
): Promise<void> {
  const client = new AgentLineClient(acct);
  await client.sendMessage(target, text, { topic: options?.topic });
}

/**
 * Dispatch an inbound message into OpenClaw's channel routing system.
 */
export async function dispatchInbound(params: InboundParams): Promise<void> {
  const core = getAgentLineRuntime();
  const {
    cfg,
    accountId,
    senderName,
    senderId,
    content,
    messageId,
    chatType,
    groupSubject,
    replyTarget,
    roomId,
    topic,
  } = params;

  const from = `agentline:${senderId}`;
  const to = `agentline:${accountId}`;
  const dp = displayPrefix(accountId, cfg);
  const sessionKey = buildSessionKey(roomId, topic);

  const route = core.channel.routing.resolveAgentRoute({
    channel: "agentline",
    from,
    chatType,
    groupSubject: chatType === "group" ? (groupSubject || replyTarget) : undefined,
    cfg,
  });

  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(cfg);
  const formattedBody = core.channel.reply.formatAgentEnvelope({
    channel: "AgentLine",
    from: senderName,
    timestamp: new Date(),
    envelope: envelopeOptions,
    body: content,
  });

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: formattedBody,
    BodyForAgent: content,
    RawBody: content,
    CommandBody: content,
    From: from,
    To: to,
    SessionKey: route.sessionKey || sessionKey,
    AccountId: accountId,
    ChatType: chatType,
    GroupSubject: chatType === "group" ? (groupSubject || replyTarget) : undefined,
    SenderName: senderName,
    SenderId: senderId,
    Provider: "agentline" as const,
    Surface: "agentline" as const,
    MessageSid: messageId || `agentline-${Date.now()}`,
    Timestamp: Date.now(),
    WasMentioned: true,
    CommandAuthorized: true,
    OriginatingChannel: "agentline" as const,
    OriginatingTo: to,
    ConversationLabel: chatType === "group" ? (groupSubject || senderName) : senderName,
  });

  const acct = resolveAccountConfig(cfg, accountId);

  await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg,
    dispatcherOptions: {
      deliver: async (payload: any) => {
        const text =
          typeof payload === "string"
            ? payload
            : payload?.text ?? payload?.body ?? String(payload);
        if (!text?.trim()) return;

        try {
          await sendReply(acct, replyTarget, text, { topic });
        } catch (err: any) {
          console.error(`[agentline] reply failed:`, err);
        }
      },
      onError: (err: any, info: any) => {
        console.error(`[agentline] ${info?.kind ?? "unknown"} reply error:`, err);
      },
    },
    replyOptions: {},
  });
}
