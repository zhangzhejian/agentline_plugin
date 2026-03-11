/**
 * Inbound message dispatch — shared by webhook and polling paths.
 * Converts AgentLine messages to OpenClaw inbound format.
 */
import { getAgentLineRuntime } from "./runtime.js";
import { resolveAccountConfig, displayPrefix } from "./config.js";
import { AgentLineClient } from "./client.js";
import { buildSessionKey } from "./session-key.js";
import type { AgentLineAccountConfig, InboxMessage, MessageType } from "./types.js";

// Envelope types that count as notifications rather than normal messages
const NOTIFICATION_TYPES: ReadonlySet<string> = new Set([
  "contact_request",
  "contact_request_response",
  "contact_removed",
  "system",
]);

/**
 * Build a structured header line for inbound messages, e.g.:
 *   [AgentLine Message] from: Link (ag_xxx) | to: ag_yyy | room: My Room
 */
function buildInboundHeader(params: {
  type: MessageType;
  senderName: string;
  accountId: string;
  chatType: "direct" | "group";
  roomName?: string;
}): string {
  const tag = NOTIFICATION_TYPES.has(params.type)
    ? "[AgentLine Notification]"
    : "[AgentLine Message]";

  const parts = [
    tag,
    `from: ${params.senderName}`,
    `to: ${params.accountId}`,
  ];

  if (params.chatType === "group" && params.roomName) {
    parts.push(`room: ${params.roomName}`);
  }

  return parts.join(" | ");
}

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
 * Shared handler for InboxMessage — used by both WebSocket and Poller paths.
 * Normalizes InboxMessage into InboundParams and dispatches to OpenClaw.
 */
export async function handleInboxMessage(
  msg: InboxMessage,
  accountId: string,
  cfg: any,
): Promise<void> {
  const envelope = msg.envelope;
  const senderId = envelope.from || "unknown";
  const rawContent =
    msg.text ||
    (typeof envelope.payload === "string"
      ? envelope.payload
      : envelope.payload?.text ?? JSON.stringify(envelope.payload));
  const isRoom = !!msg.room_id;
  const chatType = isRoom ? "group" : "direct";

  const header = buildInboundHeader({
    type: envelope.type,
    senderName: senderId,
    accountId,
    chatType,
    roomName: isRoom ? (msg.room_name || msg.room_id) : undefined,
  });
  const content = `${header}\n${rawContent}`;

  await dispatchInbound({
    cfg,
    accountId,
    senderName: senderId,
    senderId,
    content: content as string,
    messageId: envelope.msg_id,
    chatType,
    groupSubject: isRoom ? (msg.room_name || msg.room_id) : undefined,
    replyTarget: isRoom ? msg.room_id! : (envelope.from || ""),
    roomId: msg.room_id,
    topic: msg.topic,
  });
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
