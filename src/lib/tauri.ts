import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen, EventCallback, UnlistenFn } from '@tauri-apps/api/event';

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

function toCamelCase(str: string): string {
  return str.replace(/_([a-z0-9])/g, (_, char) => char.toUpperCase());
}

function toSnakeCase(str: string): string {
  return str.replace(/([A-Z])/g, '_$1').toLowerCase();
}

function normalizeArgs(args?: any): any {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return args;
  }
  const result: Record<string, any> = { ...args };
  for (const [key, value] of Object.entries(args)) {
    const camel = toCamelCase(key);
    if (!(camel in result)) {
      result[camel] = value;
    }
    const snake = toSnakeCase(key);
    if (!(snake in result)) {
      result[snake] = value;
    }
  }
  return result;
}

async function safeInvoke<T>(cmd: string, args?: any): Promise<T> {
  const normArgs = normalizeArgs(args);
  if (!isTauri) {
    console.warn(`[Vant Web Preview] Mocking IPC invoke for: ${cmd}`);
    if (cmd === 'get_api_proxy_status') {
      return { running: false, port: 0, endpoint: '' } as unknown as T;
    }
    if (cmd === 'get_ollama_status') {
      return { installed: true, running: false, models: [] } as unknown as T;
    }
    if (cmd === 'get_host_sys_stats') {
      return {
        cpu_percent: 8.5,
        memory_used_mb: 4096,
        memory_total_mb: 16384,
        memory_percent: 25.0,
        gpu_percent: null,
        gpu_vram_used_mb: null,
        gpu_vram_total_mb: null,
        gpu_name: null,
        gpu_temp_c: null,
      } as unknown as T;
    }
    if (cmd === 'get_pairing_code' || cmd === 'get_active_pairing_link') {
      return null as unknown as T;
    }
    if (cmd === 'get_pairing_state') {
      return 'Idle' as unknown as T;
    }
    if (cmd === 'get_active_sessions') {
      return [] as unknown as T;
    }
    if (cmd === 'get_connection_status') {
      return { Disconnected: null } as unknown as T;
    }
    if (cmd === 'is_hosting') {
      return false as unknown as T;
    }
    if (cmd === 'get_discovered_peers' || cmd === 'get_paired_devices') {
      return [] as unknown as T;
    }
    if (cmd === 'vant_list_integrations') {
      return [] as unknown as T;
    }
    if (cmd === 'vant_list_model_aliases') {
      return {} as unknown as T;
    }
    if (cmd === 'get_local_ip') {
      return '127.0.0.1' as unknown as T;
    }
    if (cmd === 'get_active_tunnel_url') {
      return null as unknown as T;
    }
    if (cmd === 'get_settings') {
      return {
        cloudflare_token: null,
        cloudflare_tunnel_url: null,
        gemini_api_key: null,
        groq_api_key: null,
        host_port: 8384,
        auto_start_hosting: false,
        default_model: null,
        max_concurrent_requests: 4,
        max_payload_bytes: 52428800,
        max_context_tokens: 8192,
        compression_enabled: true,
        strip_credentials: true,
        api_proxy_enabled: false,
        api_proxy_port: 11434,
        api_proxy_key: null,
      } as unknown as T;
    }
    return undefined as unknown as T;
  }
  return tauriInvoke<T>(cmd, normArgs);
}

export async function safeListen<T>(event: string, handler: EventCallback<T>): Promise<UnlistenFn> {
  if (!isTauri) {
    return () => {};
  }
  return tauriListen<T>(event, handler);
}

// Types matching Rust backend structs

export interface DiscoveredPeer {
  peer_id: string;
  device_name: string;
  addresses: string[];
  port: number;
}

export type UserRole = 'admin' | 'developer' | 'viewer';

export interface TrustedPeer {
  peer_id: string;
  device_name: string;
  nickname?: string | null;
  noise_public_key: string;
  paired_at: string;
  last_seen: string | null;
  revoked: boolean;
  role: UserRole;
  api_token?: string | null;
  rate_limit_rpm: number;
}

export type ConnectionStatus =
  | { Disconnected: null }
  | { Connecting: null }
  | { Connected: { mode: string; latency_ms: number; host_name: string } }
  | { Reconnecting: { attempt: number } };

export interface AppSettings {
  cloudflare_token: string | null;
  cloudflare_tunnel_url: string | null;
  gemini_api_key: string | null;
  groq_api_key: string | null;
  host_port: number;
  auto_start_hosting: boolean;
  default_model: string | null;
  max_concurrent_requests: number;
  max_payload_bytes: number;
  max_context_tokens: number;
  compression_enabled: boolean;
  strip_credentials: boolean;
  api_proxy_enabled: boolean;
  api_proxy_port: number;
  api_proxy_key: string | null;
}

export type OllamaStatus = 'NotInstalled' | 'Stopped' | 'Running';

