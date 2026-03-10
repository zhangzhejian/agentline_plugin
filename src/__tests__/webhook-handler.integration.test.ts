/**
 * Integration tests for the webhook handler HTTP layer.
 * Tests routing, body parsing, HMAC signature verification.
 * Mocks dispatchInbound to isolate from OpenClaw runtime.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";

// Mock dispatchInbound before importing webhook-handler
vi.mock("../inbound.js", () => ({
  dispatchInbound: vi.fn().mockResolvedValue(undefined),
}));

import { createWebhookHandler } from "../webhook-handler.js";
import { dispatchInbound } from "../inbound.js";

const mockedDispatch = vi.mocked(dispatchInbound);

// ── Test HTTP server helper ─────────────────────────────────────

function startTestServer(getConfig: () => any): Promise<{ url: string; server: Server }> {
  const handler = createWebhookHandler(getConfig);
  const server = createServer(async (req, res) => {
    const handled = await handler(req, res);
    if (!handled) {
      res.writeHead(404);
      res.end("not found");
    }
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, server });
    });
  });
}

function stopServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

// ── Config ──────────────────────────────────────────────────────

const baseConfig = {
  channels: {
    agentline: {
      hubUrl: "https://hub.test",
      agentId: "ag_bot",
      keyId: "k_1",
      privateKey: "dGVzdC1rZXk=",
    },
  },
};

const configWithToken = {
  channels: {
    agentline: {
      ...baseConfig.channels.agentline,
      webhookToken: "my-webhook-secret",
    },
  },
};

// ── Tests ────────────────────────────────────────────────────────

describe("webhook handler", () => {
  let url: string;
  let server: Server;

  beforeEach(() => {
    mockedDispatch.mockClear();
  });

  describe("routing", () => {
    it("returns false for non-matching paths", async () => {
      ({ url, server } = await startTestServer(() => baseConfig));
      try {
        const resp = await fetch(`${url}/other-path`);
        expect(resp.status).toBe(404);
      } finally {
        await stopServer(server);
      }
    });

    it("returns 405 for GET requests", async () => {
      ({ url, server } = await startTestServer(() => baseConfig));
      try {
        const resp = await fetch(`${url}/agentline_inbox/default`);
        expect(resp.status).toBe(405);
      } finally {
        await stopServer(server);
      }
    });
  });

  describe("message dispatch", () => {
    it("dispatches a direct message", async () => {
      ({ url, server } = await startTestServer(() => baseConfig));
      try {
        const body = {
          from: "ag_sender123456",
          sender_name: "Sender Bot",
          text: "Hello from webhook!",
          message_id: "msg-001",
        };

        const resp = await fetch(`${url}/agentline_inbox/default`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        expect(resp.status).toBe(200);
        const data = await resp.json();
        expect(data.ok).toBe(true);

        expect(mockedDispatch).toHaveBeenCalledOnce();
        const args = mockedDispatch.mock.calls[0][0];
        expect(args.senderId).toBe("ag_sender123456");
        expect(args.senderName).toBe("Sender Bot");
        expect(args.content).toBe("Hello from webhook!");
        expect(args.chatType).toBe("direct");
        expect(args.accountId).toBe("default");
      } finally {
        await stopServer(server);
      }
    });

    it("dispatches a room (group) message", async () => {
      ({ url, server } = await startTestServer(() => baseConfig));
      try {
        const body = {
          from: "ag_sender123456",
          text: "Group message",
          room_id: "rm_grouproom01",
          room_name: "Engineering",
        };

        const resp = await fetch(`${url}/agentline_inbox/default`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        expect(resp.status).toBe(200);
        const args = mockedDispatch.mock.calls[0][0];
        expect(args.chatType).toBe("group");
        expect(args.roomId).toBe("rm_grouproom01");
        expect(args.groupSubject).toBe("Engineering");
      } finally {
        await stopServer(server);
      }
    });

    it("routes to correct account via URL path", async () => {
      ({ url, server } = await startTestServer(() => baseConfig));
      try {
        const body = { from: "ag_x", text: "hi" };
        await fetch(`${url}/agentline_inbox/prod-account`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        expect(mockedDispatch).toHaveBeenCalledOnce();
        expect(mockedDispatch.mock.calls[0][0].accountId).toBe("prod-account");
      } finally {
        await stopServer(server);
      }
    });
  });

  describe("signature verification", () => {
    it("accepts valid HMAC signature", async () => {
      ({ url, server } = await startTestServer(() => configWithToken));
      try {
        const bodyStr = JSON.stringify({ from: "ag_x", text: "signed msg" });
        const sig = createHmac("sha256", "my-webhook-secret")
          .update(bodyStr)
          .digest("hex");

        const resp = await fetch(`${url}/agentline_inbox/default`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-agentline-signature": sig,
          },
          body: bodyStr,
        });

        expect(resp.status).toBe(200);
        expect(mockedDispatch).toHaveBeenCalledOnce();
      } finally {
        await stopServer(server);
      }
    });

    it("accepts sha256= prefixed signature", async () => {
      ({ url, server } = await startTestServer(() => configWithToken));
      try {
        const bodyStr = JSON.stringify({ from: "ag_x", text: "prefixed sig" });
        const hex = createHmac("sha256", "my-webhook-secret")
          .update(bodyStr)
          .digest("hex");

        const resp = await fetch(`${url}/agentline_inbox/default`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-agentline-signature": `sha256=${hex}`,
          },
          body: bodyStr,
        });

        expect(resp.status).toBe(200);
      } finally {
        await stopServer(server);
      }
    });

    it("rejects missing signature when token is configured", async () => {
      ({ url, server } = await startTestServer(() => configWithToken));
      try {
        const resp = await fetch(`${url}/agentline_inbox/default`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from: "ag_x", text: "no sig" }),
        });

        expect(resp.status).toBe(401);
        const data = await resp.json();
        expect(data.error).toBe("Invalid signature");
        expect(mockedDispatch).not.toHaveBeenCalled();
      } finally {
        await stopServer(server);
      }
    });

    it("rejects invalid signature", async () => {
      ({ url, server } = await startTestServer(() => configWithToken));
      try {
        const resp = await fetch(`${url}/agentline_inbox/default`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-agentline-signature": "bad-signature",
          },
          body: JSON.stringify({ from: "ag_x", text: "bad sig" }),
        });

        expect(resp.status).toBe(401);
        expect(mockedDispatch).not.toHaveBeenCalled();
      } finally {
        await stopServer(server);
      }
    });

    it("skips verification when no webhookToken configured", async () => {
      ({ url, server } = await startTestServer(() => baseConfig));
      try {
        const resp = await fetch(`${url}/agentline_inbox/default`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from: "ag_x", text: "no token needed" }),
        });

        expect(resp.status).toBe(200);
        expect(mockedDispatch).toHaveBeenCalledOnce();
      } finally {
        await stopServer(server);
      }
    });
  });

  describe("error handling", () => {
    it("returns 500 on malformed JSON", async () => {
      ({ url, server } = await startTestServer(() => baseConfig));
      try {
        const resp = await fetch(`${url}/agentline_inbox/default`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "not json{{{",
        });

        expect(resp.status).toBe(500);
      } finally {
        await stopServer(server);
      }
    });

    it("returns 500 when dispatch throws", async () => {
      mockedDispatch.mockRejectedValueOnce(new Error("dispatch boom"));
      ({ url, server } = await startTestServer(() => baseConfig));
      try {
        const resp = await fetch(`${url}/agentline_inbox/default`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from: "ag_x", text: "crash" }),
        });

        expect(resp.status).toBe(500);
      } finally {
        await stopServer(server);
      }
    });
  });
});
