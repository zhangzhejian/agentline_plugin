/**
 * Background inbox polling for AgentLine.
 * Used when webhook delivery is unavailable or as a fallback.
 */
import { AgentLineClient } from "./client.js";
import { dispatchInbound } from "./inbound.js";
import { displayPrefix } from "./config.js";
import type { InboxMessage } from "./types.js";

interface PollerOptions {
  client: AgentLineClient;
  accountId: string;
  cfg: any;
  intervalMs: number;
  abortSignal?: AbortSignal;
  log?: { info: (msg: string) => void; error: (msg: string) => void; warn: (msg: string) => void };
}

const activePollers = new Map<string, { stop: () => void }>();

export function startPoller(opts: PollerOptions): { stop: () => void } {
  const { client, accountId, cfg, intervalMs, abortSignal, log } = opts;
  const dp = displayPrefix(accountId, cfg);
  let running = true;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  async function poll() {
    if (!running || abortSignal?.aborted) return;

    try {
      const resp = await client.pollInbox({ limit: 20, ack: true });
      const messages = resp.messages || [];

      for (const msg of messages) {
        try {
          await handleInboxMessage(msg, accountId, cfg);
        } catch (err: any) {
          log?.error(`[${dp}] failed to dispatch message ${msg.id}: ${err.message}`);
        }
      }
    } catch (err: any) {
      if (!running) return;
      log?.error(`[${dp}] poll error: ${err.message}`);
    }

    if (running && !abortSignal?.aborted) {
      timeoutId = setTimeout(poll, intervalMs);
    }
  }

  function stop() {
    running = false;
    if (timeoutId) clearTimeout(timeoutId);
    activePollers.delete(accountId);
  }

  // Start first poll
  timeoutId = setTimeout(poll, 500);

  const entry = { stop };
  activePollers.set(accountId, entry);

  abortSignal?.addEventListener("abort", stop, { once: true });

  return entry;
}

export function stopPoller(accountId: string): void {
  const poller = activePollers.get(accountId);
  if (poller) poller.stop();
}

async function handleInboxMessage(
  msg: InboxMessage,
  accountId: string,
  cfg: any,
): Promise<void> {
  const envelope = msg.envelope;
  const senderId = envelope.from || "unknown";
  const content =
    msg.text ||
    (typeof envelope.payload === "string"
      ? envelope.payload
      : envelope.payload?.text ?? JSON.stringify(envelope.payload));
  const isRoom = !!msg.room_id;

  await dispatchInbound({
    cfg,
    accountId,
    senderName: senderId,
    senderId,
    content: content as string,
    messageId: envelope.msg_id,
    chatType: isRoom ? "group" : "direct",
    groupSubject: isRoom ? (msg.room_name || msg.room_id) : undefined,
    replyTarget: envelope.from || "",
    roomId: msg.room_id,
    topic: msg.topic,
  });
}
