/**
 * Plugin runtime store — holds a reference to OpenClaw's PluginRuntime.
 */
import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setAgentLineRuntime(rt: PluginRuntime): void {
  runtime = rt;
}

export function getAgentLineRuntime(): PluginRuntime {
  if (!runtime) throw new Error("AgentLine runtime not initialized");
  return runtime;
}
