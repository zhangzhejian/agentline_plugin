/**
 * HTTP client for AgentLine Hub REST API.
 * Handles JWT token lifecycle and request signing.
 */
import { randomUUID } from "node:crypto";
import { buildSignedEnvelope, signChallenge } from "./crypto.js";
import type {
  AgentLineAccountConfig,
  AgentLineMessageEnvelope,
  InboxPollResponse,
  SendResponse,
  RoomInfo,
  AgentInfo,
  ContactInfo,
  ContactRequestInfo,
} from "./types.js";

const MAX_RETRIES = 2;
const RETRY_BASE_MS = 1000;

export class AgentLineClient {
  private hubUrl: string;
  private agentId: string;
  private keyId: string;
  private privateKey: string;
  private jwtToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(config: AgentLineAccountConfig) {
    if (!config.hubUrl || !config.agentId || !config.keyId || !config.privateKey) {
      throw new Error("AgentLine client requires hubUrl, agentId, keyId, and privateKey");
    }
    this.hubUrl = config.hubUrl.replace(/\/$/, "");
    this.agentId = config.agentId;
    this.keyId = config.keyId;
    this.privateKey = config.privateKey;
  }

  // ── Token management ──────────────────────────────────────────

  async ensureToken(): Promise<string> {
    if (this.jwtToken && Date.now() / 1000 < this.tokenExpiresAt - 60) {
      return this.jwtToken;
    }
    return this.refreshToken();
  }

  private async refreshToken(): Promise<string> {
    // POST /registry/agents/{id}/token/refresh with nonce signature
    const nonce = randomUUID();
    const sig = signChallenge(this.privateKey, Buffer.from(nonce).toString("base64"));

    const resp = await fetch(`${this.hubUrl}/registry/agents/${this.agentId}/token/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key_id: this.keyId,
        nonce,
        signature: sig,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Token refresh failed: ${resp.status} ${body}`);
    }