export interface ModelInfo {
  name: string;
  size: number;
  modified_at: string;
}

export interface SessionInfo {
  peer_id: string;
  device_name: string;
  nickname?: string | null;
  connected_at: string;
  active: boolean;
}

export type PairingState =
  | 'Idle'
  | 'Discovering'
  | { AwaitingConfirmation: { sas: string; peer_id: string; device_name: string } }
  | { Completed: { peer_id: string } }
  | { Failed: { reason: string } };

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatChunk {
  message: ChatMessage | null;
  done: boolean;
}

export interface PullProgress {
  status: string;
  total: number | null;
  completed: number | null;
}

export interface IdentityInfo {
  peer_id: string;
  device_name: string;
}

export interface SystemStats {
  cpu_usage_percent: number;
  cpu_brand?: string;
  cpu_cores?: number;
  total_memory_mb: number;
  used_memory_mb: number;
  total_swap_mb: number;
  used_swap_mb: number;
  uptime_seconds: number;
  os_name: string;
  host_name: string;
  gpu_name?: string | null;
  gpu_vram_total_mb?: number | null;
  gpu_vram_used_mb?: number | null;
  gpu_temp_celsius?: number | null;
  gpu_utilization_percent?: number | null;
  accelerators?: string[];
  is_remote?: boolean | null;
}

// Docker & Hardware
export interface DockerStatus {
  installed: boolean;
  running: boolean;
  version: string | null;
  compose_available: boolean;
}

export interface GpuInfo {
  vendor: string;
  name: string;
  vram_mb: number;
  driver_version?: string | null;
  cuda_version?: string | null;
  nvidia_docker: boolean;
}

// Service Recipes (16 tools)
export type ToolCategory =
  | 'llm_engine'
  | 'ai_chat'
  | 'media_generation'
  | 'workflow_automation'
  | 'coding_assistant';

export type DeploymentMethod = 'docker_compose' | 'native_binary' | 'docker_run';

export interface ExposedPort {
  container_port: number;
  host_port: number;
  protocol: string;
  description: string;
}

export interface ServiceRecipe {
  id: string;
  name: string;
  description: string;
  version: string;
  category: ToolCategory;
  deployment: DeploymentMethod;
  docker_image?: string | null;
  ports: ExposedPort[];
  gpu: {
    required: boolean;
    recommended_vram_mb: number;
    nvidia_runtime: boolean;
    rocm_support: boolean;
  };
  depends_on: string[];
  web_ui: boolean;
  web_ui_path?: string | null;
  documentation_url: string;
}

export type ServiceStatus =
  | 'not_installed'
  | 'installed'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'error'
  | 'updating';

export interface ServiceState {
  recipe_id: string;
  status: ServiceStatus;
  container_id?: string | null;
  tunnel_url?: string | null;
  last_health_check?: string | null;
  error_message?: string | null;
  installed_at?: string | null;
  started_at?: string | null;
}

// Discovery
export const getDiscoveredPeers = () => safeInvoke<DiscoveredPeer[]>('get_discovered_peers');
export const startDiscovery = () => safeInvoke<void>('start_discovery');
export const stopDiscovery = () => safeInvoke<void>('stop_discovery');

// Pairing
export const initiatePairing = (peer_id: string) => safeInvoke<void>('initiate_pairing', { peer_id });
export const confirmPairing = (confirmed: boolean) => safeInvoke<void>('confirm_pairing', { confirmed });
export const generatePairingCode = () => safeInvoke<string>('generate_pairing_code');
export const submitPairingCode = (code: string) => safeInvoke<boolean>('submit_pairing_code', { code });
export const generatePairingLink = () => safeInvoke<string>('generate_pairing_link');
export const connectToUrl = (url: string) => safeInvoke<void>('connect_to_url', { url });
export const getPairingState = () => safeInvoke<PairingState>('get_pairing_state');

// Devices & RBAC
export const getPairedDevices = () => safeInvoke<TrustedPeer[]>('get_paired_devices');
export const revokeDevice = (peer_id: string) => safeInvoke<void>('revoke_device', { peer_id });
export const removeDevice = (peer_id: string) => safeInvoke<void>('remove_device', { peer_id });
export const renameDevice = (peer_id: string, nickname: string | null) =>
  safeInvoke<void>('rename_device', { peer_id, nickname });
export const updatePeerRole = (peer_id: string, role: string, rate_limit_rpm: number) =>
  safeInvoke<void>('update_peer_role', { peer_id, role, rate_limit_rpm });
export const generatePeerApiToken = (peer_id: string) =>
  safeInvoke<string>('generate_peer_api_token', { peer_id });

// Connection
export const connectToHost = (peer_id: string) => safeInvoke<void>('connect_to_host', { peer_id });
export const disconnectFromHost = () => safeInvoke<void>('disconnect_from_host');
export const sendChatMessage = (
  message: string,
  model?: string,
  options?: {
    messages?: ChatMessage[];
    system_prompt?: string;
    temperature?: number;
  }
) =>
  safeInvoke<void>('send_chat_message', {
    message,
    model,
    messages: options?.messages,
    system_prompt: options?.system_prompt,
    temperature: options?.temperature,
  });
