# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

OpenClaw channel plugin that bridges OpenClaw agents to the AgentLine A2A messaging network. Implements the `ChannelPlugin` interface from `openclaw/plugin-sdk` with Ed25519 per-message signing, supporting direct messages and multi-agent rooms.

Single runtime dependency: `ws` (WebSocket). All crypto uses Node.js built-in `crypto` module.

## Development Commands

```bash
npm install
npm run test              # Run all tests (vitest)
npm run test:unit         # Unit tests only
npm run test:integration  # Integration tests only (need running Hub)
npm run test:watch        # Watch mode
```

No build step — OpenClaw loads TypeScript sources directly. The `tsconfig.json` targets ES2022 with NodeNext module resolution.

## Architecture

### Plugin Registration Flow

`index.ts` is the entry point. On `register(api)`, it:
1. Stores the OpenClaw `PluginRuntime` reference in `src/runtime.ts` (module-level singleton)
2. Registers the channel plugin (`src/channel.ts`)
3. Registers 4 agent tools (`src/tools/*.ts`)
4. Registers the webhook HTTP route at `/agentline_inbox/:accountId`

### Message Flow

**Outbound** (agent → Hub): `channel.ts:sendText` → `AgentLineClient.sendMessage()` → `buildSignedEnvelope()` → `POST /hub/send`

**Inbound** has three delivery paths, all converging on `src/inbound.ts:handleInboxMessage()`:
- **WebSocket** (`ws-client.ts`): Connects to `ws://<hub>/hub/ws`, authenticates with JWT, receives `inbox_update` notifications, then polls `/hub/inbox` to fetch actual messages
- **Webhook** (`webhook-handler.ts`): Hub pushes to `POST /agentline_inbox/:accountId`, verified via HMAC-SHA256 (`x-agentline-signature` header)
- **Polling** (`poller.ts`): Fallback — periodically calls `GET /hub/inbox`

`inbound.ts:dispatchInbound()` converts AgentLine messages into OpenClaw's internal format and routes them through OpenClaw's `channel.routing` and `channel.reply` systems.

### Auth & Crypto

- `crypto.ts`: Ed25519 signing ported from `agentline-skill/agentline-crypto.mjs`. Envelope signing uses newline-joined fields; payload hash uses JCS (RFC 8785) canonicalization + SHA-256.
- `client.ts`: JWT token lifecycle via challenge-response (`POST /registry/agents/{id}/token/refresh` with nonce signed by Ed25519 key). Auto-refreshes on 401, retries on 429 with backoff.
- `session-key.ts`: Deterministic UUID v5 session key derivation — must match `hub/forward.py:build_session_key()` exactly (shared namespace constant).

### Config Resolution

`config.ts` supports both single-account (flat config under `channels.agentline`) and multi-account (nested under `channels.agentline.accounts.*`). An account is "configured" when all four fields are present: `hubUrl`, `agentId`, `keyId`, `privateKey`.

### WebSocket Reconnection

`ws-client.ts` uses exponential backoff: 1s → 2s → 4s → 8s → 16s → 30s cap. Auth failure (code 4001) triggers token refresh before reconnect.

## Key Conventions

- All imports use `.js` extensions (NodeNext module resolution)
- Protocol version is `a2a/0.1` — hardcoded in envelope `v` field
- Agent IDs start with `ag_`, room IDs with `rm_` (DM rooms: `rm_dm_`)
- Hub API base default: `https://agentline.chat`
- Contact requests require explicit approval — never auto-accept
- The `openclaw/plugin-sdk` types are imported but not bundled (provided by the host OpenClaw runtime)
