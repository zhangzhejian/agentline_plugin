import { afterEach, describe, expect, it, vi } from "vitest";
import { agentLinePlugin } from "../channel.js";
import { AgentLineClient } from "../client.js";

const cfg = {
  channels: {
    agentline: {
      hubUrl: "https://hub.test",
      agentId: "ag_sender",
      keyId: "k_test",
      privateKey: "dGVzdC1wcml2YXRlLWtleQ==",
    },
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("agentLinePlugin outbound", () => {
  it("maps hub_msg_id to messageId for text sends", async () => {
    const sendText = agentLinePlugin.outbound!.sendText!;
    vi.spyOn(AgentLineClient.prototype, "sendMessage").mockResolvedValue({
      queued: true,
      hub_msg_id: "hub_text_123",
      status: "queued",
    });

    const result = await sendText({
      cfg,
      to: "ag_target",
      text: "hello",
      accountId: "default",
    } as any);

    expect(result.messageId).toBe("hub_text_123");
  });

  it("maps hub_msg_id to messageId for media sends", async () => {
    const sendMedia = agentLinePlugin.outbound!.sendMedia!;
    vi.spyOn(AgentLineClient.prototype, "sendMessage").mockResolvedValue({
      queued: true,
      hub_msg_id: "hub_media_456",
      status: "queued",
    });

    const result = await sendMedia({
      cfg,
      to: "ag_target",
      text: "hello",
      mediaUrl: "https://files.test/image.png",
      accountId: "default",
    } as any);

    expect(result.messageId).toBe("hub_media_456");
  });
});
