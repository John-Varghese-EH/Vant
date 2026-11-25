import React, { useState, useEffect } from 'react';
import { Icon } from './common/Icon';
import { useApiProxy } from '../hooks/useApiProxy';
import { useSettings } from '../hooks/useSettings';
import { Button } from './common/Button';
import { Badge } from './common/Badge';
import { StatusDot } from './common/StatusDot';
import { useToast } from './common/Toast';
import {
  vantListIntegrations,
  vantLaunchIntegration,
  vantListModelAliases,
  vantSetModelAlias,
  vantRemoveModelAlias,
  IntegrationMetadata,
} from '../lib/tauri';

export interface IntegrationsPanelProps {
  selectedModel?: string;
  remoteModels?: string[];
  isConnected?: boolean;
  onNavigatePairing?: () => void;
}

export const IntegrationsPanel: React.FC<IntegrationsPanelProps> = ({
  selectedModel: initialModel,
  remoteModels = [],
  isConnected = true,
  onNavigatePairing,
}) => {
  const toast = useToast();
  const { status, start, stop } = useApiProxy();
  const { settings } = useSettings();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'integrations' | 'aliases' | 'cli'>('integrations');
  const [activeCategory, setActiveCategory] = useState<'all' | 'agent' | 'editor' | 'app'>('all');
  const [shellMode, setShellMode] = useState<'powershell' | 'bash' | 'cmd'>(() => {
    if (typeof navigator !== 'undefined' && /win/i.test(navigator.userAgent || navigator.platform)) {
      return 'powershell';
    }
    return 'bash';
  });

  // Backend integrations & aliases state
  const [backendIntegrations, setBackendIntegrations] = useState<IntegrationMetadata[]>([]);
  const [aliases, setAliases] = useState<Record<string, string>>({});
  const [newAliasKey, setNewAliasKey] = useState('');
  const [newAliasTarget, setNewAliasTarget] = useState('');
  const [selectedModel, setSelectedModel] = useState(initialModel || remoteModels[0] || 'llama3.3');
  const [launchingId, setLaunchingId] = useState<string | null>(null);

  useEffect(() => {
    if (initialModel) {
      setSelectedModel(initialModel);
    } else if (remoteModels.length > 0 && (!selectedModel || !remoteModels.includes(selectedModel))) {
      setSelectedModel(remoteModels[0]);
    }
  }, [initialModel, remoteModels]);

  // Diagnostic test runner state
  const [testState, setTestState] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testResult, setTestResult] = useState<{ status: number; latencyMs: number; modelsCount: number; errorMsg?: string } | null>(null);

  const refreshData = async () => {
    try {
      const [integrationsList, aliasMap] = await Promise.all([
        vantListIntegrations(),
        vantListModelAliases(),
      ]);
      setBackendIntegrations(integrationsList || []);
      setAliases(aliasMap || {});
    } catch (e) {
      console.warn('Failed to load Vant integrations or aliases:', e);
    }
  };

  useEffect(() => {
    refreshData();
  }, []);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleLaunch = async (id: string, configOnly: boolean = false) => {
    setLaunchingId(id);
    try {
      const msg = await vantLaunchIntegration(id, selectedModel, configOnly);
      toast.success(configOnly ? 'Config Injected' : 'Integration Launched', msg);
      refreshData();
    } catch (err: any) {
      toast.error('Launch Failed', typeof err === 'string' ? err : err?.message || 'Unknown error');
    } finally {
      setLaunchingId(null);
    }
  };

  const handleSetAlias = async () => {
    if (!newAliasKey.trim() || !newAliasTarget.trim()) {
      toast.error('Validation Error', 'Alias name and target model cannot be empty.');
      return;
    }
    try {
      await vantSetModelAlias(newAliasKey.trim(), newAliasTarget.trim());
      toast.success('Model Alias Saved', `${newAliasKey.trim()} -> ${newAliasTarget.trim()}`);
      setNewAliasKey('');
      setNewAliasTarget('');
      refreshData();
    } catch (err: any) {
      toast.error('Failed to set alias', typeof err === 'string' ? err : err?.message);
    }
  };

  const handleRemoveAlias = async (alias: string) => {
    try {
      await vantRemoveModelAlias(alias);
      toast.success('Model Alias Removed', `Removed alias: ${alias}`);
      refreshData();
    } catch (err: any) {
      toast.error('Failed to remove alias', typeof err === 'string' ? err : err?.message);
    }
  };

  const handleRunDiagnostic = async () => {
    setTestState('testing');
    const startTime = performance.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const res = await fetch(`http://127.0.0.1:${status.port}/v1/models`, {
        signal: controller.signal,
        headers: settings.api_proxy_key ? { 'Authorization': `Bearer ${settings.api_proxy_key}` } : {}
      });
      clearTimeout(timeoutId);
      const latencyMs = Math.round(performance.now() - startTime);

      if (res.ok) {
        const json = await res.json().catch(() => ({}));
        const count = Array.isArray(json?.data) ? json.data.length : 1;
        setTestResult({ status: res.status, latencyMs, modelsCount: count });
        setTestState('success');
        toast.success('Gateway diagnostic passed', `${count} model(s) ready in ${latencyMs}ms`);
      } else {
        const msg = `HTTP ${res.status} ${res.statusText}`;
        setTestResult({ status: res.status, latencyMs, modelsCount: 0, errorMsg: msg });
        setTestState('error');
        toast.error('Gateway diagnostic failed', msg);
      }
    } catch (e: any) {
      const latencyMs = Math.round(performance.now() - startTime);
      const msg = e?.message || 'Connection refused';
      setTestResult({ status: 0, latencyMs, modelsCount: 0, errorMsg: msg });
      setTestState('error');
      toast.error('Gateway diagnostic failed', msg);
    }
  };

  // Integration card specifications
  const allIntegrations = [
    {
      id: 'claude',
      category: 'agent',
      name: 'Claude Code CLI',
      icon: <Icon name="terminal" size={20} className="text-accent" />,
      description: 'Anthropic terminal coding agent with auto-onboarding bypass and redirect to Vant',
      cliCommand: `vant launch claude --model ${selectedModel}`,
      config: shellMode === 'powershell'
        ? `$env:ANTHROPIC_BASE_URL = "http://localhost:${status.port}"\n$env:ANTHROPIC_AUTH_TOKEN = "vant"\nclaude --model ${selectedModel}`
        : shellMode === 'cmd'
        ? `set ANTHROPIC_BASE_URL=http://localhost:${status.port}\nset ANTHROPIC_AUTH_TOKEN=vant\nclaude --model ${selectedModel}`
        : `export ANTHROPIC_BASE_URL="http://localhost:${status.port}"\nexport ANTHROPIC_AUTH_TOKEN="vant"\nclaude --model ${selectedModel}`,
      instructions: 'Click Launch to auto-configure ~/.claude.json, bypass Anthropic onboarding, and run Claude Code using your remote Host GPU.'
    },
    {
      id: 'codex',
      category: 'agent',
      name: 'OpenAI Codex CLI',
      icon: <Icon name="psychology" size={20} className="text-accent" />,
      description: 'Terminal coding assistant using the OpenAI Responses API',
      cliCommand: `vant launch codex --model ${selectedModel}`,
      config: `[model_providers.vant]\nname = "Vant Local"\nbase_url = "http://localhost:${status.port}"\nwire_api = "responses"`,
      instructions: 'Auto-injects ~/.codex/config.toml with backup restoration and binds to Vant local Responses API.'
    },
    {
      id: 'opencode',
      category: 'agent',
      name: 'OpenCode',
      icon: <Icon name="code" size={20} className="text-accent" />,
      description: 'Terminal AI pair programmer with multi-file and diff capabilities',
      cliCommand: `vant launch opencode --model ${selectedModel}`,
      config: `{ "provider": { "vant": { "options": { "baseURL": "http://localhost:${status.port}" } } } }`,
      instructions: 'Auto-merges ~/.config/opencode/opencode.json with Vant provider config.'
    },
    {
      id: 'droid',
      category: 'agent',
      name: 'Factory Droid',
      icon: <Icon name="precision_manufacturing" size={20} className="text-accent" />,
      description: 'Software development agent for test generation and refactoring',
      cliCommand: `vant launch droid --model ${selectedModel}`,
      config: `{ "custom_models": [{ "model_display_name": "Vant Local", "litellm_provider": "openai" }] }`,
      instructions: 'Auto-injects ~/.factory/config.json with local Vant model provider.'
    },
    {
      id: 'deepseek',
      category: 'agent',
      name: 'DeepSeek Harness',
      icon: <Icon name="memory" size={20} className="text-accent" />,
      description: 'High-performance coding and reasoning test harness for DeepSeek models',
      cliCommand: `vant launch deepseek --model ${selectedModel}`,
      config: `{ "api_url": "http://localhost:${status.port}/v1", "model": "${selectedModel}" }`,
      instructions: 'Auto-injects ~/.deepseek/config.json pointing to Vant local proxy.'
    },
    {
      id: 'hermes',
      category: 'agent',
      name: 'Hermes Agent',
      icon: <Icon name="send" size={20} className="text-accent" />,
      description: 'Function calling and tool use autonomy framework',
      cliCommand: `vant launch hermes --model ${selectedModel}`,
      config: `default_provider: vant\nproviders:\n  vant:\n    base_url: http://localhost:${status.port}/v1`,
      instructions: 'Auto-injects ~/.hermes/config.yaml for function-calling workflows.'
    },
    {
      id: 'openclaw',
      category: 'agent',
      name: 'OpenClaw (Clawdbot)',
      icon: <Icon name="smart_toy" size={20} className="text-accent" />,
      description: 'Autonomous terminal assistant and shell orchestrator',
      cliCommand: `vant launch openclaw --model ${selectedModel}`,
      config: `{ "base_url": "http://localhost:${status.port}/v1", "model": "${selectedModel}" }`,
      instructions: 'Auto-injects ~/.openclaw/openclaw.json and spawns TUI or gateway.'
    },
    {
      id: 'vscode',
      category: 'editor',
      name: 'VS Code',
      icon: <Icon name="computer" size={20} className="text-accent" />,
      description: 'Visual Studio Code settings injection for Continue, Twinny, and Copilot',
      cliCommand: `vant launch vscode --config`,
      config: `{ "twinny.apiUrl": "http://localhost:${status.port}", "continue.apiBase": "http://localhost:${status.port}/v1" }`,
      instructions: 'Auto-injects local endpoint settings into your VS Code user settings.json.'
    },
    {
      id: 'claude-desktop',
      category: 'app',
      name: 'Claude Desktop',
      icon: <Icon name="desktop_windows" size={20} className="text-accent" />,
      description: 'Desktop GUI app for Anthropic Claude with local MCP server support',
      cliCommand: `vant launch claude-desktop --config`,
      config: `{ "mcpServers": { "vant": { "command": "vant", "args": ["serve"] } } }`,
      instructions: 'Auto-injects claude_desktop_config.json with Vant runtime bindings.'
    },
    {
      id: 'chatgpt-desktop',
      category: 'app',
      name: 'ChatGPT Desktop',
      icon: <Icon name="chat" size={20} className="text-accent" />,
      description: 'Desktop companion configured via local Codex proxy profile',
      cliCommand: `vant launch chatgpt-desktop --config`,
      config: `[model_providers.vant]\nbase_url = "http://localhost:${status.port}"\nwire_api = "responses"`,
      instructions: 'Configures local Codex profile so desktop clients route via Vant local Responses API.'
    },
    {
      id: 'cursor',
      category: 'editor',
      name: 'Cursor',
      icon: <Icon name="bolt" size={20} className="text-accent" />,
      description: 'AI-first code editor with inline edits and agent terminal',
      cliCommand: `cursor --openai-base-url http://localhost:${status.port}/v1`,
      config: `{ "openai.apiBase": "http://localhost:${status.port}/v1" }`,
      instructions: 'Open Cursor Settings > Models > OpenAI API Base. Disable "OpenAI API Key" or enter any dummy key.'
    },
    {
      id: 'aider',
      category: 'agent',
      name: 'Aider Pair Programmer',
      icon: <Icon name="build" size={20} className="text-accent" />,
      description: 'Pair programming in git repository with automated atomic commits',
      cliCommand: `aider --openai-api-base http://localhost:${status.port}/v1 --model openai/${selectedModel}`,
      config: `aider --openai-api-base http://localhost:${status.port}/v1 --model openai/${selectedModel}`,
      instructions: 'Run Aider from your project directory with the --openai-api-base parameter.'
    },
  ];

  const filteredIntegrations = activeCategory === 'all'
    ? allIntegrations
    : allIntegrations.filter(i => i.category === activeCategory);

  return (
    <div className="flex flex-col gap-xl" style={{ maxWidth: '1000px', margin: '0 auto' }}>
      
      {/* Header */}
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: 600, letterSpacing: '-0.3px' }}>Vant Local Runtime &amp; Integrations</h2>
          <p className="text-muted" style={{ fontSize: '13px', marginTop: '2px' }}>
            High-performance drop-in Ollama replacement and multi-protocol proxy on <code className="text-mono text-accent">127.0.0.1:{status.port || 11434}</code>.
          </p>
        </div>
        <div className="flex items-center gap-sm">
          <Badge variant={status.running ? 'success' : 'danger'} className="shrink-0">
            {status.running ? `Server Active :${status.port}` : 'Server Stopped'}
          </Badge>
        </div>
      </div>

      {/* Offline Alert Banner */}
      {!isConnected && (
        <div className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/10 flex flex-wrap items-center justify-between gap-3 text-amber-500 text-xs">
          <div className="flex items-center gap-2.5">
            <Icon name="wifi_off" size={16} />
            <span>Host workstation disconnected. Connect over Wi-Fi or Cloudflare Tunnel to stream GPU models to your local integrations.</span>
          </div>
          {onNavigatePairing && (
            <Button size="sm" variant="primary" onClick={onNavigatePairing} className="text-xs shrink-0">
              Connect Workstation
            </Button>
          )}
        </div>
      )}

      {/* Main Server Gateway Card */}
      <div className="card glass-panel flex flex-col gap-md" style={{ padding: '20px' }}>
        <div className="flex justify-between items-center" style={{ borderBottom: '1px solid var(--gc-border)', paddingBottom: '14px' }}>
          <div className="flex items-center gap-sm">
            <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Multi-Protocol Inference Server</h3>
            <StatusDot status={status.running ? 'active' : 'idle'} />
          </div>
          <div className="flex items-center gap-sm">
            <Button 
              variant={status.running ? 'danger' : 'primary'}
              size="sm"
              onClick={status.running ? stop : start}
            >
              {status.running ? 'Stop Vant Serve' : 'Start Vant Serve'}
            </Button>
          </div>
        </div>

        {/* Endpoints & Key Grid */}
        <div className="flex flex-wrap gap-lg" style={{ marginTop: '4px' }}>
          
          <div className="flex flex-col gap-xs" style={{ flex: '1 1 280px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }} className="text-muted">
              Ollama &amp; OpenAI Base URL
            </label>
            <div className="flex gap-sm items-center">
              <code className="text-mono" style={{ background: 'var(--gc-bg)', padding: '7px 12px', borderRadius: 'var(--gc-radius-sm)', flex: 1, fontSize: '13px', border: '1px solid var(--gc-border)' }}>
                {status.endpoint || `http://localhost:${status.port}`}
              </code>
              <Button size="sm" variant="ghost" onClick={() => handleCopy(status.endpoint || `http://localhost:${status.port}`, 'endpoint')}>
                {copiedId === 'endpoint' ? <Icon name="check" size={13} className="text-success" /> : <Icon name="content_copy" size={13} />}
                <span>{copiedId === 'endpoint' ? 'Copied' : 'Copy'}</span>
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-xs" style={{ flex: '1 1 280px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }} className="text-muted">
              Anthropic Messages API
            </label>
            <div className="flex gap-sm items-center">
              <code className="text-mono" style={{ background: 'var(--gc-bg)', padding: '7px 12px', borderRadius: 'var(--gc-radius-sm)', flex: 1, fontSize: '13px', border: '1px solid var(--gc-border)' }}>
                {`http://localhost:${status.port}/v1/messages`}
              </code>
              <Button size="sm" variant="ghost" onClick={() => handleCopy(`http://localhost:${status.port}/v1/messages`, 'anthropic_url')}>
                {copiedId === 'anthropic_url' ? <Icon name="check" size={13} className="text-success" /> : <Icon name="content_copy" size={13} />}
                <span>{copiedId === 'anthropic_url' ? 'Copied' : 'Copy'}</span>
              </Button>
            </div>
          </div>

        </div>

        {/* Live Diagnostic Tester Bar */}
        <div 
          className="flex flex-wrap items-center justify-between gap-sm"
          style={{ 
            background: 'rgba(255, 255, 255, 0.02)', 
            padding: '10px 14px', 
            borderRadius: 'var(--gc-radius-md)',
            border: '1px solid var(--gc-border)',
            marginTop: '4px'
          }}
        >
          <div className="flex items-center gap-sm">
            <button
              onClick={handleRunDiagnostic}
              disabled={testState === 'testing' || !status.running}
              className="btn btn-ghost flex items-center gap-xs cursor-pointer"
              style={{ fontSize: '12px', padding: '4px 10px', background: 'rgba(255, 255, 255, 0.04)' }}
            >
              {testState === 'testing' ? <span className="spinner" /> : <Icon name="play_arrow" size={12} className="text-accent" />}
              <span>{testState === 'testing' ? 'Testing Runtime...' : 'Test Local Runtime'}</span>
            </button>

            {testState === 'success' && testResult && (
              <span className="badge badge-success flex items-center gap-xs" style={{ fontSize: '11px', textTransform: 'none' }}>
                <Icon name="check_circle" size={13} />
                <span>200 OK - {testResult.latencyMs}ms latency - {testResult.modelsCount} model(s) available</span>
              </span>
            )}

            {testState === 'error' && (
              <span className="badge badge-danger flex items-center gap-xs" style={{ fontSize: '11px', textTransform: 'none' }}>
                <Icon name="error" size={13} />
                <span>Diagnostic Failed: {testResult?.errorMsg || 'Connection refused'}</span>
              </span>
            )}

            {testState === 'idle' && (
              <span className="text-muted" style={{ fontSize: '12px' }}>
                Sends a live test request to <code className="text-mono">/v1/models</code> to verify proxy responsiveness.
              </span>
            )}
          </div>

          <span className="text-mono text-muted" style={{ fontSize: '11px' }}>
            Ollama, OpenAI, and Anthropic Wire Compatible
          </span>
        </div>

      </div>

      {/* Main Tab Navigation */}
      <div className="flex items-center gap-md" style={{ borderBottom: '1px solid var(--gc-border)', paddingBottom: '10px' }}>
        <button
          onClick={() => setActiveTab('integrations')}
          className={`cursor-pointer pb-2 font-medium text-sm transition-colors ${activeTab === 'integrations' ? 'text-accent border-b-2 border-accent' : 'text-muted hover:text-[var(--gc-text)]'}`}
        >
          Integrations Catalog ({allIntegrations.length})
        </button>
        <button
          onClick={() => setActiveTab('aliases')}
          className={`cursor-pointer pb-2 font-medium text-sm transition-colors ${activeTab === 'aliases' ? 'text-accent border-b-2 border-accent' : 'text-muted hover:text-[var(--gc-text)]'}`}
        >
          Model Aliases (vant cp) {Object.keys(aliases).length > 0 && `(${Object.keys(aliases).length})`}
        </button>
        <button
          onClick={() => setActiveTab('cli')}
          className={`cursor-pointer pb-2 font-medium text-sm transition-colors ${activeTab === 'cli' ? 'text-accent border-b-2 border-accent' : 'text-muted hover:text-[var(--gc-text)]'}`}
        >
          CLI Quick Reference
        </button>
      </div>

      {/* Tab 1: Integrations Catalog */}
      {activeTab === 'integrations' && (
        <div className="flex flex-col gap-md">
          {/* Controls Bar */}
          <div className="flex flex-wrap items-center justify-between gap-sm">
            <div className="segmented-control">
              <button
                type="button"
                onClick={() => setActiveCategory('all')}
                className={`segmented-item ${activeCategory === 'all' ? 'active' : ''}`}
              >
                All Tools ({allIntegrations.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveCategory('agent')}
                className={`segmented-item ${activeCategory === 'agent' ? 'active' : ''}`}
              >
                Coding Agents
              </button>
              <button
                type="button"
                onClick={() => setActiveCategory('editor')}
                className={`segmented-item ${activeCategory === 'editor' ? 'active' : ''}`}
              >
                Editors
              </button>
              <button
                type="button"
                onClick={() => setActiveCategory('app')}
                className={`segmented-item ${activeCategory === 'app' ? 'active' : ''}`}
              >
                Desktop Apps
              </button>
            </div>

            <div className="flex items-center gap-sm">
              <div className="flex items-center gap-xs">
                <span className="text-muted" style={{ fontSize: '11px' }}>Target Model:</span>
                {remoteModels && remoteModels.length > 0 ? (
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="bg-[var(--gc-surface-sunken)] border border-[var(--gc-border)] rounded-lg px-2.5 py-1 text-xs font-mono text-[var(--gc-text)] outline-none focus:border-accent cursor-pointer"
                  >
                    {remoteModels.map((m) => (
                      <option key={m} value={m} className="bg-[var(--gc-surface)] text-[var(--gc-text)]">
                        {m}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    placeholder="e.g. qwen2.5-coder:32b"
                    className="ghost-input"
                    style={{ width: '160px', padding: '4px 8px', fontSize: '12px' }}
                  />
                )}
              </div>

              <div className="segmented-control">
                <button
                  type="button"
                  onClick={() => setShellMode('powershell')}
                  className={`segmented-item ${shellMode === 'powershell' ? 'active' : ''}`}
                >
                  PowerShell
                </button>
                <button
                  type="button"
                  onClick={() => setShellMode('bash')}
                  className={`segmented-item ${shellMode === 'bash' ? 'active' : ''}`}
                >
                  Bash / Zsh
                </button>
              </div>
            </div>
          </div>

          {/* Cards Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 'var(--gc-space-md)' }}>
            {filteredIntegrations.map((integration) => {
              const backendMeta = backendIntegrations.find(b => b.id === integration.id);
              const isInstalled = backendMeta ? backendMeta.is_installed : false;
              const isLaunchable = ['claude', 'codex', 'opencode', 'droid', 'deepseek', 'hermes', 'openclaw', 'vscode', 'claude-desktop', 'chatgpt-desktop'].includes(integration.id);

              return (
                <div 
                  key={integration.id} 
                  className="card glass-panel flex flex-col"
                  style={{ 
                    transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                    padding: '18px'
                  }}
                >
                  <div className="flex items-center justify-between gap-sm" style={{ marginBottom: 'var(--gc-space-sm)' }}>
                    <div className="flex items-center gap-sm">
                      <div 
                        className="flex items-center justify-center"
                        style={{
                          width: '38px',
                          height: '38px',
                          borderRadius: 'var(--gc-radius-md)',
                          background: 'var(--gc-accent-muted)',
                          border: '1px solid var(--gc-border)'
                        }}
                      >
                        {integration.icon}
                      </div>
                      <div>
                        <div style={{ fontSize: '15px', fontWeight: 600 }}>{integration.name}</div>
                        <div className="text-muted" style={{ fontSize: '12px', lineHeight: 1.3 }}>{integration.description}</div>
                      </div>
                    </div>
                  </div>

                  {backendMeta && (
                    <div className="flex items-center gap-xs" style={{ marginBottom: '8px' }}>
                      <Badge variant={isInstalled ? 'success' : 'neutral'}>
                        {isInstalled ? 'Binary In PATH' : 'Not Detected In PATH'}
                      </Badge>
                      <code className="text-mono text-muted" style={{ fontSize: '10px' }}>
                        vant launch {integration.id}
                      </code>
                    </div>
                  )}
                  
                  <div style={{ 
                    background: 'var(--gc-bg)', 
                    padding: '10px 12px', 
                    borderRadius: 'var(--gc-radius-sm)',
                    marginTop: 'auto',
                    marginBottom: 'var(--gc-space-sm)',
                    border: '1px solid var(--gc-border)',
                    overflowX: 'auto'
                  }}>
                    <pre className="text-mono" style={{ margin: 0, fontSize: '11px', whiteSpace: 'pre-wrap', color: 'var(--gc-text)' }}>
                      {integration.config}
                    </pre>
                  </div>

                  <div className="flex flex-wrap justify-between items-center gap-xs" style={{ marginTop: 'auto', paddingTop: '6px' }}>
                    <button
                      onClick={() => setExpandedId(expandedId === integration.id ? null : integration.id)}
                      style={{ 
                        background: 'none', 
                        border: 'none', 
                        color: 'var(--gc-accent)', 
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontWeight: 500,
                        padding: 0
                      }}
                    >
                      {expandedId === integration.id ? 'Hide Details' : 'Details & Setup'}
                    </button>

                    <div className="flex items-center gap-xs">
                      {isLaunchable && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleLaunch(integration.id, true)}
                            title="Inject configuration file only"
                          >
                            Config Only
                          </Button>
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => handleLaunch(integration.id, false)}
                            disabled={launchingId === integration.id}
                          >
                            {launchingId === integration.id ? 'Launching...' : '1-Click Launch'}
                          </Button>
                        </>
                      )}
                      {!isLaunchable && (
                        <Button 
                          size="sm" 
                          onClick={() => handleCopy(integration.config, integration.id)}
                          className="flex items-center gap-xs"
                        >
                          {copiedId === integration.id ? <Icon name="check" size={13} className="text-success" /> : <Icon name="content_copy" size={13} />}
                          <span>{copiedId === integration.id ? 'Copied' : 'Copy'}</span>
                        </Button>
                      )}
                    </div>
                  </div>

                  {expandedId === integration.id && (
                    <div 
                      className="text-muted" 
                      style={{ 
                        marginTop: 'var(--gc-space-sm)', 
                        paddingTop: 'var(--gc-space-sm)', 
                        borderTop: '1px solid var(--gc-border)',
                        fontSize: '12px',
                        lineHeight: 1.4
                      }}
                    >
                      <p>{integration.instructions}</p>
                      <div className="flex items-center gap-xs" style={{ marginTop: '6px' }}>
                        <span className="text-[11px] text-muted">CLI Command:</span>
                        <code className="text-mono text-accent text-[11px]">{integration.cliCommand}</code>
                        <button
                          onClick={() => handleCopy(integration.cliCommand, `cli_${integration.id}`)}
                          className="cursor-pointer text-muted hover:text-white"
                          title="Copy CLI command"
                        >
                          {copiedId === `cli_${integration.id}` ? <Icon name="check" size={12} className="text-success" /> : <Icon name="content_copy" size={12} />}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab 2: Model Aliases Manager */}
      {activeTab === 'aliases' && (
        <div className="flex flex-col gap-md">
          <div className="card glass-panel flex flex-col gap-md" style={{ padding: '20px' }}>
            <div>
              <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Create Model Alias (`vant cp`)</h3>
              <p className="text-muted" style={{ fontSize: '13px', marginTop: '2px' }}>
                Tools like Claude Code or Codex validate hardcoded prefixes (e.g., <code className="text-mono">claude-</code> or <code className="text-mono">gpt-</code>). Map incoming model aliases to the real model running on your Host PC.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-sm">
              <input
                type="text"
                placeholder="Alias name (e.g. claude-3-5-sonnet)"
                value={newAliasKey}
                onChange={(e) => setNewAliasKey(e.target.value)}
                className="ghost-input"
                style={{ flex: '1 1 200px' }}
              />
              <span className="text-muted font-bold">-&gt;</span>
              <input
                type="text"
                placeholder="Target model (e.g. qwen2.5-coder:32b)"
                value={newAliasTarget}
                onChange={(e) => setNewAliasTarget(e.target.value)}
                className="ghost-input"
                style={{ flex: '1 1 200px' }}
              />
              <Button variant="primary" onClick={handleSetAlias}>
                Save Alias
              </Button>
            </div>

            {/* Presets */}
            <div className="flex flex-wrap items-center gap-xs pt-1">
              <span className="text-xs text-muted">Quick Presets:</span>
              <button
                onClick={() => { setNewAliasKey('claude-3-5-sonnet'); setNewAliasTarget('qwen2.5-coder:32b'); }}
                className="btn btn-ghost text-xs px-2 py-1 rounded bg-[var(--gc-surface)] border border-[var(--gc-border)] cursor-pointer"
              >
                Claude 3.5 Sonnet -&gt; Qwen2.5 Coder
              </button>
              <button
                onClick={() => { setNewAliasKey('gpt-4o'); setNewAliasTarget('llama3.3'); }}
                className="btn btn-ghost text-xs px-2 py-1 rounded bg-[var(--gc-surface)] border border-[var(--gc-border)] cursor-pointer"
              >
                GPT-4o -&gt; Llama 3.3
              </button>
              <button
                onClick={() => { setNewAliasKey('claude-3-opus'); setNewAliasTarget('deepseek-r1:32b'); }}
                className="btn btn-ghost text-xs px-2 py-1 rounded bg-[var(--gc-surface)] border border-[var(--gc-border)] cursor-pointer"
              >
                Claude 3 Opus -&gt; DeepSeek R1
              </button>
            </div>
          </div>

          {/* Active Aliases Table */}
          <div className="card glass-panel" style={{ padding: '20px' }}>
            <h4 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '12px' }}>Active Model Aliases</h4>
            {Object.keys(aliases).length === 0 ? (
              <p className="text-muted text-sm">No custom model aliases configured yet. Requests will resolve models directly.</p>
            ) : (
              <div className="flex flex-col gap-sm">
                {Object.entries(aliases).map(([alias, target]) => (
                  <div
                    key={alias}
                    className="flex items-center justify-between p-3 rounded-lg border border-[var(--gc-border)] bg-[var(--gc-surface)]"
                  >
                    <div className="flex items-center gap-sm">
                      <span className="font-mono text-sm font-semibold text-accent">{alias}</span>
                      <span className="text-muted text-xs">-&gt;</span>
                      <span className="font-mono text-sm text-[var(--gc-text)]">{target}</span>
                    </div>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => handleRemoveAlias(alias)}
                      className="text-xs"
                    >
                      Delete
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 3: CLI Quick Reference */}
      {activeTab === 'cli' && (
        <div className="flex flex-col gap-md">
          <div className="card glass-panel" style={{ padding: '20px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '6px' }}>Vant Command-Line Interface (CLI)</h3>
            <p className="text-muted text-sm mb-4">
              Vant is a unified binary. Run commands directly from your terminal or script automated pipelines.
            </p>

            <div className="flex flex-col gap-md">
              <div className="p-3 rounded-lg border border-[var(--gc-border)] bg-[var(--gc-surface)]">
                <div className="flex items-center justify-between">
                  <code className="text-mono font-bold text-accent">vant serve</code>
                  <Badge variant="info">Server</Badge>
                </div>
                <p className="text-xs text-muted mt-1">Start local HTTP inference server on 127.0.0.1:11434 (configurable via VANT_HOST).</p>
              </div>

              <div className="p-3 rounded-lg border border-[var(--gc-border)] bg-[var(--gc-surface)]">
                <div className="flex items-center justify-between">
                  <code className="text-mono font-bold text-accent">vant run &lt;model&gt; [--launch &lt;tool&gt;]</code>
                  <Badge variant="info">Inference &amp; Agent</Badge>
                </div>
                <p className="text-xs text-muted mt-1">Run an interactive REPL session, or immediately launch a coding agent bound to the model.</p>
              </div>

              <div className="p-3 rounded-lg border border-[var(--gc-border)] bg-[var(--gc-surface)]">
                <div className="flex items-center justify-between">
                  <code className="text-mono font-bold text-accent">vant launch [tool] [--model &lt;m&gt;] [--config] [--yes]</code>
                  <Badge variant="info">Auto-Config</Badge>
                </div>
                <p className="text-xs text-muted mt-1">Auto-configure and launch Claude Code, Codex, OpenCode, VS Code, and other integrations.</p>
              </div>

              <div className="p-3 rounded-lg border border-[var(--gc-border)] bg-[var(--gc-surface)]">
                <div className="flex items-center justify-between">
                  <code className="text-mono font-bold text-accent">vant cp &lt;source_model&gt; &lt;alias&gt;</code>
                  <Badge variant="info">Alias</Badge>
                </div>
                <p className="text-xs text-muted mt-1">Create aliases (e.g. `vant cp qwen2.5-coder:32b claude-3-5-sonnet`) so prefix-strict tools work seamlessly.</p>
              </div>

              <div className="p-3 rounded-lg border border-[var(--gc-border)] bg-[var(--gc-surface)]">
                <div className="flex items-center justify-between">
                  <code className="text-mono font-bold text-accent">vant ls / vant pull &lt;model&gt; / vant rm &lt;model&gt;</code>
                  <Badge variant="info">Lifecycle</Badge>
                </div>
                <p className="text-xs text-muted mt-1">Manage models remotely over the encrypted tunnel.</p>
              </div>

              <div className="p-3 rounded-lg border border-[var(--gc-border)] bg-[var(--gc-surface)]">
                <div className="flex items-center justify-between">
                  <code className="text-mono font-bold text-accent">vant ps / vant stop &lt;model&gt;</code>
                  <Badge variant="info">Resource Monitor</Badge>
                </div>
                <p className="text-xs text-muted mt-1">Inspect active models in Host GPU VRAM and unload them on demand.</p>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
