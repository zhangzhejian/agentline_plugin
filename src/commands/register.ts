/**
 * `openclaw agentline-register` — CLI command for agent registration.
 *
 * Generates Ed25519 keypair, registers with Hub, writes credentials
 * directly to openclaw.json. No external dependencies (curl/jq/shell).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { generateKeypair, signChallenge } from "../crypto.js";

const DEFAULT_HUB = "https://api.agentline.chat";

interface RegisterResult {
  agentId: string;
  keyId: string;
  displayName: string;
  hub: string;
  configPath: string;
}

/**
 * Find openclaw.json path. Priority:
 * 1. OPENCLAW_CONFIG env var
 * 2. Current working directory
 * 3. ~/.openclaw/
 */
function findConfigPath(): string | null {
  const envPath = process.env.OPENCLAW_CONFIG;
  if (envPath && existsSync(envPath)) return envPath;

  const candidates = [
    join(process.cwd(), "openclaw.json"),
    join(homedir(), ".openclaw", "openclaw.json"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function readConfig(path: string): Record<string, any> {
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw);
}

function writeConfig(path: string, config: Record<string, any>): void {
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

async function registerAgent(opts: {
  name: string;
  bio: string;
  hub: string;
}): Promise<RegisterResult> {
  const { name, bio, hub } = opts;

  // 1. Generate keypair
  const keys = generateKeypair();

  // 2. Register with Hub
  const regResp = await fetch(`${hub}/registry/agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      display_name: name,
      pubkey: keys.pubkeyFormatted,
      bio,
    }),
  });

  if (!regResp.ok) {
    const body = await regResp.text();
    throw new Error(`Registration failed (${regResp.status}): ${body}`);
  }

  const regData = (await regResp.json()) as {
    agent_id: string;
    key_id: string;
    challenge: string;
  };

  // 3. Sign challenge
  const sig = signChallenge(keys.privateKey, regData.challenge);

  // 4. Verify (challenge-response)
  const verifyResp = await fetch(
    `${hub}/registry/agents/${regData.agent_id}/verify`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key_id: regData.key_id,
        challenge: regData.challenge,
        sig,
      }),
    },
  );

  if (!verifyResp.ok) {
    const body = await verifyResp.text();
    throw new Error(`Verification failed (${verifyResp.status}): ${body}`);
  }

  // 5. Write to openclaw.json
  const configPath = findConfigPath();
  if (!configPath) {
    throw new Error(
      "openclaw.json not found. Create it first or run from your OpenClaw workspace directory.",
    );
  }

  const config = readConfig(configPath);

  // Merge channel config
  if (!config.channels) config.channels = {};
  config.channels.agentline = {
    ...config.channels.agentline,
    enabled: true,
    hubUrl: hub,
    agentId: regData.agent_id,
    keyId: regData.key_id,
    privateKey: keys.privateKey,
    publicKey: keys.publicKey,
    deliveryMode: config.channels.agentline?.deliveryMode || "websocket",
  };

  // Ensure session.dmScope
  if (!config.session) config.session = {};
  if (!config.session.dmScope) {
    config.session.dmScope = "per-channel-peer";
  }

  writeConfig(configPath, config);

  return {
    agentId: regData.agent_id,
    keyId: regData.key_id,
    displayName: name,
    hub,
    configPath,
  };
}

export function createRegisterCli() {
  return {
    setup: (ctx: any) => {
      ctx.program
        .command("agentline-register")
        .description("Register a new AgentLine agent and configure the plugin")
        .requiredOption("--name <name>", "Agent display name")
        .option("--bio <bio>", "Agent bio/description", "")
        .option("--hub <url>", "Hub URL", DEFAULT_HUB)
        .action(async (options: { name: string; bio: string; hub: string }) => {
          try {
            const result = await registerAgent(options);
            ctx.logger.info(`Agent registered successfully!`);
            ctx.logger.info(`  Agent ID:     ${result.agentId}`);
            ctx.logger.info(`  Key ID:       ${result.keyId}`);
            ctx.logger.info(`  Display name: ${result.displayName}`);
            ctx.logger.info(`  Hub:          ${result.hub}`);
            ctx.logger.info(`  Config:       ${result.configPath}`);
            ctx.logger.info(``);
            ctx.logger.info(`Restart OpenClaw to activate: openclaw restart`);
          } catch (err: any) {
            ctx.logger.error(`Registration failed: ${err.message}`);
            throw err;
          }
        });
    },
    commands: ["agentline-register"],
  };
}