export const getConnectionStatus = () => safeInvoke<ConnectionStatus>('get_connection_status');
export const getAvailableModels = () => safeInvoke<ModelInfo[]>('get_available_models');
export const getRemoteModels = () => safeInvoke<string[]>('get_remote_models');

// Hosting
export const startHosting = () => safeInvoke<void>('start_hosting');
export const isHosting = () => safeInvoke<boolean>('is_hosting');
export const stopHosting = () => safeInvoke<void>('stop_hosting');
export const getActiveSessions = () => safeInvoke<SessionInfo[]>('get_active_sessions');
export const killSession = (peer_id: string) => safeInvoke<void>('kill_session', { peer_id });
export const killAllSessions = () => safeInvoke<void>('kill_all_sessions');
export const getActiveTunnelUrl = () => safeInvoke<string | null>('get_active_tunnel_url');
export const startQuickTunnel = () => safeInvoke<string>('start_quick_tunnel');
export const stopQuickTunnel = () => safeInvoke<void>('stop_quick_tunnel');

// Ollama
export const getOllamaStatus = () => safeInvoke<OllamaStatus>('get_ollama_status');
export const startOllama = () => safeInvoke<void>('start_ollama');
export const pullModel = (name: string) => safeInvoke<void>('pull_model', { name });
export const swapModel = (name: string) => safeInvoke<void>('swap_model', { name });

// Identity
export const getIdentityInfo = () => safeInvoke<IdentityInfo>('get_identity_info');

// Settings
export const getSettings = () => safeInvoke<AppSettings>('get_settings');
export const saveSettings = (settings: AppSettings) => safeInvoke<void>('save_settings', { settings });

// API Proxy & Telemetry
export interface ApiProxyStatus {
  running: boolean;
  port: number;
  endpoint: string;
}

export const startApiProxy = () => safeInvoke<void>('start_api_proxy');
export const stopApiProxy = () => safeInvoke<void>('stop_api_proxy');
export const getApiProxyStatus = () => safeInvoke<ApiProxyStatus>('get_api_proxy_status');
export const ensureServiceTunnelPort = (port: number) =>
  safeInvoke<number>('ensure_service_tunnel_port', { port });
export const getHostSysStats = () => safeInvoke<SystemStats>('get_host_sys_stats');
export const getLocalIp = () => safeInvoke<string>('get_local_ip');

// Docker & GPU
export const getDockerStatus = () => safeInvoke<DockerStatus>('get_docker_status');
export const detectGpuHardware = () => safeInvoke<GpuInfo>('detect_gpu_hardware');

// Orchestrator Catalog (16 tools)
export const listRecipes = () => safeInvoke<ServiceRecipe[]>('list_recipes');
export const getServiceStates = () => safeInvoke<ServiceState[]>('get_service_states');
export const installAndRunService = (recipe_id: string) =>
  safeInvoke<void>('install_and_run_service', { recipeId: recipe_id, recipe_id });
export const stopService = (recipe_id: string) =>
  safeInvoke<void>('stop_service', { recipeId: recipe_id, recipe_id });
export const refreshServiceStatus = (recipe_id: string) =>
  safeInvoke<ServiceState>('refresh_service_status', { recipeId: recipe_id, recipe_id });
export const getServiceLogs = (recipe_id: string, tail: number = 100) =>
  safeInvoke<string>('get_service_logs', { recipeId: recipe_id, recipe_id, tail });
export const checkServiceHealth = (endpoint: string, timeout_secs: number = 3) =>
  safeInvoke<boolean>('check_service_health', { endpoint, timeoutSecs: timeout_secs, timeout_secs });

// Window Accent & Theme
export const setWindowAccent = (accentHex: string) =>
  safeInvoke<void>('set_window_accent', { accentHex, accent_hex: accentHex });

// Vant Integrations & Aliases
export interface IntegrationMetadata {
  id: string;
  name: string;
  description: string;
  is_installed: boolean;
}

export const vantListIntegrations = () =>
  safeInvoke<IntegrationMetadata[]>('vant_list_integrations');

export const vantLaunchIntegration = (id: string, model: string, configOnly: boolean = false) =>
  safeInvoke<string>('vant_launch_integration', { id, model, configOnly, config_only: configOnly });

export const vantListModelAliases = () =>
  safeInvoke<Record<string, string>>('vant_list_model_aliases');

export const vantSetModelAlias = (alias: string, target: string) =>
  safeInvoke<void>('vant_set_model_alias', { alias, target });

export const vantRemoveModelAlias = (alias: string) =>
  safeInvoke<boolean>('vant_remove_model_alias', { alias });
