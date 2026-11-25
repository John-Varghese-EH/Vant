import React, { useState, useEffect } from 'react';
import { Icon } from './common/Icon';
import { Button } from './common/Button';
import { Badge } from './common/Badge';
import { IconBadge } from './common/IconBadge';
import { useApiProxy } from '../hooks/useApiProxy';
import { ensureServiceTunnelPort } from '../lib/tauri';
import { useToast } from './common/Toast';

interface AgentShortcutsPanelProps {
  isConnected: boolean;
  tunnelUrl?: string | null;
  onNavigatePairing?: () => void;
}

export const AgentShortcutsPanel: React.FC<AgentShortcutsPanelProps> = ({
  isConnected,
  onNavigatePairing,
}) => {
  const toast = useToast();
  const { status: proxyStatus, start: startProxy } = useApiProxy();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [launchingTool, setLaunchingTool] = useState<string | null>(null);
  const [showOfflineModal, setShowOfflineModal] = useState<string | null>(null);
  const [autoStarted, setAutoStarted] = useState(false);

  const proxyPort = proxyStatus.running && proxyStatus.port > 0 ? proxyStatus.port : 11434;

  // Automatically spin up the local compatibility gateway when Client connects
  useEffect(() => {
    if (isConnected && !proxyStatus.running && !autoStarted) {
      setAutoStarted(true);
      startProxy().catch(err => {
        console.warn('Auto-start client proxy deferred:', err);
      });
    }
  }, [isConnected, proxyStatus.running, autoStarted, startProxy]);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleLaunchWebTool = async (toolName: string, remotePort: number, path: string = '/') => {
    if (!isConnected) {
      setShowOfflineModal(toolName);
      return;
    }

    setLaunchingTool(toolName);
    try {
      const localPort = await ensureServiceTunnelPort(remotePort);
      const targetUrl = `http://127.0.0.1:${localPort}${path}`;
      window.open(targetUrl, '_blank');
      toast.success(`Opening ${toolName}`, `Tunneled securely via 127.0.0.1:${localPort}`);
    } catch (err: any) {
      toast.error(
        `Unable to bridge ${toolName}`,
        typeof err === 'string' ? err : err?.message || 'Ensure the service is running on your Host PC.'
      );
    } finally {
      setLaunchingTool(null);
    }
  };

  const handleCreateDesktopShortcut = (name: string, port: number, path: string = '/') => {
    const isWindows = typeof navigator !== 'undefined' && /win/i.test(navigator.userAgent || navigator.platform);
    const url = `http://127.0.0.1:${port}${path}`;

    if (isWindows) {
      const urlContent = `[InternetShortcut]\nURL=${url}\nIconIndex=0\n`;
      const blob = new Blob([urlContent], { type: 'text/plain' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `Vant - ${name}.url`;
      link.click();
    } else {
      const desktopContent = `[Desktop Entry]\nName=Vant - ${name}\nComment=Launch ${name} via Vant Remote Compute\nExec=xdg-open ${url}\nTerminal=false\nType=Application\nIcon=utilities-terminal\nCategories=Development;AI;\n`;
      const blob = new Blob([desktopContent], { type: 'text/plain' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${name.toLowerCase().replace(/\s+/g, '-')}.desktop`;
      link.click();
    }
    toast.success('Shortcut Created', `Saved launch shortcut for ${name}.`);
  };

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-[var(--gc-text)] flex items-center gap-2">
          <Icon name="smart_toy" size={22} className="text-accent" />
          <span>Smart Agent &amp; Coding Assistant Auto-Config</span>
        </h2>
        <p className="text-sm text-[var(--gc-text-muted)] mt-1">
          Route <span className="text-[var(--gc-text)] font-medium">Claude Code, Antigravity, Cursor, and Continue</span> through your remote Workstation GPU via the local proxy gateway (<code className="text-accent font-mono">127.0.0.1:{proxyPort}</code>).
        </p>
      </div>

      {/* Real Connection & Proxy Status Banner */}
      <div
        className={`p-4 rounded-xl border flex flex-wrap items-center justify-between gap-3 ${
          isConnected && proxyStatus.running
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500'
            : isConnected
            ? 'bg-violet-500/10 border-violet-500/30 text-accent'
            : 'bg-amber-500/10 border-amber-500/30 text-amber-500'
        }`}
      >
        <div className="flex items-center gap-3">
          {isConnected ? <Icon name="wifi" size={18} /> : <Icon name="wifi_off" size={18} />}
          <div>
            <div className="text-sm font-semibold text-[var(--gc-text)]">
              {isConnected && proxyStatus.running
                ? `Local Proxy Active (127.0.0.1:${proxyStatus.port})`
                : isConnected
                ? 'Host Connected - Local Proxy Idle'
                : 'Host Disconnected'}
            </div>
            <div className="text-xs text-[var(--gc-text-muted)] mt-0.5">
              {isConnected && proxyStatus.running
                ? 'Local agents transparently forward inference requests over the Noise-XX encrypted tunnel.'
                : isConnected
                ? 'Start the local OpenAI compatibility gateway so IDEs and CLI tools can connect.'
                : 'Connect to your Vant Host PC first to enable remote GPU routing.'}
            </div>
          </div>
        </div>
        {!isConnected && onNavigatePairing ? (
          <Button size="sm" variant="primary" onClick={onNavigatePairing} className="text-xs">
            Connect Host
          </Button>
        ) : (
          isConnected &&
          !proxyStatus.running && (
            <Button
              size="sm"
              variant="primary"
              onClick={() => startProxy().catch(e => toast.error('Proxy Start Failed', String(e)))}
              className="text-xs"
            >
              Start Local Proxy
            </Button>
          )
        )}
      </div>

      {/* Coding Agents 1-Click Configs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Claude Code */}
        <div className="double-bezel group hover:border-violet-500/30 transition-all">
          <div className="double-bezel-inner h-full flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <IconBadge icon={<Icon name="terminal" size={17} />} variant="amber" size="md" className="group-hover:scale-105" />
                  <div>
                    <h3 className="text-sm font-bold text-[var(--gc-text)] group-hover:text-accent transition-colors">Claude Code</h3>
                    <div className="text-[11px] text-[var(--gc-text-muted)] font-mono">Terminal CLI Agent</div>
                  </div>
                </div>
                <Badge variant="info">Ollama Provider</Badge>
              </div>
              <p className="text-xs text-[var(--gc-text-muted)] mt-3 leading-relaxed">
                Direct Claude Code CLI to consume your remote Host GPU inference endpoint as its backend model.
              </p>
            </div>

            <div className="mt-4 pt-3 border-t border-[var(--gc-border)] flex flex-col gap-2">
              <div className="bg-[var(--gc-surface-sunken)] border border-[var(--gc-border)] rounded-xl p-2.5 font-mono text-xs text-[var(--gc-text)] flex items-center justify-between">
                <code className="text-accent select-all">export OLLAMA_HOST=http://127.0.0.1:{proxyPort}</code>
                <button
                  onClick={() =>
                    copyToClipboard(
                      `export OLLAMA_HOST=http://127.0.0.1:${proxyPort} && claude --provider ollama`,
                      'claude'
                    )
                  }
                  className="p-1.5 rounded-lg hover:bg-[var(--gc-border)] text-[var(--gc-text-muted)] hover:text-[var(--gc-text)] transition-colors cursor-pointer"
                  title="Copy shell export command"
                >
                  {copiedKey === 'claude' ? <Icon name="check" size={14} className="text-emerald-400" /> : <Icon name="content_copy" size={14} />}
                </button>
              </div>
              <div className="text-[11px] text-[var(--gc-text-muted)]">
                Run <code className="text-[var(--gc-text)] font-mono bg-[var(--gc-surface-sunken)] px-1 rounded">claude --provider ollama --model &lt;model&gt;</code> in your project.
              </div>
            </div>
          </div>
        </div>

        {/* Antigravity / Cursor / Continue */}
        <div className="double-bezel group hover:border-violet-500/30 transition-all">
          <div className="double-bezel-inner h-full flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <IconBadge icon={<Icon name="memory" size={17} />} variant="accent" size="md" className="group-hover:scale-105" />
                  <div>
                    <h3 className="text-sm font-bold text-[var(--gc-text)] group-hover:text-accent transition-colors">Antigravity &amp; Cursor</h3>
                    <div className="text-[11px] text-[var(--gc-text-muted)] font-mono">OpenAI /v1 Compatible</div>
                  </div>
                </div>
                <Badge variant="success">OpenAI /v1</Badge>
              </div>
              <p className="text-xs text-[var(--gc-text-muted)] mt-3 leading-relaxed">
                Configure Cursor or Antigravity to point to the local OpenAI compatibility proxy with streaming completions.
              </p>
            </div>

            <div className="mt-4 pt-3 border-t border-[var(--gc-border)] flex flex-col gap-2">
              <div className="bg-[var(--gc-surface-sunken)] border border-[var(--gc-border)] rounded-xl p-2.5 font-mono text-xs text-[var(--gc-text)] flex items-center justify-between">
                <code className="text-accent select-all">http://127.0.0.1:{proxyPort}/v1</code>
                <button
                  onClick={() => copyToClipboard(`http://127.0.0.1:${proxyPort}/v1`, 'cursor')}
                  className="p-1.5 rounded-lg hover:bg-[var(--gc-border)] text-[var(--gc-text-muted)] hover:text-[var(--gc-text)] transition-colors cursor-pointer"
                  title="Copy Base URL"
                >
                  {copiedKey === 'cursor' ? <Icon name="check" size={14} className="text-emerald-400" /> : <Icon name="content_copy" size={14} />}
                </button>
              </div>
              <div className="text-[11px] text-[var(--gc-text-muted)]">
                Base URL: <code className="text-[var(--gc-text)] font-mono bg-[var(--gc-surface-sunken)] px-1 rounded">http://127.0.0.1:{proxyPort}/v1</code> · API Key: any string
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Web Tool Shortcuts with Encrypted Port Forwarding */}
      <div className="flex flex-col gap-3">
        <div>
          <h3 className="text-base font-bold text-[var(--gc-text)] flex items-center gap-2">
            <Icon name="public" size={18} className="text-accent" />
            <span>Remote Web-UI Shortcuts (Encrypted Port Bridge)</span>
          </h3>
          <p className="text-xs text-muted mt-0.5">
            Click &quot;Launch App&quot; to tunnel into AI workspaces running on your Host PC over Noise-XX encryption.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            { name: 'Open WebUI', port: 3000, desc: 'Chat, model weights & RAG workspace', icon: <Icon name="public" size={18} />, variant: 'blue' as const },
            { name: 'ComfyUI', port: 8188, desc: 'Stable Diffusion node workflows', icon: <Icon name="image" size={18} />, variant: 'rose' as const },
            { name: 'n8n', port: 5678, desc: 'Self-hosted AI agent workflows', icon: <Icon name="bolt" size={18} />, variant: 'amber' as const },
            { name: 'AnythingLLM', port: 3001, desc: 'Full RAG document search workspace', icon: <Icon name="psychology" size={18} />, variant: 'blue' as const },
            { name: 'Dify', port: 3100, desc: 'Visual LLM application & agent platform', icon: <Icon name="widgets" size={18} />, variant: 'amber' as const },
            { name: 'Flowise', port: 3002, desc: 'Drag-and-drop LLM orchestration flows', icon: <Icon name="share" size={18} />, variant: 'accent' as const },
            { name: 'Langflow', port: 7860, desc: 'Multi-agent visual framework', icon: <Icon name="hub" size={18} />, variant: 'accent' as const },
            { name: 'Tabby', port: 8082, desc: 'Self-hosted code assistant web dashboard', icon: <Icon name="code" size={18} />, variant: 'emerald' as const },
            { name: 'Qdrant', port: 6333, desc: 'High-performance vector memory database', path: '/dashboard', icon: <Icon name="database" size={18} />, variant: 'emerald' as const },
          ].map(tool => (
            <div key={tool.name} className="double-bezel group hover:border-violet-500/30 transition-all">
              <div className="double-bezel-inner p-3.5 flex flex-col justify-between h-full bg-[var(--gc-surface)]">
                <div className="flex items-start gap-2.5">
                  <IconBadge icon={tool.icon} variant={tool.variant} size="sm" className="group-hover:scale-105 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold text-[var(--gc-text)] text-sm group-hover:text-accent transition-colors">{tool.name}</div>
                    <div className="text-[11px] text-muted mt-0.5 leading-snug">{tool.desc}</div>
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-4 pt-3 border-t border-[var(--gc-border)]">
                  <Button
                    size="sm"
                    variant="primary"
                    loading={launchingTool === tool.name}
                    onClick={() => handleLaunchWebTool(tool.name, tool.port, tool.path || '/')}
                    className="flex-1 text-xs py-1.5 active:scale-[0.98]"
                  >
                    Launch App
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleCreateDesktopShortcut(tool.name, tool.port, tool.path || '/')}
                    title="Create Desktop Shortcut"
                    className="text-xs text-muted hover:text-[var(--gc-text)] py-1.5"
                  >
                    Shortcut
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Offline Intercept Modal */}
      {showOfflineModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-6 animate-fade-in">
          <div className="w-full max-w-md rounded-2xl bg-[var(--gc-surface)] border border-amber-500/30 p-6 flex flex-col items-center text-center shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 mb-4">
              <Icon name="warning" size={24} />
            </div>
            <h3 className="text-lg font-bold text-[var(--gc-text)]">Vant Server Offline</h3>
            <p className="text-xs text-[var(--gc-text-muted)] mt-2 leading-relaxed">
              Cannot launch <span className="text-[var(--gc-text)] font-semibold">{showOfflineModal}</span> because your laptop is currently disconnected from your Host PC.
            </p>
            <div className="w-full mt-6 flex flex-col gap-2">
              {onNavigatePairing && (
                <Button
                  variant="primary"
                  onClick={() => {
                    setShowOfflineModal(null);
                    onNavigatePairing();
                  }}
                  className="w-full text-xs"
                >
                  Open Network Pairing
                </Button>
              )}
              <Button variant="ghost" onClick={() => setShowOfflineModal(null)} className="w-full text-xs">
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