    const data = (await resp.json()) as { token: string; expires_at?: number };
    this.jwtToken = data.token;
    // Default 24h expiry if not provided
    this.tokenExpiresAt = data.expires_at ?? Date.now() / 1000 + 86400;
    return this.jwtToken;
  }

  // ── Authenticated fetch with rate-limit retry ─────────────────

  private async hubFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.ensureToken();

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        ...((init.headers as Record<string, string>) ?? {}),
      };
      if (init.body) {
        headers["Content-Type"] = "application/json";
      }

      const resp = await fetch(`${this.hubUrl}${path}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(30000),
      });

      if (resp.ok) return resp;

      // Token expired — refresh and retry
      if (resp.status === 401 && attempt === 0) {
        await this.refreshToken();
        continue;
      }

      // Rate limited — retry with backoff
      if (resp.status === 429 && attempt < MAX_RETRIES) {
        const retryAfter = parseInt(resp.headers.get("Retry-After") || "", 10);
        const delayMs = retryAfter > 0 ? retryAfter * 1000 : RETRY_BASE_MS * (attempt + 1);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }

      const body = await resp.text().catch(() => "");
      const err = new Error(`AgentLine ${path} failed: ${resp.status} ${body}`);
      (err as any).status = resp.status;
      throw err;
    }
    throw new Error(`AgentLine ${path} failed: exhausted retries`);
  }

  // ── Messaging ─────────────────────────────────────────────────

  async sendMessage(
    to: string,
    text: string,
    options?: { replyTo?: string; topic?: string; ttlSec?: number },
  ): Promise<SendResponse> {
    const envelope = buildSignedEnvelope({
      from: this.agentId,
      to,
      type: "message",
      payload: { text },
      privateKey: this.privateKey,
      keyId: this.keyId,
      replyTo: options?.replyTo,
      ttlSec: options?.ttlSec,
    });

    const topicQuery = options?.topic ? `?topic=${encodeURIComponent(options.topic)}` : "";
    const resp = await this.hubFetch(`/hub/send${topicQuery}`, {
      method: "POST",
      body: JSON.stringify(envelope),
    });
    return (await resp.json()) as SendResponse;
  }

  async sendEnvelope(envelope: AgentLineMessageEnvelope, topic?: string): Promise<SendResponse> {
    const topicQuery = topic ? `?topic=${encodeURIComponent(topic)}` : "";
    const resp = await this.hubFetch(`/hub/send${topicQuery}`, {
      method: "POST",
      body: JSON.stringify(envelope),
    });
    return (await resp.json()) as SendResponse;
  }

  // ── Inbox ─────────────────────────────────────────────────────

  async pollInbox(options?: {
    limit?: number;
    ack?: boolean;
    timeout?: number;
    roomId?: string;
  }): Promise<InboxPollResponse> {
    const params = new URLSearchParams();
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.ack) params.set("ack", "true");
    if (options?.timeout) params.set("timeout", String(options.timeout));
    if (options?.roomId) params.set("room_id", options.roomId);

    const resp = await this.hubFetch(`/hub/inbox?${params.toString()}`);
    return (await resp.json()) as InboxPollResponse;
  }

  async getHistory(options?: {
    peer?: string;
    roomId?: string;
    topic?: string;
    before?: string;
    after?: string;
    limit?: number;
  }): Promise<any> {
    const params = new URLSearchParams();
    if (options?.peer) params.set("peer", options.peer);
    if (options?.roomId) params.set("room_id", options.roomId);
    if (options?.topic) params.set("topic", options.topic);
    if (options?.before) params.set("before", options.before);
    if (options?.after) params.set("after", options.after);
    if (options?.limit) params.set("limit", String(options.limit));

    const resp = await this.hubFetch(`/hub/history?${params.toString()}`);
    return await resp.json();
  }

  // ── Registry ──────────────────────────────────────────────────

  async resolve(agentId: string): Promise<AgentInfo> {
    const resp = await this.hubFetch(`/registry/resolve/${agentId}`);
    return (await resp.json()) as AgentInfo;
  }

  async registerEndpoint(url: string, webhookToken?: string): Promise<any> {
    const body: Record<string, string> = { url };
    if (webhookToken) body.webhook_token = webhookToken;
    const resp = await this.hubFetch(`/registry/agents/${this.agentId}/endpoints`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return await resp.json();
  }

  // ── Contacts ──────────────────────────────────────────────────

  async listContacts(): Promise<ContactInfo[]> {
    const resp = await this.hubFetch(`/registry/agents/${this.agentId}/contacts`);
    return (await resp.json()) as ContactInfo[];
  }

  async removeContact(contactAgentId: string): Promise<void> {
    await this.hubFetch(`/registry/agents/${this.agentId}/contacts/${contactAgentId}`, {
      method: "DELETE",
    });
  }

  async blockAgent(blockedId: string): Promise<void> {
    await this.hubFetch(`/registry/agents/${this.agentId}/blocks`, {
      method: "POST",
      body: JSON.stringify({ blocked_agent_id: blockedId }),
    });
  }

  async unblockAgent(blockedId: string): Promise<void> {
    await this.hubFetch(`/registry/agents/${this.agentId}/blocks/${blockedId}`, {
      method: "DELETE",
    });
  }

  async listBlocks(): Promise<any[]> {
    const resp = await this.hubFetch(`/registry/agents/${this.agentId}/blocks`);
    return await resp.json();
  }

  // ── Contact requests ──────────────────────────────────────────

  async listReceivedRequests(state?: string): Promise<ContactRequestInfo[]> {
    const q = state ? `?state=${state}` : "";
    const resp = await this.hubFetch(`/registry/agents/${this.agentId}/contact-requests/received${q}`);
    return (await resp.json()) as ContactRequestInfo[];
  }

  async listSentRequests(state?: string): Promise<ContactRequestInfo[]> {
    const q = state ? `?state=${state}` : "";
    const resp = await this.hubFetch(`/registry/agents/${this.agentId}/contact-requests/sent${q}`);
    return (await resp.json()) as ContactRequestInfo[];
  }

  async acceptRequest(requestId: string): Promise<void> {
    await this.hubFetch(`/registry/agents/${this.agentId}/contact-requests/${requestId}/accept`, {
      method: "POST",
    });
  }

  async rejectRequest(requestId: string): Promise<void> {
    await this.hubFetch(`/registry/agents/${this.agentId}/contact-requests/${requestId}/reject`, {
      method: "POST",
    });
  }

  // ── Rooms ─────────────────────────────────────────────────────

  async createRoom(params: {
    name: string;
    description?: string;
    visibility?: "private" | "public";
    join_policy?: "invite_only" | "open";
    default_send?: boolean;
    max_members?: number;
    member_ids?: string[];
  }): Promise<RoomInfo> {
    const resp = await this.hubFetch("/hub/rooms", {
      method: "POST",
      body: JSON.stringify(params),
    });
    return (await resp.json()) as RoomInfo;
  }

  async listMyRooms(): Promise<RoomInfo[]> {
    const resp = await this.hubFetch("/hub/rooms/me");
    return (await resp.json()) as RoomInfo[];
  }

  async getRoomInfo(roomId: string): Promise<RoomInfo> {
    const resp = await this.hubFetch(`/hub/rooms/${roomId}`);
    return (await resp.json()) as RoomInfo;
  }

  async joinRoom(roomId: string): Promise<void> {
    await this.hubFetch(`/hub/rooms/${roomId}/members`, {
      method: "POST",
      body: JSON.stringify({ agent_id: this.agentId }),
    });
  }

  async leaveRoom(roomId: string): Promise<void> {
    await this.hubFetch(`/hub/rooms/${roomId}/leave`, { method: "POST" });
  }

  async getRoomMembers(roomId: string): Promise<any[]> {
    const resp = await this.hubFetch(`/hub/rooms/${roomId}`);
    const data = await resp.json();
    return (data as any).members ?? [];
  }

  async inviteToRoom(roomId: string, agentId: string): Promise<void> {
    await this.hubFetch(`/hub/rooms/${roomId}/members`, {
      method: "POST",
      body: JSON.stringify({ agent_id: agentId }),
    });
  }

  async discoverRooms(name?: string): Promise<RoomInfo[]> {
    const q = name ? `?name=${encodeURIComponent(name)}` : "";
    const resp = await this.hubFetch(`/hub/rooms${q}`);
    return (await resp.json()) as RoomInfo[];
  }

  // ── Accessors ─────────────────────────────────────────────────

  getAgentId(): string {
    return this.agentId;
  }

  getHubUrl(): string {
    return this.hubUrl;
  }
}
