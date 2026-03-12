// AgentLine protocol types (mirrors hub/schemas.py)

export type AgentLineSignature = {
  alg: "ed25519";
  key_id: string;
  value: string; // base64
};

export type MessageType =
  | "message"
  | "ack"
  | "result"
  | "error"
  | "contact_request"
  | "contact_request_response"
  | "contact_removed"
  | "system";

export type AgentLineMessageEnvelope = {
  v: string;
  msg_id: string;
  ts: number;
  from: string;
  to: string;
  type: MessageType;
  reply_to: string | null;
  ttl_sec: number;
  topic?: string | null;
  goal?: string | null;
  payload: Record<string, unknown>;
  payload_hash: string;
  sig: AgentLineSignature;
};

// Account config in openclaw.json channels.agentline
export type AgentLineAccountConfig = {
  enabled?: boolean;
  hubUrl?: string;
  agentId?: string;
  keyId?: string;
  privateKey?: string;
  publicKey?: string;
  deliveryMode?: "webhook" | "polling" | "websocket";
  pollIntervalMs?: number;
  webhookToken?: string;
  allowFrom?: string[];
  accounts?: Record<string, AgentLineAccountConfig>;
};

export type AgentLineChannelConfig = AgentLineAccountConfig;

// Inbox poll response
export type InboxMessage = {
  hub_msg_id: string;
  envelope: AgentLineMessageEnvelope;
  text?: string;
  room_id?: string;
  room_name?: string;
  room_member_count?: number;
  room_member_names?: string[];
  topic?: string;
  goal?: string;
};

export type InboxPollResponse = {
  messages: InboxMessage[];
  count: number;
  has_more: boolean;
};

// Hub API response types
export type SendResponse = {
  queued: boolean;
  hub_msg_id: string;
  status: string;
};

export type RoomInfo = {
  room_id: string;
  name: string;
  description?: string;
  visibility: "private" | "public";
  join_policy: "invite_only" | "open";
  default_send: boolean;
  member_count: number;
  created_at: string;
};

export type AgentInfo = {
  agent_id: string;
  display_name?: string;
  bio?: string;
  message_policy: string;
  endpoints: Array<{ url: string; state: string }>;
};

export type ContactInfo = {
  contact_agent_id: string;
  display_name?: string;
  created_at: string;
};

export type ContactRequestInfo = {
  request_id: string;
  from_agent_id: string;
  to_agent_id: string;
  state: "pending" | "accepted" | "rejected";
  created_at: string;
};

// File upload response (mirrors hub/schemas.py FileUploadResponse)
export type FileUploadResponse = {
  file_id: string;
  url: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  expires_at: string; // ISO 8601
};

// Attachment metadata included in message payloads
export type MessageAttachment = {
  filename: string;
  url: string;
  content_type?: string;
  size_bytes?: number;
};
