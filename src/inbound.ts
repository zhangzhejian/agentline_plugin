/**
 * Inbound message dispatch — shared by webhook and polling paths.
 * Converts AgentLine messages to OpenClaw inbound format.
 */
import { getAgentLineRuntime } from "./runtime.js";
import { buildSessionKey } from "./session-key.js";
import type { InboxMessage, MessageType } from "./types.js";

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
  topicId?: string;
  mentioned?: boolean;
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
  // DM rooms have rm_dm_ prefix; only non-DM rooms are true group chats
  const isGroupRoom = !!msg.room_id && !msg.room_id.startsWith("rm_dm_");
  const chatType = isGroupRoom ? "group" : "direct";

  const header = buildInboundHeader({
    type: envelope.type,
    senderName: senderId,
    accountId,
    chatType,
    roomName: isGroupRoom ? (msg.room_name || msg.room_id) : undefined,
  });
  const dmSilentHint =
    chatType === "direct"
      ? '\n\n[If the conversation has naturally concluded or no response is needed, reply with exactly "NO_REPLY" and nothing else.]'
      : "";
  const content = `${header}\n${rawContent}${dmSilentHint}`;

  await dispatchInbound({
    cfg,
    accountId,
    senderName: senderId,
    senderId,
    content: content as string,
    messageId: envelope.msg_id,
    chatType,
    groupSubject: isGroupRoom ? (msg.room_name || msg.room_id) : undefined,
    replyTarget: isGroupRoom ? msg.room_id! : (envelope.from || ""),
    roomId: msg.room_id,
    topic: msg.topic,
    topicId: msg.topic_id,
    mentioned: msg.mentioned,
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
  const sessionKey = buildSessionKey(roomId, topic, senderId);

  const route = core.channel.routing.resolveAgentRoute({
    cfg,
    channel: "agentline",
    accountId,
    peer: {
      kind: chatType,
      id: chatType === "group" ? (roomId || replyTarget) : senderId,
    },
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
    WasMentioned: params.chatType === "direct"
      ? true
      : (params.mentioned ?? true),
    CommandAuthorized: true,
    OriginatingChannel: "agentline" as const,
    OriginatingTo: to,
    ConversationLabel: chatType === "group" ? (groupSubject || senderName) : senderName,
  });

  await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg,
    dispatcherOptions: {
      // A2A replies are sent explicitly via agentline_send tool.
      // Suppress automatic delivery to avoid leaking agent narration.
      deliver: async () => {},
      onError: (err: any, info: any) => {
        console.error(`[agentline] ${info?.kind ?? "unknown"} reply error:`, err);
      },
    },
    replyOptions: {},
  });
}
