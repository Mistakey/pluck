import { invoke } from "@tauri-apps/api/core";

export type Mode = "official" | "cpa";

export interface Status {
  mode: "official" | "cpa" | "other" | "error";
  modeLabel: string;
  error: string | null;
  otherBaseUrl: string | null;
  configDir: string;
  settingsPath: string;
  settingsExists: boolean;
  credentialsPresent: boolean;
  cpaConfigured: boolean;
  cpaBaseUrl: string | null;
  cpaKeyHint: string | null;
  connectionRevision: string;
  model: string | null;
  modelDisplayName: string | null;
  subagentModel: string | null;
  aliases: { opus: string | null; sonnet: string | null; haiku: string | null };
  pickerCount: number;
  processEnv: string[];
  dataPath: string;
}

export interface OpResult {
  message: string;
  status: Status;
}

export interface ModelConfig {
  defaultModel: string | null;
  subagentModel: string | null;
  autoModeModel: string | null;
  aliasOpus: string | null;
  aliasSonnet: string | null;
  aliasHaiku: string | null;
  pickerModels: string[];
  replaceBuiltIn: boolean;
}

export interface ModelInfo {
  id: string;
  displayName: string | null;
}

export interface ModelView {
  config: ModelConfig;
  source: "live" | "saved";
  revision: string;
  models: ModelInfo[];
  fetchedAt: number | null;
}

export const api = {
  status: () => invoke<Status>("get_status"),
  switchMode: (mode: Mode) => invoke<OpResult>("switch_mode", { mode }),
  saveCpa: (baseUrl: string, apiKey: string | null, revision: string) =>
    invoke<OpResult & { beforeModelRevision: string; modelView: ModelView }>(
      "save_cpa",
      { baseUrl, apiKey, revision },
    ),
  models: () => invoke<ModelView>("get_models"),
  refreshModels: () => invoke<ModelView>("refresh_models"),
  saveModelConfig: (config: ModelConfig, revision: string) =>
    invoke<OpResult>("save_model_config", { config, revision }),
};

export function errorText(e: unknown): string {
  return typeof e === "string"
    ? e
    : e instanceof Error
      ? e.message
      : JSON.stringify(e);
}
