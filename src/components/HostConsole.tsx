import React, { useState, useEffect } from 'react';
import { Icon } from './common/Icon';
import { useHosting } from '../hooks/useHosting';
import { useOllama } from '../hooks/useOllama';
import { useSettings } from '../hooks/useSettings';
import { useToast } from './common/Toast';
import { 
  getPairedDevices, 
  revokeDevice, 
  renameDevice,
  TrustedPeer, 
  generatePairingLink, 
  generatePairingCode,
  getLocalIp, 
  AppSettings,
  getActiveTunnelUrl,
  startQuickTunnel,
  stopQuickTunnel,
  getDockerStatus,
  detectGpuHardware,
  DockerStatus,
  GpuInfo,
  safeListen
} from '../lib/tauri';
import { Button } from './common/Button';
import { Badge } from './common/Badge';
import { StatusDot } from './common/StatusDot';
import { EmptyState } from './common/EmptyState';
import { Logo } from './common/Logo';
import { IntegrationsPanel } from './IntegrationsPanel';
import { AppStoreCatalog } from './AppStoreCatalog';
import { UserManagementPanel } from './UserManagementPanel';
import { ResourceMonitor } from './ResourceMonitor';
import { ThemeToggle } from './common/ThemeToggle';
import { CustomSelect } from './common/CustomSelect';

interface HostConsoleProps {
  onResetRole: () => void;
}

export const HostConsole: React.FC<HostConsoleProps> = ({ onResetRole }) => {
  const toast = useToast();
  const [activeNav, setActiveNav] = useState<'sessions' | 'catalog' | 'users' | 'devices' | 'model' | 'integrations' | 'settings'>('sessions');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { isHosting, sessions, hostingError, startHosting, stopHosting, killSession } = useHosting();
  const { status: ollamaStatus, models, pullModel, swapModel, startEngine, isStarting, ollamaError, pullProgress, isPulling } = useOllama();
  const { settings, save } = useSettings();
  
  // Local form state for Settings to prevent keystroke save jitter
  const [formSettings, setFormSettings] = useState<AppSettings | null>(null);
  const [numericDrafts, setNumericDrafts] = useState<Record<string, string>>({});
  const [tunnelMode, setTunnelMode] = useState<'quick' | 'named'>('quick');
  const [liveTunnelUrl, setLiveTunnelUrl] = useState<string | null>(null);
  const [tunnelStatusMsg, setTunnelStatusMsg] = useState<string | null>(null);
  const [isStartingTunnel, setIsStartingTunnel] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [showGroqKey, setShowGroqKey] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  const [devices, setDevices] = useState<TrustedPeer[]>([]);
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null);
  const [nicknameDraft, setNicknameDraft] = useState('');
  const [pairingLink, setPairingLink] = useState('');
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [isGeneratingCode, setIsGeneratingCode] = useState(false);
  const [isGeneratingLink, setIsGeneratingLink] = useState(false);
  const [dockerStatus, setDockerStatus] = useState<DockerStatus | null>(null);
  const [gpuInfo, setGpuInfo] = useState<GpuInfo | null>(null);
  const [localIp, setLocalIp] = useState('127.0.0.1');
  const [copiedLan, setCopiedLan] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState<string | null>(null);
  const [tunnelOs, setTunnelOs] = useState<'powershell' | 'cmd' | 'bash'>(() => {
    if (typeof navigator !== 'undefined' && /win/i.test(navigator.userAgent || navigator.platform)) {
      return 'powershell';
    }
    return 'bash';
  });

  const updateFormField = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setFormSettings(prev => ({
      ...(prev || settings),
      [key]: value
    }));
  };

  // Sync formSettings when settings load or update
  useEffect(() => {
    if (settings && settings.host_port !== undefined) {
      setFormSettings({ ...settings });
      setNumericDrafts({});
      if (settings.cloudflare_token && settings.cloudflare_token.trim().length > 0) {
        setTunnelMode('named');
      }
    }
  }, [settings]);

  // Listen for Cloudflare Quick Tunnel events (automatically clear or notify error when down)
  useEffect(() => {
    let unlistenReady: (() => void) | undefined;
    let unlistenCleared: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;
    let unlistenStatus: (() => void) | undefined;

    getActiveTunnelUrl().then(url => {
      setLiveTunnelUrl(url);
      if (url) {
        updateFormField('cloudflare_tunnel_url', url);
      } else {
        updateFormField('cloudflare_tunnel_url', null);
      }
    }).catch(console.error);

    safeListen<string>('tunnel-status', (event) => {
      if (event.payload) {
        setTunnelStatusMsg(event.payload);
      }
    }).then(fn => { unlistenStatus = fn; }).catch(console.error);

    safeListen<string>('tunnel-url-ready', (event) => {
      const url = event.payload?.trim() || null;
      setLiveTunnelUrl(url);
      setTunnelStatusMsg(null);
      setIsStartingTunnel(false);
      updateFormField('cloudflare_tunnel_url', url);
      if (url) {
        toast.success('Quick Tunnel live', url);
      }
    }).then(fn => { unlistenReady = fn; }).catch(console.error);

    safeListen('tunnel-url-cleared', () => {
      setLiveTunnelUrl(null);
      setTunnelStatusMsg(null);
      setIsStartingTunnel(false);
      updateFormField('cloudflare_tunnel_url', null);
    }).then(fn => { unlistenCleared = fn; }).catch(console.error);

    safeListen<string>('tunnel-error', (event) => {
      setLiveTunnelUrl(null);
      setTunnelStatusMsg(null);
      setIsStartingTunnel(false);
      updateFormField('cloudflare_tunnel_url', null);
      if (event.payload) {
        toast.error('Cloudflare Tunnel error', event.payload);
      }
    }).then(fn => { unlistenError = fn; }).catch(console.error);

    return () => {
      if (unlistenReady) unlistenReady();
      if (unlistenCleared) unlistenCleared();
      if (unlistenError) unlistenError();
      if (unlistenStatus) unlistenStatus();
    };
  }, []);

  useEffect(() => {
    if (!isStartingTunnel) return;
    const timer = setTimeout(() => {
      setIsStartingTunnel(false);
    }, 30000);
    return () => clearTimeout(timer);
  }, [isStartingTunnel]);

  const handleStartQuickTunnel = async () => {
    setIsStartingTunnel(true);
    setTunnelStatusMsg('Starting Cloudflare Quick Tunnel...');
    try {
      await startQuickTunnel();
    } catch (err: any) {
      setTunnelStatusMsg(null);
      setIsStartingTunnel(false);
      toast.error('Failed to start quick tunnel', err?.message || String(err));
    }
  };

  const handleStopQuickTunnel = async () => {
    try {
      await stopQuickTunnel();
      setLiveTunnelUrl(null);
      setTunnelStatusMsg(null);
      setIsStartingTunnel(false);
      updateFormField('cloudflare_tunnel_url', null);
      toast.info('Quick Tunnel stopped');
    } catch (err: any) {
      toast.error('Failed to stop tunnel', err?.message || String(err));
    }
  };

  const handleGeneratePin = async () => {
    setIsGeneratingCode(true);
    try {
      const code = await generatePairingCode();
      setPairingCode(code);
      toast.success('Pairing code generated', `Enter ${code} on your client device`);
    } catch (err: any) {
      toast.error('Failed to generate pairing code', err?.message || String(err));
    } finally {
      setIsGeneratingCode(false);
    }
  };

  const handleGenerateInviteLink = async () => {
    setIsGeneratingLink(true);
    try {
      const link = await generatePairingLink();
      setPairingLink(link);
      toast.success('Encrypted invite link created');
    } catch (err: any) {
      toast.error('Failed to generate invite link', err?.message || String(err));
    } finally {
      setIsGeneratingLink(false);
    }
  };

  const isSettingsDirty = Boolean(formSettings && settings && (
    formSettings.host_port !== settings.host_port ||
    formSettings.default_model !== settings.default_model ||
    formSettings.auto_start_hosting !== settings.auto_start_hosting ||
    formSettings.compression_enabled !== settings.compression_enabled ||
    formSettings.strip_credentials !== settings.strip_credentials ||
    formSettings.api_proxy_enabled !== settings.api_proxy_enabled ||
    formSettings.api_proxy_port !== settings.api_proxy_port ||
    formSettings.api_proxy_key !== settings.api_proxy_key ||
    formSettings.max_concurrent_requests !== settings.max_concurrent_requests ||
    formSettings.max_payload_bytes !== settings.max_payload_bytes ||
    formSettings.max_context_tokens !== settings.max_context_tokens ||
    formSettings.cloudflare_tunnel_url !== settings.cloudflare_tunnel_url ||
    formSettings.cloudflare_token !== settings.cloudflare_token ||
    formSettings.gemini_api_key !== settings.gemini_api_key ||
    formSettings.groq_api_key !== settings.groq_api_key
  ));

  const handleSaveAllSettings = async () => {
    if (!formSettings) return;
    setIsSavingSettings(true);
    const ok = await save(formSettings);
    setIsSavingSettings(false);
    if (ok) {
      setNumericDrafts({});
      setSavedFeedback('settings_all');
      toast.success('Host configuration saved');
      setTimeout(() => setSavedFeedback(null), 2500);
    } else {
      toast.error('Failed to save configuration');
    }
  };

  const handleResetSettings = () => {
    if (settings) {
      setFormSettings({ ...settings });
      setNumericDrafts({});
    }
  };

  const getTunnelCommand = () => {
    const port = formSettings?.host_port || settings.host_port || 8384;
    switch (tunnelOs) {
      case 'powershell':
        return `& "$env:LOCALAPPDATA\\com.vant.app\\cloudflared.exe" tunnel --url http://localhost:${port}`;
      case 'cmd':
        return `"%LOCALAPPDATA%\\com.vant.app\\cloudflared.exe" tunnel --url http://localhost:${port}`;
      case 'bash':
      default:
        return `~/.local/share/com.vant.app/cloudflared tunnel --url http://localhost:${port}`;
    }
  };

  useEffect(() => {
    getLocalIp().then(setLocalIp).catch(console.error);
    getDockerStatus().then(setDockerStatus).catch(() => {});
    detectGpuHardware().then(setGpuInfo).catch(() => {});
  }, []);

  useEffect(() => {
    if (!isHosting && settings?.auto_start_hosting !== false) {
      startHosting().catch(console.error);
    }
  }, [isHosting, settings?.auto_start_hosting, startHosting]);

  useEffect(() => {
    if (activeNav === 'devices') {
      getPairedDevices().then(setDevices).catch(console.error);
    }
  }, [activeNav]);

  const handleRevoke = async (id: string) => {
    try {
      await revokeDevice(id);
      setDevices(prev => prev.filter(d => d.peer_id !== id));
      toast.info('Device access revoked');
    } catch (err: any) {
      toast.error('Failed to revoke device', err?.message || String(err));
    }
  };

  const handleSaveNickname = async (peerId: string) => {
    const trimmed = nicknameDraft.trim();
    try {
      await renameDevice(peerId, trimmed || null);
      setDevices(prev =>
        prev.map(d => (d.peer_id === peerId ? { ...d, nickname: trimmed || null } : d))
      );
      setEditingDeviceId(null);
      toast.success(trimmed ? 'Device nicknamed' : 'Nickname cleared', trimmed || undefined);
    } catch (err: any) {
      toast.error('Failed to rename device', err?.message || String(err));
    }
  };

  const copyLanAddress = () => {
    const addr = `${localIp}:${settings.host_port || 8384}`;
    navigator.clipboard.writeText(addr);
    setCopiedLan(true);
    toast.success('Copied LAN address', addr);
    setTimeout(() => setCopiedLan(false), 2000);
  };

  const copyText = (text: string, label: string, feedbackKey?: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`Copied ${label}`);
    if (feedbackKey) {
      setSavedFeedback(feedbackKey);
      setTimeout(() => setSavedFeedback(null), 2000);
    }
  };

  return (
    <div className="flex" style={{ height: '100vh', width: '100vw', overflow: 'hidden' }}>
      
      {/* Sidebar */}
      <aside
        className="flex flex-col shrink-0 transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] select-none"
        style={{
          width: sidebarCollapsed ? '66px' : '232px',
          background: 'var(--gc-surface)',
          backdropFilter: 'var(--gc-glass)',
          WebkitBackdropFilter: 'var(--gc-glass)',
          borderRight: '1px solid var(--gc-border)',
          zIndex: 20,
        }}
      >
        {/* Minimal Brand & Collapse Header */}
        <div
          className="shrink-0 flex items-center border-b"
          style={{
            height: '56px',
            padding: sidebarCollapsed ? '0 10px' : '0 14px',
            justifyContent: sidebarCollapsed ? 'center' : 'space-between',
            borderColor: 'var(--gc-border)',
          }}
        >
          {sidebarCollapsed ? (
            <button
              type="button"
              onClick={() => setSidebarCollapsed(false)}
              className="group relative w-10 h-10 rounded-xl flex items-center justify-center hover:bg-[var(--gc-surface-sunken)] transition-colors cursor-pointer"
              title="Expand sidebar"
              aria-label="Expand sidebar"
            >
              <span className="transition-all duration-150 group-hover:opacity-0 group-hover:scale-75 flex items-center justify-center">
                <Logo size={24} />
              </span>
              <span className="absolute inset-0 flex items-center justify-center opacity-0 scale-75 group-hover:opacity-100 group-hover:scale-100 transition-all duration-150 text-[var(--gc-text)]">
                <Icon name="dock_to_right" size={18} />
              </span>
            </button>
          ) : (
            <>
              <div className="flex items-center gap-2.5 min-w-0">
                <Logo size={24} />
                <span className="text-[15px] font-semibold tracking-[-0.02em] text-[var(--gc-text)] truncate">
                  Vant
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSidebarCollapsed(true)}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--gc-text-muted)] hover:text-[var(--gc-text)] hover:bg-[var(--gc-surface-sunken)] transition-colors cursor-pointer"
                title="Minimize sidebar"
                aria-label="Minimize sidebar"
              >
                <Icon name="dock_to_left" size={17} />
              </button>
            </>
          )}
        </div>

        {/* Clean Source-List Navigation */}
        <nav className="flex flex-col gap-0.5 overflow-y-auto overflow-x-hidden flex-1 py-3 px-2.5">
          {[
            { id: 'sessions', label: 'Overview', icon: 'layers' },
            { id: 'model', label: 'Model Engine', icon: 'memory' },
            { id: 'catalog', label: 'App Store', icon: 'storefront' },
            { id: 'devices', label: 'Paired Devices', icon: 'devices' },
            { id: 'users', label: 'Access & RBAC', icon: 'verified_user' },
            { id: 'integrations', label: 'Integrations', icon: 'widgets' },
          ].map(nav => {
            const isActive = activeNav === nav.id;
            return (
              <button
                key={nav.id}
                type="button"
                onClick={() => setActiveNav(nav.id as any)}
                className={`group relative flex items-center transition-colors duration-150 cursor-pointer ${
                  sidebarCollapsed
                    ? 'justify-center w-10 h-10 mx-auto rounded-xl'
                    : 'gap-2.5 px-3 h-9 rounded-[10px] w-full'
                }`}
                style={{
                  background: isActive ? 'var(--gc-accent-muted)' : 'transparent',
                  color: isActive ? 'var(--gc-text)' : 'var(--gc-text-muted)',
                }}
              >
                <Icon
                  name={nav.icon}
                  size={17}
                  className={`shrink-0 transition-colors ${
                    isActive ? 'text-accent' : 'group-hover:text-[var(--gc-text)]'
                  }`}
                />
                {!sidebarCollapsed && (
                  <span className={`text-[13px] truncate ${isActive ? 'font-semibold' : 'font-medium group-hover:text-[var(--gc-text)]'}`}>
                    {nav.label}
                  </span>
                )}

                {sidebarCollapsed && (
                  <span
                    className="pointer-events-none absolute left-full ml-3 px-2.5 py-1 rounded-lg text-[11.5px] font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-150 border z-40"
                    style={{
                      background: 'var(--gc-surface)',
                      color: 'var(--gc-text)',
                      borderColor: 'var(--gc-border-light)',
                      boxShadow: 'var(--gc-shadow-md)',
                    }}
                  >
                    {nav.label}
                  </span>
                )}
              </button>
            );
          })}

          <div className="my-2 mx-2 h-px" style={{ background: 'var(--gc-border)' }} />

          {(() => {
            const isActive = activeNav === 'settings';
            return (
              <button
                type="button"
                onClick={() => setActiveNav('settings')}
                className={`group relative flex items-center transition-colors duration-150 cursor-pointer ${
                  sidebarCollapsed
                    ? 'justify-center w-10 h-10 mx-auto rounded-xl'
                    : 'gap-2.5 px-3 h-9 rounded-[10px] w-full'
                }`}
                style={{
                  background: isActive ? 'var(--gc-accent-muted)' : 'transparent',
                  color: isActive ? 'var(--gc-text)' : 'var(--gc-text-muted)',
                }}
              >
                <Icon
                  name="settings"
                  size={17}
                  className={`shrink-0 transition-colors ${
                    isActive ? 'text-accent' : 'group-hover:text-[var(--gc-text)]'
                  }`}
                />
                {!sidebarCollapsed && (
                  <span className={`text-[13px] truncate ${isActive ? 'font-semibold' : 'font-medium group-hover:text-[var(--gc-text)]'}`}>
                    Settings
                  </span>
                )}

                {sidebarCollapsed && (
                  <span
                    className="pointer-events-none absolute left-full ml-3 px-2.5 py-1 rounded-lg text-[11.5px] font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-150 border z-40"
                    style={{
                      background: 'var(--gc-surface)',
                      color: 'var(--gc-text)',
                      borderColor: 'var(--gc-border-light)',
                      boxShadow: 'var(--gc-shadow-md)',
                    }}
                  >
                    Settings
                  </span>
                )}
              </button>
            );
          })()}
        </nav>

        {/* Quiet Utility Footer */}
        <div
          className="shrink-0 border-t"
          style={{
            padding: sidebarCollapsed ? '12px 10px' : '12px 14px',
            borderColor: 'var(--gc-border)',
          }}
        >
          {sidebarCollapsed ? (
            <div className="flex flex-col items-center gap-2.5">
              <button
                type="button"
                onClick={() => setSidebarCollapsed(false)}
                className="w-10 h-9 rounded-xl flex items-center justify-center text-[var(--gc-text-muted)] hover:text-[var(--gc-text)] hover:bg-[var(--gc-surface-sunken)] transition-colors cursor-pointer"
                title="Expand sidebar"
                aria-label="Expand sidebar"
              >
                <Icon name="dock_to_right" size={17} />
              </button>
              <ThemeToggle size="sm" />
              <Button
                variant={isHosting ? 'danger' : 'primary'}
                size="sm"
                className="w-10 h-10 p-0 rounded-xl"
                onClick={async () => {
                  if (isHosting) {
                    await stopHosting();
                    toast.info('Host server stopped');
                  } else {
                    try {
                      await startHosting();
                      toast.success('Host server online');
                    } catch (err: any) {
                      toast.error('Failed to start server', err?.message || String(err));
                    }
                  }
                }}
                title={isHosting ? 'Stop Host Server' : 'Start Host Server'}
              >
                <Icon name={isHosting ? 'stop' : 'play_arrow'} size={16} />
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <StatusDot status={isHosting ? 'active' : 'idle'} />
                  <span className="text-[12px] font-medium text-[var(--gc-text)]">
                    {isHosting ? 'Online' : 'Offline'}
                  </span>
                </div>
                <span className="text-[11px] font-mono text-[var(--gc-text-dim)] tabular-nums">
                  {sessions.length} connected
                </span>
              </div>

              <Button
                variant={isHosting ? 'danger' : 'primary'}
                className="w-full h-9 text-[12.5px]"
                onClick={async () => {
                  if (isHosting) {
                    await stopHosting();
                    toast.info('Host server stopped');
                  } else {
                    try {
                      await startHosting();
                      toast.success('Host server online');
                    } catch (err: any) {
                      toast.error('Failed to start server', err?.message || String(err));
                    }
                  }
                }}
              >
                <Icon name={isHosting ? 'stop' : 'play_arrow'} size={15} />
                <span>{isHosting ? 'Stop Server' : 'Start Server'}</span>
              </Button>

              <div className="flex items-center justify-between pt-1">
                <ThemeToggle size="sm" />
                <button
                  type="button"
                  onClick={onResetRole}
                  disabled={isHosting}
                  title={isHosting ? 'Stop the Host Server before switching to Client Mode' : 'Switch between Host and Client mode'}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11.5px] font-medium text-[var(--gc-text-muted)] hover:text-[var(--gc-text)] hover:bg-[var(--gc-surface-sunken)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                  <Icon name="swap_horiz" size={14} />
                  <span>Switch Role</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <div className="min-w-0" style={{ flex: 1, padding: 'var(--gc-space-xl)', overflowY: 'auto' }}>
        
        {activeNav === 'sessions' && (
          <div className="flex flex-col gap-md">
            {hostingError && (
              <div
                className="flex items-center gap-sm px-4 py-3 rounded-xl border text-danger"
                style={{
                  background: 'var(--gc-danger-muted)',
                  borderColor: 'rgba(239, 68, 68, 0.35)',
                  fontSize: '13px'
                }}
              >
                <Icon name="warning" size={16} />
                <span>Host Server Error: {hostingError}</span>
              </div>
            )}

            {/* Quick Connect & Tunnel Hub Card */}
            <div 
              className="card glass-panel flex flex-col gap-md"
              style={{
                background: 'var(--gc-surface)',
                border: '1px solid var(--gc-border)',
                padding: 'var(--gc-space-lg)',
                borderRadius: 'var(--gc-radius-lg)'
              }}
            >
              <div className="flex flex-wrap items-center justify-between gap-sm pb-3 border-b border-[var(--gc-border)]">
                <div className="flex items-center gap-sm">
                  <div className="w-9 h-9 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-accent shrink-0">
                    <Icon name="sensors" size={18} />
                  </div>
                  <div>
                    <h2 style={{ fontSize: '16px', fontWeight: 600 }}>Quick Connect & Tunnel Hub</h2>
                    <p className="text-muted text-[12px]">
                      Pair another device on local Wi-Fi or across external networks via Noise-XX
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {gpuInfo && gpuInfo.vendor !== 'none' && (
                    <Badge variant="info">{gpuInfo.name}</Badge>
                  )}
                  {dockerStatus && (
                    <Badge variant={dockerStatus.running ? 'success' : 'neutral'}>
                      Docker: {dockerStatus.running ? 'Ready' : dockerStatus.installed ? 'Stopped' : 'Not Installed'}
                    </Badge>
                  )}
                  <Badge variant={isHosting ? 'success' : 'warning'}>
                    {isHosting ? 'Node Online' : 'Node Offline'}
                  </Badge>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-md">
                {/* 1. Local LAN */}
                <div
                  className="flex flex-col justify-between gap-sm p-3.5 rounded-xl border"
                  style={{ background: 'var(--gc-surface-sunken)', borderColor: 'var(--gc-border)' }}
                >
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted flex items-center gap-1">
                        <Icon name="wifi" size={12} className="text-accent" />
                        Local Wi-Fi (mDNS)
                      </span>
                      <Badge variant="info">Port {settings.host_port || 8384}</Badge>
                    </div>
                    <div className="text-mono font-semibold text-[13.5px] text-[var(--gc-text)] mt-1">
                      {localIp}:{settings.host_port || 8384}
                    </div>
                    <p className="text-[11px] text-muted mt-1">
                      Auto-discovered on same network
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={copyLanAddress} className="w-full justify-center">
                    {copiedLan ? <Icon name="check" size={13} className="text-success" /> : <Icon name="content_copy" size={13} />}
                    <span>{copiedLan ? 'Copied LAN IP' : 'Copy LAN Address'}</span>
                  </Button>
                </div>

                {/* 2. Cloudflare Quick Tunnel */}
                <div
                  className="flex flex-col justify-between gap-sm p-3.5 rounded-xl border"
                  style={{ background: 'var(--gc-surface-sunken)', borderColor: 'var(--gc-border)' }}
                >
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted flex items-center gap-1">
                        <Icon name="public" size={12} className="text-accent" />
                        Remote Tunnel
                      </span>
                      <Badge variant={liveTunnelUrl ? 'success' : isStartingTunnel ? 'info' : 'neutral'}>
                        {liveTunnelUrl ? 'Live' : isStartingTunnel ? 'Connecting' : 'Offline'}
                      </Badge>
                    </div>
                    <div className="text-mono text-[12px] text-[var(--gc-text)] truncate mt-1" title={liveTunnelUrl || undefined}>
                      {isStartingTunnel
                        ? (tunnelStatusMsg || 'Provisioning Cloudflare edge...')
                        : (liveTunnelUrl || 'No active remote URL')}
                    </div>
                    <p className="text-[11px] text-muted mt-1">
                      Ephemeral, zero-config access outside Wi-Fi
                    </p>
                  </div>
                  <div className="flex items-center gap-xs">
                    {liveTunnelUrl ? (
                      <>
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={async () => {
                            try {
                              const link = await generatePairingLink();
                              setPairingLink(link);
                              copyText(link, 'Connect Link', 'overview_tunnel');
                            } catch {
                              copyText(liveTunnelUrl, 'Tunnel URL', 'overview_tunnel');
                            }
                          }}
                          className="flex-1 justify-center"
                          title="Copy 1-click encrypted connect URL"
                        >
                          <Icon name={savedFeedback === 'overview_tunnel' ? 'check' : 'content_copy'} size={13} />
                          <span>{savedFeedback === 'overview_tunnel' ? 'Copied' : 'Copy Link'}</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={handleStartQuickTunnel}
                          disabled={isStartingTunnel}
                          title="Restart Quick Tunnel"
                        >
                          <Icon name="refresh" size={13} className={isStartingTunnel ? 'animate-spin' : ''} />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={handleStopQuickTunnel}
                          className="text-danger"
                          title="Stop Quick Tunnel"
                        >
                          <Icon name="stop" size={13} />
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={handleStartQuickTunnel}
                        disabled={isStartingTunnel}
                        className="w-full justify-center"
                      >
                        <Icon name={isStartingTunnel ? 'refresh' : 'bolt'} size={13} className={isStartingTunnel ? 'animate-spin' : ''} />
                        <span>{isStartingTunnel ? 'Connecting...' : 'Start Quick Tunnel'}</span>
                      </Button>
                    )}
                  </div>
                </div>

                {/* 3. Pairing Code & Invite Link */}
                <div
                  className="flex flex-col justify-between gap-sm p-3.5 rounded-xl border"
                  style={{ background: 'var(--gc-surface-sunken)', borderColor: 'var(--gc-border)' }}
                >
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted flex items-center gap-1">
                        <Icon name="key" size={12} className="text-accent" />
                        Client Pairing
                      </span>
                      {pairingCode && <Badge variant="success">Code Ready</Badge>}
                    </div>
                    {pairingCode ? (
                      <div className="flex items-center justify-between gap-2 mt-1">
                        <span className="text-mono font-bold text-[15px] tracking-[0.06em] text-accent truncate">
                          {pairingCode}
                        </span>
                        <button
                          type="button"
                          onClick={() => copyText(pairingCode, 'Pairing Code')}
                          className="btn btn-ghost shrink-0"
                          style={{ padding: '4px 8px', fontSize: '11px' }}
                        >
                          <Icon name="content_copy" size={12} />
                        </button>
                      </div>
                    ) : pairingLink ? (
                      <div className="text-mono text-[11.5px] text-[var(--gc-text)] truncate mt-1">
                        {pairingLink}
                      </div>
                    ) : (
                      <p className="text-[11.5px] text-muted mt-1">
                        Generate a pairing code or one-click encrypted link
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-xs">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleGeneratePin}
                      disabled={isGeneratingCode}
                      className="flex-1 justify-center"
                    >
                      <Icon name="password" size={13} />
                      <span>{isGeneratingCode ? '...' : 'Pairing Code'}</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleGenerateInviteLink}
                      disabled={isGeneratingLink}
                      className="flex-1 justify-center"
                    >
                      <Icon name="link" size={13} />
                      <span>{isGeneratingLink ? '...' : 'Invite Link'}</span>
                    </Button>
                    {pairingLink && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => copyText(pairingLink, 'Invite Link', 'overview_link')}
                        title="Copy invite link"
                      >
                        <Icon name={savedFeedback === 'overview_link' ? 'check' : 'content_copy'} size={13} />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Action Station */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-md">
              <div 
                onClick={() => setActiveNav('catalog')}
                className="card glass-panel cursor-pointer hover:border-violet-500/40 transition-all flex items-center gap-3 p-4 group"
              >
                <div className="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-accent group-hover:scale-105 transition-transform">
                  <Icon name="storefront" size={20} />
                </div>
                <div>
                  <div className="text-sm font-semibold text-[var(--gc-text)]">App Store Catalog</div>
                  <div className="text-xs text-[var(--gc-text-muted)]">16 AI & Media Tools</div>
                </div>
              </div>

              <div 
                onClick={() => setActiveNav('devices')}
                className="card glass-panel cursor-pointer hover:border-emerald-500/40 transition-all flex items-center gap-3 p-4 group"
              >
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500 group-hover:scale-105 transition-transform">
                  <Icon name="devices" size={20} />
                </div>
                <div>
                  <div className="text-sm font-semibold text-[var(--gc-text)]">Paired Client Devices</div>
                  <div className="text-xs text-[var(--gc-text-muted)]">Manage & Invite Clients</div>
                </div>
              </div>

              <div 
                onClick={() => setActiveNav('integrations')}
                className="card glass-panel cursor-pointer hover:border-blue-500/40 transition-all flex items-center gap-3 p-4 group"
              >
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-500 group-hover:scale-105 transition-transform">
                  <Icon name="widgets" size={20} />
                </div>
                <div>
                  <div className="text-sm font-semibold text-[var(--gc-text)]">OpenAI Gateway</div>
                  <div className="text-xs text-[var(--gc-text-muted)]">Cursor & Claude Code</div>
                </div>
              </div>
            </div>

            {/* Live Host Hardware & GPU Monitor */}
            <div className="my-2">
              <ResourceMonitor />
            </div>

            <div className="flex justify-between items-center" style={{ marginTop: 'var(--gc-space-sm)' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 600 }}>Active Sessions</h2>
              <span className="text-muted" style={{ fontSize: '13px' }}>{sessions.length} connected</span>
            </div>

            {sessions.length === 0 ? (
              <EmptyState 
                icon={<Icon name="bolt" size={24} />} 
                title="No active client sessions" 
                description="Waiting for client laptops to connect. Share your LAN IP or Quick Tunnel address." 
              />
            ) : (
              <div className="flex flex-col gap-sm">
                {sessions.map(session => (
                  <div key={session.peer_id} className="card glass-panel flex justify-between items-center">
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: 500 }}>
                        {session.nickname || session.device_name}
                      </div>
                      <div className="text-muted text-mono" style={{ fontSize: '12px' }}>
                        {session.nickname ? `${session.device_name} · ` : ''}ID: {session.peer_id.substring(0, 8)}...
                      </div>
                      <div className="text-muted" style={{ fontSize: '12px' }}>
                        Connected: {new Date(session.connected_at).toLocaleTimeString()}
                      </div>
                    </div>
                    <Button variant="danger" size="sm" onClick={() => killSession(session.peer_id)}>Kill</Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeNav === 'catalog' && (
          <AppStoreCatalog />
        )}

        {activeNav === 'users' && (
          <UserManagementPanel />
        )}

        {activeNav === 'devices' && (
          <div className="flex flex-col gap-md">
            <div className="flex flex-wrap justify-between items-center gap-3">
              <div>
                <h2 style={{ fontSize: '20px', fontWeight: 600 }}>Paired Devices</h2>
                <p className="text-muted text-[13px] mt-0.5">
                  Authorize client laptops using a one-click Noise-XX link or temporary pairing code.
                </p>
              </div>
              <div className="flex items-center gap-sm">
                <Button variant="ghost" onClick={handleGeneratePin} disabled={isGeneratingCode}>
                  <Icon name="password" size={14} />
                  <span>{isGeneratingCode ? 'Generating...' : 'Generate Pairing Code'}</span>
                </Button>
                <Button onClick={handleGenerateInviteLink} disabled={isGeneratingLink}>
                  <Icon name="link" size={14} />
                  <span>{isGeneratingLink ? 'Generating...' : 'Generate Invite Link'}</span>
                </Button>
              </div>
            </div>

            {pairingCode && (
              <div
                className="card glass-panel flex flex-wrap items-center justify-between gap-sm"
                style={{ background: 'var(--gc-accent-muted)', borderColor: 'var(--gc-accent)' }}
              >
                <div>
                  <div className="text-[13px] font-medium">Client Pairing Code</div>
                  <div className="text-muted text-[12px]">Enter this code on the client device under Quick Pair</div>
                </div>
                <div className="flex items-center gap-sm">
                  <span className="text-mono font-bold text-[19px] tracking-[0.08em] text-accent">
                    {pairingCode}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => copyText(pairingCode, 'Pairing Code')}>
                    <Icon name="content_copy" size={13} />
                    <span>Copy Code</span>
                  </Button>
                </div>
              </div>
            )}
            
            {pairingLink && (
              <div className="card glass-panel flex flex-col gap-sm" style={{ background: 'var(--gc-accent-muted)', borderColor: 'var(--gc-accent)' }}>
                <div style={{ fontSize: '14px', fontWeight: 500 }}>Share this encrypted link with your client device:</div>
                <div className="flex gap-sm">
                  <input readOnly value={pairingLink} className="input" style={{ flex: 1, fontFamily: 'monospace' }} />
                  <Button onClick={() => copyText(pairingLink, 'Invite Link')}>Copy</Button>
                </div>
                <div className="text-muted" style={{ fontSize: '12px' }}>Link expires in 10 minutes.</div>
              </div>
            )}

            {devices.length === 0 ? (
              <EmptyState 
                icon={<Icon name="devices" size={24} />} 
                title="No paired devices" 
                description="Generate an invite link or pairing code above to pair your first client laptop." 
              />
            ) : (
              <div className="flex flex-col gap-sm">
                {devices.map(device => {
                  const isEditing = editingDeviceId === device.peer_id;
                  return (
                    <div key={device.peer_id} className="card glass-panel flex flex-wrap justify-between items-center gap-3">
                      <div className="min-w-0 flex-1">
                        {isEditing ? (
                          <div className="flex items-center gap-2 max-w-md">
                            <input
                              type="text"
                              autoFocus
                              className="input text-xs py-1.5"
                              placeholder={device.device_name}
                              value={nicknameDraft}
                              onChange={e => setNicknameDraft(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') handleSaveNickname(device.peer_id);
                                if (e.key === 'Escape') setEditingDeviceId(null);
                              }}
                            />
                            <Button size="sm" variant="primary" onClick={() => handleSaveNickname(device.peer_id)}>
                              Save
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingDeviceId(null)}>
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-2">
                              <span style={{ fontSize: '14px', fontWeight: 500 }}>
                                {device.nickname || device.device_name}
                              </span>
                              <Badge variant="info">{device.role}</Badge>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingDeviceId(device.peer_id);
                                  setNicknameDraft(device.nickname || '');
                                }}
                                className="p-1 rounded-md text-[var(--gc-text-muted)] hover:text-[var(--gc-text)] hover:bg-[var(--gc-surface-sunken)] transition-colors cursor-pointer"
                                title="Set device nickname"
                                aria-label="Set device nickname"
                              >
                                <Icon name="edit" size={13} />
                              </button>
                            </div>
                            <div className="text-muted text-mono" style={{ fontSize: '12px' }}>
                              {device.nickname ? `${device.device_name} · ` : ''}{device.peer_id.substring(0, 12)}...
                            </div>
                          </>
                        )}
                      </div>
                      <Button variant="danger" size="sm" onClick={() => handleRevoke(device.peer_id)}>
                        Revoke Access
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeNav === 'model' && (
          <div className="flex flex-col gap-md">
            <div className="flex flex-wrap justify-between items-center gap-3">
              <div>
                <h2 style={{ fontSize: '20px', fontWeight: 600 }}>Model Management</h2>
                <p className="text-muted" style={{ fontSize: '13px', marginTop: '2px' }}>
                  Manage local LLM weights served to clients via Ollama.
                </p>
              </div>
              <div className="flex items-center gap-sm">
                {ollamaStatus !== 'Running' && (
                  <Button
                    size="sm"
                    onClick={async () => {
                      try {
                        await startEngine();
                        toast.success('Ollama Engine started');
                      } catch {}
                    }}
                    disabled={isStarting || ollamaStatus === 'NotInstalled'}
                  >
                    <Icon name={isStarting ? 'refresh' : 'play_arrow'} size={14} className={isStarting ? 'animate-spin' : ''} />
                    <span>{isStarting ? 'Starting Engine...' : 'Start Ollama Engine'}</span>
                  </Button>
                )}
                <Badge variant={ollamaStatus === 'Running' ? 'success' : 'danger'} className="shrink-0">
                  {ollamaStatus === 'Running' ? 'Ollama Online' : ollamaStatus === 'NotInstalled' ? 'Not Installed' : 'Ollama Offline'}
                </Badge>
              </div>
            </div>

            {ollamaError && (
              <div
                className="flex items-center gap-sm px-4 py-3 rounded-xl border text-danger"
                style={{
                  background: 'var(--gc-danger-muted)',
                  borderColor: 'rgba(239, 68, 68, 0.35)',
                  fontSize: '13px'
                }}
              >
                <Icon name="warning" size={16} />
                <span>{ollamaError}</span>
              </div>
            )}

            {ollamaStatus !== 'Running' && (
              <div className="card glass-panel flex flex-col gap-sm" style={{ border: '1px solid rgba(255, 69, 58, 0.3)', background: 'var(--gc-danger-muted)' }}>
                <div className="flex items-center justify-between gap-sm">
                  <div className="flex items-center gap-xs text-danger" style={{ fontWeight: 600, fontSize: '14px' }}>
                    <Icon name="info" size={16} />
                    <span>{ollamaStatus === 'NotInstalled' ? 'Ollama CLI not detected' : 'Ollama is not running on this machine'}</span>
                  </div>
                  {ollamaStatus === 'Stopped' && (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={async () => {
                        try {
                          await startEngine();
                          toast.success('Ollama Engine started');
                        } catch {}
                      }}
                      disabled={isStarting}
                    >
                      <Icon name={isStarting ? 'refresh' : 'bolt'} size={13} className={isStarting ? 'animate-spin' : ''} />
                      <span>{isStarting ? 'Starting...' : '1-Click Start Ollama'}</span>
                    </Button>
                  )}
                </div>
                <p className="text-muted" style={{ fontSize: '13px', lineHeight: 1.5 }}>
                  Vant Host relays requests to your local Ollama engine. Start it above or run the command below in your terminal:
                </p>
                <div className="flex items-center gap-sm" style={{ background: 'var(--gc-surface-sunken)', padding: '8px 12px', borderRadius: 'var(--gc-radius-md)', border: '1px solid var(--gc-border)' }}>
                  <code className="text-mono" style={{ fontSize: '12px', flex: 1 }}>
                    ollama serve
                  </code>
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    onClick={() => copyText('ollama serve', 'command', 'serve_cmd')}
                    className="flex items-center gap-xs"
                  >
                    {savedFeedback === 'serve_cmd' ? <Icon name="check" size={12} className="text-success" /> : <Icon name="content_copy" size={12} />}
                    <span>{savedFeedback === 'serve_cmd' ? 'Copied' : 'Copy'}</span>
                  </Button>
                </div>
              </div>
            )}

            <div className="card glass-panel">
              <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: 'var(--gc-space-md)' }}>Installed Models</h3>
              {models.length === 0 ? (
                <div className="flex flex-col gap-md">
                  <EmptyState 
                    icon={<Icon name="memory" size={24} />} 
                    title="No models installed" 
                    description="No LLM models found in your local Ollama instance." 
                  />
                  <div>
                    <span className="text-muted" style={{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Recommended Quick Installs:
                    </span>
                    <div className="flex flex-wrap gap-sm" style={{ marginTop: '8px' }}>
                      {[
                        { name: 'llama3.2:1b', desc: '1.3 GB • Ultra-fast' },
                        { name: 'llama3.2:3b', desc: '2.0 GB • High quality' },
                        { name: 'qwen2.5:1.5b', desc: '1.0 GB • Code & reasoning' },
                        { name: 'deepseek-r1:1.5b', desc: '1.1 GB • Reasoning engine' }
                      ].map(rec => (
                        <div 
                          key={rec.name}
                          className="flex items-center justify-between gap-md"
                          style={{ 
                            background: 'var(--gc-surface-sunken)', 
                            border: '1px solid var(--gc-border)', 
                            padding: '8px 12px', 
                            borderRadius: 'var(--gc-radius-md)',
                            flex: '1 1 200px'
                          }}
                        >
                          <div>
                            <div className="text-mono" style={{ fontSize: '13px', fontWeight: 600 }}>{rec.name}</div>
                            <div className="text-muted" style={{ fontSize: '11px' }}>{rec.desc}</div>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={isPulling || ollamaStatus !== 'Running'}
                            onClick={() => {
                              toast.info(`Pulling ${rec.name}`, 'Downloading model weights...');
                              pullModel(rec.name);
                            }}
                            className="flex items-center gap-xs"
                          >
                            <Icon name="download" size={12} />
                            <span>Pull</span>
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-sm">
                  {models.map(m => {
                    const isActive = (formSettings?.default_model || settings?.default_model) === m.name;
                    return (
                      <div 
                        key={m.name} 
                        className="flex justify-between items-center transition-colors" 
                        style={{ 
                          padding: 'var(--gc-space-sm) var(--gc-space-md)', 
                          background: 'var(--gc-surface-sunken)', 
                          border: isActive ? '1px solid rgba(139, 92, 246, 0.45)' : '1px solid var(--gc-border)', 
                          borderRadius: 'var(--gc-radius-md)' 
                        }}
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-mono" style={{ fontSize: '14px', fontWeight: 600 }}>{m.name}</span>
                            {isActive && (
                              <Badge variant="success">Active Default</Badge>
                            )}
                          </div>
                          <div className="text-muted" style={{ fontSize: '12px' }}>{(m.size / 1024 / 1024 / 1024).toFixed(2)} GB</div>
                        </div>
                        {!isActive ? (
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            onClick={async () => {
                              await swapModel(m.name);
                              updateFormField('default_model', m.name);
                              toast.success('Default model updated', m.name);
                            }}
                          >
                            Set Active
                          </Button>
                        ) : (
                          <span className="text-xs text-success font-medium flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                            Ready in VRAM
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Live Pull Progress Card */}
            {(isPulling || pullProgress) && (
              <div
                className="card glass-panel flex flex-col gap-2 p-4 border shadow-lg"
                style={{ background: 'var(--gc-accent-muted)', borderColor: 'rgba(139, 92, 246, 0.35)' }}
              >
                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-accent flex items-center gap-2">
                    <Icon name="download" size={15} className="animate-bounce text-accent" />
                    {pullProgress?.status || 'Downloading model weights...'}
                  </span>
                  {pullProgress?.completed && pullProgress?.total ? (
                    <span className="text-mono text-muted text-[11px]">
                      {(pullProgress.completed / 1024 / 1024 / 1024).toFixed(2)} GB / {(pullProgress.total / 1024 / 1024 / 1024).toFixed(2)} GB ({Math.round((pullProgress.completed / pullProgress.total) * 100)}%)
                    </span>
                  ) : null}
                </div>
                <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--gc-border)' }}>
                  <div 
                    className="h-full bg-gradient-to-r from-violet-600 to-indigo-400 transition-all duration-300"
                    style={{
                      width: pullProgress?.completed && pullProgress?.total 
                        ? `${Math.min(100, Math.round((pullProgress.completed / pullProgress.total) * 100))}%`
                        : '100%',
                      animation: !pullProgress?.total ? 'pulse 1.5s infinite' : undefined
                    }}
                  />
                </div>
              </div>
            )}

            <div className="card glass-panel">
              <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: 'var(--gc-space-xs)' }}>Pull Custom Model</h3>
              <p className="text-muted" style={{ fontSize: '13px', marginBottom: 'var(--gc-space-md)' }}>
                Download any model tag from the Ollama library (e.g. <code className="text-mono">mistral</code>, <code className="text-mono">gemma2</code>, <code className="text-mono">phi3</code>).
              </p>
              <div className="flex gap-sm" style={{ maxWidth: '420px' }}>
                <input type="text" id="pull-model-input" className="input" placeholder="e.g. llama3.2:1b" />
                <Button 
                  disabled={isPulling || ollamaStatus !== 'Running'}
                  onClick={() => {
                    const el = document.getElementById('pull-model-input') as HTMLInputElement;
                    if (el && el.value.trim()) {
                      const tag = el.value.trim();
                      toast.info(`Pulling ${tag}`, 'Downloading model weights...');
                      pullModel(tag);
                      el.value = '';
                    }
                  }}
                  className="flex items-center gap-xs"
                >
                  <Icon name="download" size={14} />
                  <span>{isPulling ? 'Pulling...' : 'Pull'}</span>
                </Button>
              </div>
            </div>
          </div>
        )}
        
        {activeNav === 'integrations' && (
          <IntegrationsPanel />
        )}

        {activeNav === 'settings' && (() => {
          const cur = formSettings || settings || ({} as AppSettings);
          const updateField = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
            setFormSettings(prev => ({
              ...(prev || settings),
              [key]: value
            }));
          };

          return (
            <div className="flex flex-col gap-xl pb-16" style={{ maxWidth: '960px', margin: '0 auto' }}>
              
              {/* Top Header & Sticky Save Status Bar */}
              <div className="flex flex-wrap justify-between items-center gap-md pb-4 border-b border-[var(--gc-border)]">
                <div>
                  <div className="flex items-center gap-sm">
                    <h2 style={{ fontSize: '22px', fontWeight: 600, letterSpacing: '-0.02em' }}>Host Configuration</h2>
                    <Badge variant="info">Settings</Badge>
                  </div>
                  <p className="text-muted" style={{ fontSize: '13px', marginTop: '2px' }}>
                    Tune daemon networking, zero-trust tunnel routing, GPU limits, and cloud fallbacks.
                  </p>
                </div>

                <div className="flex items-center gap-sm">
                  {isSettingsDirty && (
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={handleResetSettings}
                      disabled={isSavingSettings}
                      className="flex items-center gap-xs text-muted hover:text-[var(--gc-text)]"
                    >
                      <Icon name="restart_alt" size={13} />
                      <span>Discard Changes</span>
                    </Button>
                  )}
                  <Button 
                    variant="primary"
                    onClick={handleSaveAllSettings}
                    disabled={isSavingSettings || !isSettingsDirty}
                    className="flex items-center gap-xs"
                    style={{
                      opacity: isSettingsDirty ? 1 : 0.6,
                      boxShadow: isSettingsDirty ? '0 0 20px rgba(139, 92, 246, 0.4)' : 'none'
                    }}
                  >
                    {isSavingSettings ? (
                      <>
                        <span className="spinner" />
                        <span>Saving...</span>
                      </>
                    ) : savedFeedback === 'settings_all' ? (
                      <>
                        <Icon name="check" size={14} className="text-success" />
                        <span>Configuration Saved</span>
                      </>
                    ) : (
                      <>
                        <Icon name="save" size={14} />
                        <span>{isSettingsDirty ? 'Save Changes' : 'Saved'}</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {/* 1. Host Daemon & Network Engine */}
              <div className="card glass-panel flex flex-col gap-md" style={{ padding: '22px' }}>
                <div className="flex flex-wrap justify-between items-center gap-3 pb-3 border-b border-[var(--gc-border)]">
                  <div className="flex items-center gap-sm">
                    <div className="w-8 h-8 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-accent shrink-0">
                      <Icon name="tune" size={16} />
                    </div>
                    <div>
                      <h3 style={{ fontSize: '15px', fontWeight: 600 }}>Host Daemon & Local Network</h3>
                      <p className="text-muted text-[12px]">Local binding port, API gateway port, and serving defaults</p>
                    </div>
                  </div>
                  <Badge variant="neutral" className="shrink-0">Core Daemon</Badge>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-lg pt-1">
                  <div className="flex flex-col gap-xs">
                    <label style={{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }} className="text-muted">
                      Host Listen Port
                    </label>
                    <input 
                      type="number" 
                      className="input" 
                      value={numericDrafts.host_port ?? String(cur.host_port ?? 8384)} 
                      onChange={e => {
                        const raw = e.target.value;
                        setNumericDrafts(prev => ({ ...prev, host_port: raw }));
                        const val = parseInt(raw, 10);
                        if (!isNaN(val) && val >= 1024 && val <= 65535) {
                          updateField('host_port', val);
                        }
                      }}
                      onBlur={() => {
                        const val = parseInt(numericDrafts.host_port ?? '', 10);
                        const committed = !isNaN(val) ? Math.min(65535, Math.max(1024, val)) : (cur.host_port ?? 8384);
                        updateField('host_port', committed);
                        setNumericDrafts(prev => {
                          const next = { ...prev };
                          delete next.host_port;
                          return next;
                        });
                      }}
                    />
                    <div className="flex items-center gap-xs mt-1 text-[11px] text-[var(--gc-text-muted)]">
                      <span>LAN:</span>
                      <code className="text-mono text-[var(--gc-text)] bg-[var(--gc-surface-sunken)] border border-[var(--gc-border)] px-1.5 py-0.5 rounded truncate">
                        {localIp}:{cur.host_port ?? 8384}
                      </code>
                    </div>
                  </div>

                  <div className="flex flex-col gap-xs">
                    <label style={{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }} className="text-muted">
                      OpenAI Gateway Port
                    </label>
                    <input 
                      type="number" 
                      className="input" 
                      value={numericDrafts.api_proxy_port ?? String(cur.api_proxy_port ?? 11434)} 
                      onChange={e => {
                        const raw = e.target.value;
                        setNumericDrafts(prev => ({ ...prev, api_proxy_port: raw }));
                        const val = parseInt(raw, 10);
                        if (!isNaN(val) && val >= 1024 && val <= 65535) {
                          updateField('api_proxy_port', val);
                        }
                      }}
                      onBlur={() => {
                        const val = parseInt(numericDrafts.api_proxy_port ?? '', 10);
                        const committed = !isNaN(val) ? Math.min(65535, Math.max(1024, val)) : (cur.api_proxy_port ?? 11434);
                        updateField('api_proxy_port', committed);
                        setNumericDrafts(prev => {
                          const next = { ...prev };
                          delete next.api_proxy_port;
                          return next;
                        });
                      }}
                    />
                    <span className="text-muted text-[11px] mt-1">Auto-falls back to 11435 / 8787 if busy</span>
                  </div>

                  <div className="flex flex-col gap-xs">
                    <label style={{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }} className="text-muted">
                      Default Serving Model
                    </label>
                    <CustomSelect
                      value={cur.default_model || ''}
                      onChange={val => updateField('default_model', val || null)}
                      placeholder="Auto-select (First available)"
                      options={[
                        { value: '', label: 'Auto-select (First available)', description: 'Automatically serves the first loaded model in Ollama' },
                        ...models.map(m => ({
                          value: m.name,
                          label: m.name,
                          description: `${(m.size / (1024 * 1024 * 1024)).toFixed(2)} GB • VRAM Ready`
                        }))
                      ]}
                    />
                    <span className="text-muted text-[11px] mt-1">Default model served to incoming client sessions</span>
                  </div>
                </div>

                {/* Tactile Toggle Switches */}
                <div className="flex flex-col gap-sm pt-3 border-t border-[var(--gc-border)]">
                  
                  {/* Switch 1: Auto-start */}
                  <div 
                    onClick={() => updateField('auto_start_hosting', !cur.auto_start_hosting)}
                    className="flex items-center justify-between p-3 rounded-xl bg-[var(--gc-surface-sunken)] hover:bg-[var(--gc-border)] border border-[var(--gc-border)] cursor-pointer transition-colors"
                  >
                    <div className="pr-4">
                      <div className="text-[13px] font-medium text-[var(--gc-text)]">Auto-start Host Server on Launch</div>
                      <div className="text-[11px] text-[var(--gc-text-muted)] mt-0.5">
                        Automatically spins up the compute daemon and begins listening for client pairing when Vant starts
                      </div>
                    </div>
                    <div className={`toggle-switch ${cur.auto_start_hosting ? 'active' : ''}`}>
                      <div className="toggle-switch-thumb" />
                    </div>
                  </div>

                  {/* Switch 2: Compression */}
                  <div 
                    onClick={() => updateField('compression_enabled', !cur.compression_enabled)}
                    className="flex items-center justify-between p-3 rounded-xl bg-[var(--gc-surface-sunken)] hover:bg-[var(--gc-border)] border border-[var(--gc-border)] cursor-pointer transition-colors"
                  >
                    <div className="pr-4">
                      <div className="text-[13px] font-medium text-[var(--gc-text)]">Hardware Payload Compression (LZ4 / zstd)</div>
                      <div className="text-[11px] text-[var(--gc-text-muted)] mt-0.5">
                        Compresses token streams and network payloads to save up to 60% bandwidth on remote client connections
                      </div>
                    </div>
                    <div className={`toggle-switch ${cur.compression_enabled ? 'active' : ''}`}>
                      <div className="toggle-switch-thumb" />
                    </div>
                  </div>

                  {/* Switch 3: API Proxy */}
                  <div 
                    onClick={() => updateField('api_proxy_enabled', !cur.api_proxy_enabled)}
                    className="flex items-center justify-between p-3 rounded-xl bg-[var(--gc-surface-sunken)] hover:bg-[var(--gc-border)] border border-[var(--gc-border)] cursor-pointer transition-colors"
                  >
                    <div className="pr-4">
                      <div className="text-[13px] font-medium text-[var(--gc-text)]">Local OpenAI Compatibility Gateway</div>
                      <div className="text-[11px] text-[var(--gc-text-muted)] mt-0.5">
                        Enables localhost:{cur.api_proxy_port ?? 11434} API translation for Cursor, Claude Code CLI, and Continue
                      </div>
                    </div>
                    <div className={`toggle-switch ${cur.api_proxy_enabled ? 'active' : ''}`}>
                      <div className="toggle-switch-thumb" />
                    </div>
                  </div>

                  {/* Switch 4: Privacy Credential Scrubbing */}
                  <div 
                    onClick={() => updateField('strip_credentials', !cur.strip_credentials)}
                    className="flex items-center justify-between p-3 rounded-xl bg-[var(--gc-surface-sunken)] hover:bg-[var(--gc-border)] border border-[var(--gc-border)] cursor-pointer transition-colors"
                  >
                    <div className="pr-4">
                      <div className="text-[13px] font-medium text-[var(--gc-text)]">Privacy Masking & Secret Scrubbing</div>
                      <div className="text-[11px] text-[var(--gc-text-muted)] mt-0.5">
                        Automatically redacts API keys, JWTs, AWS secrets, and sensitive tokens in transit
                      </div>
                    </div>
                    <div className={`toggle-switch ${cur.strip_credentials ? 'active' : ''}`}>
                      <div className="toggle-switch-thumb" />
                    </div>
                  </div>

                </div>
              </div>

              {/* 2. Zero-Trust Tunneling Gateway */}
              <div className="card glass-panel flex flex-col gap-md" style={{ padding: '22px' }}>
                <div className="flex flex-wrap justify-between items-center gap-sm pb-3 border-b border-[var(--gc-border)]">
                  <div className="flex items-center gap-sm">
                    <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                      <Icon name="public" size={16} />
                    </div>
                    <div>
                      <h3 style={{ fontSize: '15px', fontWeight: 600 }}>Cloudflare Zero-Trust Tunneling</h3>
                      <p className="text-muted text-[12px]">Encrypted global ingress without port forwarding</p>
                    </div>
                  </div>

                  {/* Segmented Mode Selector */}
                  <div className="segmented-control">
                    <button
                      type="button"
                      onClick={() => setTunnelMode('quick')}
                      className={`segmented-item ${tunnelMode === 'quick' ? 'active' : ''}`}
                    >
                      Free Quick Tunnel
                    </button>
                    <button
                      type="button"
                      onClick={() => setTunnelMode('named')}
                      className={`segmented-item ${tunnelMode === 'named' ? 'active' : ''}`}
                    >
                      Named Zero Trust Tunnel
                    </button>
                  </div>
                </div>

                {tunnelMode === 'quick' ? (
                  <div className="flex flex-col gap-md pt-1">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <p className="text-muted text-[13px] leading-relaxed">
                        Expose your Host server over an ephemeral, end-to-end encrypted Cloudflare tunnel (<code className="text-mono">trycloudflare.com</code>) with zero account configuration.
                      </p>
                      <Badge variant="success" className="self-start sm:self-auto shrink-0">Free • Instant</Badge>
                    </div>

                    {/* OS & Shell Selector */}
                    <div className="flex items-center gap-xs">
                      <span className="text-muted text-[12px] mr-2">Terminal Shell:</span>
                      <div className="segmented-control">
                        <button
                          type="button"
                          onClick={() => setTunnelOs('powershell')}
                          className={`segmented-item ${tunnelOs === 'powershell' ? 'active' : ''}`}
                        >
                          PowerShell
                        </button>
                        <button
                          type="button"
                          onClick={() => setTunnelOs('cmd')}
                          className={`segmented-item ${tunnelOs === 'cmd' ? 'active' : ''}`}
                        >
                          CMD
                        </button>
                        <button
                          type="button"
                          onClick={() => setTunnelOs('bash')}
                          className={`segmented-item ${tunnelOs === 'bash' ? 'active' : ''}`}
                        >
                          Bash / Zsh
                        </button>
                      </div>
                    </div>

                    {/* Command Box */}
                    <div className="flex items-center gap-sm bg-[var(--gc-surface-sunken)] border border-[var(--gc-border)] rounded-xl p-3">
                      <code className="text-mono text-[var(--gc-text)] text-[12px] flex-1 break-all">
                        {getTunnelCommand()}
                      </code>
                      <Button 
                        size="sm" 
                        variant="ghost" 
                        onClick={() => {
                          navigator.clipboard.writeText(getTunnelCommand());
                          setSavedFeedback('cmd_copy');
                          setTimeout(() => setSavedFeedback(null), 2000);
                        }}
                        className="flex items-center gap-xs shrink-0"
                      >
                        {savedFeedback === 'cmd_copy' ? <Icon name="check" size={12} className="text-success" /> : <Icon name="content_copy" size={12} />}
                        <span>{savedFeedback === 'cmd_copy' ? 'Copied' : 'Copy'}</span>
                      </Button>
                    </div>

                    {/* URL Input */}
                    <div className="flex flex-col gap-xs">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <label style={{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }} className="text-muted">
                            Active Quick Tunnel URL
                          </label>
                          {liveTunnelUrl ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
                              <span className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
                              Offline
                            </span>
                          )}
                        </div>

                        <Button
                          size="sm"
                          variant={liveTunnelUrl ? "ghost" : "primary"}
                          onClick={handleStartQuickTunnel}
                          disabled={isStartingTunnel}
                          className="flex items-center gap-1 text-[11px] px-2.5 py-1"
                        >
                          <Icon 
                            name={isStartingTunnel ? "refresh" : "bolt"} 
                            size={12} 
                            className={isStartingTunnel ? "animate-spin text-accent" : liveTunnelUrl ? "text-accent" : "text-white"} 
                          />
                          <span>{isStartingTunnel ? "Starting..." : (liveTunnelUrl ? "Restart Tunnel" : "Start New Quick Tunnel")}</span>
                        </Button>
                      </div>

                      <div className="flex gap-sm mt-1">
                        <input 
                          type="text" 
                          className="input flex-1" 
                          placeholder={liveTunnelUrl ? liveTunnelUrl : "No active tunnel. Click 'Start New Quick Tunnel' above to launch."} 
                          value={cur.cloudflare_tunnel_url || ''}
                          onChange={(e) => updateField('cloudflare_tunnel_url', e.target.value || null)}
                        />
                        {cur.cloudflare_tunnel_url && (
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => window.open(cur.cloudflare_tunnel_url!, '_blank')}
                            className="flex items-center gap-xs"
                            title="Open URL in browser"
                          >
                            <Icon name="open_in_new" size={13} />
                            <span>Visit</span>
                          </Button>
                        )}
                      </div>
                      <span className="text-muted text-[11px] mt-0.5">
                        {liveTunnelUrl 
                          ? "Tunnel is live and broadcasting via Cloudflare edge. Automatically clears if disconnected." 
                          : "Tunnel is currently offline. Click 'Start New Quick Tunnel' to generate an ephemeral endpoint."}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-md pt-1">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <p className="text-muted text-[13px] leading-relaxed">
                        Connect your host gaming rig directly to your custom domain via Cloudflare Zero Trust tunnel token.
                      </p>
                      <Badge variant="info" className="self-start sm:self-auto shrink-0">Persistent • Custom Domain</Badge>
                    </div>

                    <div className="flex flex-col gap-xs">
                      <label style={{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }} className="text-muted">
                        Cloudflare Tunnel Token
                      </label>
                      <div className="flex gap-sm">
                        <div className="relative flex-1">
                          <input 
                            type={showToken ? "text" : "password"} 
                            className="input w-full pr-10" 
                            placeholder="eyJh..." 
                            value={cur.cloudflare_token || ''}
                            onChange={(e) => updateField('cloudflare_token', e.target.value || null)}
                          />
                          <button
                            type="button"
                            onClick={() => setShowToken(!showToken)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-[var(--gc-text)] transition-colors"
                          >
                            {showToken ? <Icon name="visibility_off" size={14} /> : <Icon name="visibility" size={14} />}
                          </button>
                        </div>
                      </div>
                      <span className="text-muted text-[11px] mt-0.5">
                        Obtained from Cloudflare Zero Trust Dashboard &gt; Networks &gt; Tunnels &gt; Install Connector
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* 3. Resource Guardrails & Concurrency Limits */}
              <div className="card glass-panel flex flex-col gap-md" style={{ padding: '22px' }}>
                <div className="flex flex-wrap justify-between items-center gap-3 pb-3 border-b border-[var(--gc-border)]">
                  <div className="flex items-center gap-sm">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500 shrink-0">
                      <Icon name="memory" size={16} />
                    </div>
                    <div>
                      <h3 style={{ fontSize: '15px', fontWeight: 600 }}>Resource Guardrails & Concurrency</h3>
                      <p className="text-muted text-[12px]">VRAM protection and client traffic throttling</p>
                    </div>
                  </div>
                  <Badge variant="success" className="shrink-0">VRAM Guard</Badge>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-md pt-1">
                  <div className="flex flex-col gap-xs">
                    <label style={{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }} className="text-muted">
                      Max Concurrent Requests
                    </label>
                    <input 
                      type="number" 
                      className="input" 
                      value={numericDrafts.max_concurrent_requests ?? String(cur.max_concurrent_requests ?? 10)} 
                      onChange={e => {
                        const raw = e.target.value;
                        setNumericDrafts(prev => ({ ...prev, max_concurrent_requests: raw }));
                        const val = parseInt(raw, 10);
                        if (!isNaN(val) && val >= 1 && val <= 128) {
                          updateField('max_concurrent_requests', val);
                        }
                      }}
                      onBlur={() => {
                        const val = parseInt(numericDrafts.max_concurrent_requests ?? '', 10);
                        const committed = !isNaN(val) ? Math.min(128, Math.max(1, val)) : (cur.max_concurrent_requests ?? 10);
                        updateField('max_concurrent_requests', committed);
                        setNumericDrafts(prev => {
                          const next = { ...prev };
                          delete next.max_concurrent_requests;
                          return next;
                        });
                      }}
                    />
                    <span className="text-muted text-[11px] mt-0.5">Max simultaneous client requests</span>
                  </div>

                  <div className="flex flex-col gap-xs">
                    <label style={{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }} className="text-muted">
                      Max Payload Size (MB)
                    </label>
                    <input 
                      type="number" 
                      className="input" 
                      value={numericDrafts.max_payload_mb ?? String(Math.round((cur.max_payload_bytes ?? 104857600) / (1024 * 1024)))} 
                      onChange={e => {
                        const raw = e.target.value;
                        setNumericDrafts(prev => ({ ...prev, max_payload_mb: raw }));
                        const mb = parseInt(raw, 10);
                        if (!isNaN(mb) && mb >= 1 && mb <= 2048) {
                          updateField('max_payload_bytes', mb * 1024 * 1024);
                        }
                      }}
                      onBlur={() => {
                        const mb = parseInt(numericDrafts.max_payload_mb ?? '', 10);
                        const currentMb = Math.round((cur.max_payload_bytes ?? 104857600) / (1024 * 1024));
                        const committedMb = !isNaN(mb) ? Math.min(2048, Math.max(1, mb)) : currentMb;
                        updateField('max_payload_bytes', committedMb * 1024 * 1024);
                        setNumericDrafts(prev => {
                          const next = { ...prev };
                          delete next.max_payload_mb;
                          return next;
                        });
                      }}
                    />
                    <span className="text-muted text-[11px] mt-0.5">Prevents payload buffer overflows</span>
                  </div>

                  <div className="flex flex-col gap-xs">
                    <label style={{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }} className="text-muted">
                      Max Context Tokens
                    </label>
                    <input 
                      type="number" 
                      className="input" 
                      value={numericDrafts.max_context_tokens ?? String(cur.max_context_tokens ?? 8192)} 
                      onChange={e => {
                        const raw = e.target.value;
                        setNumericDrafts(prev => ({ ...prev, max_context_tokens: raw }));
                        const val = parseInt(raw, 10);
                        if (!isNaN(val) && val >= 512 && val <= 131072) {
                          updateField('max_context_tokens', val);
                        }
                      }}
                      onBlur={() => {
                        const val = parseInt(numericDrafts.max_context_tokens ?? '', 10);
                        const committed = !isNaN(val) ? Math.min(131072, Math.max(512, val)) : (cur.max_context_tokens ?? 8192);
                        updateField('max_context_tokens', committed);
                        setNumericDrafts(prev => {
                          const next = { ...prev };
                          delete next.max_context_tokens;
                          return next;
                        });
                      }}
                    />
                    <span className="text-muted text-[11px] mt-0.5">Per-request KV cache bound</span>
                  </div>
                </div>
              </div>

              {/* 4. Cloud AI Gateways (External Fallbacks) */}
              <div className="card glass-panel flex flex-col gap-md" style={{ padding: '22px' }}>
                <div className="flex flex-wrap justify-between items-center gap-3 pb-3 border-b border-[var(--gc-border)]">
                  <div className="flex items-center gap-sm">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 shrink-0">
                      <Icon name="bolt" size={16} />
                    </div>
                    <div>
                      <h3 style={{ fontSize: '15px', fontWeight: 600 }}>Cloud AI Gateways</h3>
                      <p className="text-muted text-[12px]">Optional cloud provider keys for hybrid fallback routing</p>
                    </div>
                  </div>
                  <Badge variant="warning" className="shrink-0">Optional</Badge>
                </div>

                <p className="text-muted text-[13px]">
                  Provide external API keys so connected client laptops can route queries through Vant to cloud models (Google Gemini or Groq) when your local GPU VRAM is saturated.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-lg pt-1">
                  <div className="flex flex-col gap-xs">
                    <label style={{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }} className="text-muted">
                      Google Gemini API Key
                    </label>
                    <div className="relative">
                      <input 
                        type={showGeminiKey ? "text" : "password"} 
                        className="input w-full pr-10" 
                        placeholder="AIzaSy..." 
                        value={cur.gemini_api_key || ''}
                        onChange={(e) => updateField('gemini_api_key', e.target.value || null)}
                      />
                      <button
                        type="button"
                        onClick={() => setShowGeminiKey(!showGeminiKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-[var(--gc-text)] transition-colors"
                      >
                        {showGeminiKey ? <Icon name="visibility_off" size={14} /> : <Icon name="visibility" size={14} />}
                      </button>
                    </div>
                    <span className="text-muted text-[11px] mt-0.5">Access gemini-2.5-flash and gemini-1.5-pro models</span>
                  </div>

                  <div className="flex flex-col gap-xs">
                    <label style={{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }} className="text-muted">
                      Groq API Key
                    </label>
                    <div className="relative">
                      <input 
                        type={showGroqKey ? "text" : "password"} 
                        className="input w-full pr-10" 
                        placeholder="gsk_..." 
                        value={cur.groq_api_key || ''}
                        onChange={(e) => updateField('groq_api_key', e.target.value || null)}
                      />
                      <button
                        type="button"
                        onClick={() => setShowGroqKey(!showGroqKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-[var(--gc-text)] transition-colors"
                      >
                        {showGroqKey ? <Icon name="visibility_off" size={14} /> : <Icon name="visibility" size={14} />}
                      </button>
                    </div>
                    <span className="text-muted text-[11px] mt-0.5">Ultra-low-latency LPU cloud inference endpoint</span>
                  </div>
                </div>
              </div>

            </div>
          );
        })()}
      </div>
    </div>
  );
};
