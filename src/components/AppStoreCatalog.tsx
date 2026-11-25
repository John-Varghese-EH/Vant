import React, { useState, useEffect, useMemo } from 'react';
import { Icon } from './common/Icon';
import {
  listRecipes,
  getServiceStates,
  installAndRunService,
  stopService,
  refreshServiceStatus,
  getServiceLogs,
  getDockerStatus,
  detectGpuHardware,
  ServiceRecipe,
  ServiceState,
  DockerStatus,
  GpuInfo,
  ToolCategory
} from '../lib/tauri';
import { Badge } from './common/Badge';
import { Button } from './common/Button';
import { IconBadge } from './common/IconBadge';
import { useToast } from './common/Toast';

const getToolIconMeta = (recipeId: string, _category?: ToolCategory) => {
  switch (recipeId) {
    case 'ollama':
      return { icon: <Icon name="memory" size={20} />, variant: 'accent' as const };
    case 'lm-studio':
      return { icon: <Icon name="layers" size={20} />, variant: 'accent' as const };
    case 'jan':
      return { icon: <Icon name="chat" size={20} />, variant: 'accent' as const };
    case 'open-webui':
      return { icon: <Icon name="public" size={20} />, variant: 'blue' as const };
    case 'anythingllm':
      return { icon: <Icon name="psychology" size={20} />, variant: 'blue' as const };
    case 'comfyui':
      return { icon: <Icon name="image" size={20} />, variant: 'rose' as const };
    case 'whisper':
      return { icon: <Icon name="mic" size={20} />, variant: 'rose' as const };
    case 'n8n':
      return { icon: <Icon name="bolt" size={20} />, variant: 'amber' as const };
    case 'dify':
      return { icon: <Icon name="widgets" size={20} />, variant: 'amber' as const };
    case 'activepieces':
      return { icon: <Icon name="extension" size={20} />, variant: 'amber' as const };
    case 'flowise':
      return { icon: <Icon name="share" size={20} />, variant: 'amber' as const };
    case 'langflow':
      return { icon: <Icon name="hub" size={20} />, variant: 'amber' as const };
    case 'open-interpreter':
      return { icon: <Icon name="terminal" size={20} />, variant: 'amber' as const };
    case 'tabby':
      return { icon: <Icon name="code" size={20} />, variant: 'emerald' as const };
    case 'twinny':
      return { icon: <Icon name="description" size={20} />, variant: 'emerald' as const };
    case 'qdrant':
      return { icon: <Icon name="database" size={20} />, variant: 'emerald' as const };
    default:
      return { icon: <Icon name="memory" size={20} />, variant: 'neutral' as const };
  }
};

const CATEGORIES: { id: ToolCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'All 16 Tools' },
  { id: 'llm_engine', label: 'LLM Engines' },
  { id: 'ai_chat', label: 'AI Chat & RAG' },
  { id: 'media_generation', label: 'Media & Voice' },
  { id: 'workflow_automation', label: 'Workflows & Agents' },
  { id: 'coding_assistant', label: 'Coding & Vector DBs' },
];

export const AppStoreCatalog: React.FC = () => {
  const toast = useToast();
  const [recipes, setRecipes] = useState<ServiceRecipe[]>([]);
  const [states, setStates] = useState<Record<string, ServiceState>>({});
  const [dockerStatus, setDockerStatus] = useState<DockerStatus | null>(null);
  const [gpuInfo, setGpuInfo] = useState<GpuInfo | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<ToolCategory | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [selectedLogs, setSelectedLogs] = useState<{ id: string; name: string; content: string } | null>(null);

  const loadData = async () => {
    try {
      const [r, s, d, g] = await Promise.all([
        listRecipes(),
        getServiceStates(),
        getDockerStatus().catch(() => null),
        detectGpuHardware().catch(() => null),
      ]);
      if (Array.isArray(r)) setRecipes(r);
      if (Array.isArray(s)) {
        const stateMap: Record<string, ServiceState> = {};
        s.forEach(item => {
          stateMap[item.recipe_id] = item;
        });
        setStates(stateMap);
      }
      if (d) setDockerStatus(d);
      if (g) setGpuInfo(g);
    } catch (e) {
      console.error('Failed to load catalog data:', e);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleInstallAndRun = async (recipe: ServiceRecipe) => {
    if (recipe.deployment !== 'native_binary' && dockerStatus && !dockerStatus.running) {
      toast.warning(
        'Docker Daemon Required',
        `${recipe.name} runs inside an isolated container. Start Docker Desktop / Docker Engine first, then click Launch.`
      );
      return;
    }

    setLoadingAction(recipe.id);
    try {
      await installAndRunService(recipe.id);
      await refreshServiceStatus(recipe.id);
      await loadData();
      toast.success(`${recipe.name} Started`, `Running cleanly on port :${recipe.ports[0]?.host_port || 'auto'}`);
    } catch (e: any) {
      toast.error(`Failed to launch ${recipe.name}`, typeof e === 'string' ? e : e?.message || 'Execution error');
      await refreshServiceStatus(recipe.id).catch(() => {});
      await loadData();
    } finally {
      setLoadingAction(null);
    }
  };

  const handleStop = async (recipe: ServiceRecipe) => {
    setLoadingAction(recipe.id);
    try {
      await stopService(recipe.id);
      await refreshServiceStatus(recipe.id);
      await loadData();
      toast.info(`${recipe.name} Stopped`, 'Container or service cleanly halted.');
    } catch (e: any) {
      toast.error(`Failed to stop ${recipe.name}`, typeof e === 'string' ? e : e?.message || 'Stop failed');
    } finally {
      setLoadingAction(null);
    }
  };

  const handleViewLogs = async (recipe: ServiceRecipe) => {
    try {
      const logs = await getServiceLogs(recipe.id, 150);
      setSelectedLogs({
        id: recipe.id,
        name: recipe.name,
        content: logs || 'No logs recorded yet.',
      });
    } catch (e: any) {
      toast.error('Unable to fetch logs', typeof e === 'string' ? e : e?.message || 'Log retrieval failed');
    }
  };

  const filteredRecipes = useMemo(() => {
    return recipes.filter(r => {
      const matchesCat = selectedCategory === 'all' || r.category === selectedCategory;
      const matchesSearch =
        searchQuery === '' ||
        r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.id.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCat && matchesSearch;
    });
  }, [recipes, selectedCategory, searchQuery]);

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-4 border-b border-[var(--gc-border)]">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-bold tracking-tight text-[var(--gc-text)] flex items-center gap-2">
              <span>One-Click AI App Store</span>
            </h2>
            <span
              className="text-[10px] font-mono px-2.5 py-0.5 rounded-[var(--gc-squircle-badge)] bg-violet-500/20 text-accent border border-violet-500/30 uppercase tracking-widest font-semibold whitespace-nowrap shrink-0"
              style={{ borderRadius: 'var(--gc-squircle-badge)' }}
            >
              16 Verified Recipes
            </span>
          </div>
          <p className="text-xs text-[var(--gc-text-muted)] mt-1">
            Deploy local inference engines, AI agents, and workflows directly to your host GPU with automatic tunneling.
          </p>
        </div>

        {/* Search & Actions */}
        <div className="flex items-center gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Icon name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--gc-text-muted)]" />
            <input
              type="text"
              placeholder="Search tools & engines..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg bg-[var(--gc-surface-sunken)] border border-[var(--gc-border)] text-[var(--gc-text)] placeholder:text-[var(--gc-text-muted)] focus:outline-none focus:border-violet-500 transition-colors"
            />
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={loadData}
            className="flex items-center gap-1.5 text-xs text-[var(--gc-text-muted)] hover:text-[var(--gc-text)] shrink-0"
          >
            <Icon name="refresh" size={13} />
            <span>Refresh</span>
          </Button>
        </div>
      </div>

      {/* Live Environment Readiness Strip (Docker + GPU Hardware) */}
      {(dockerStatus || gpuInfo) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {dockerStatus && (
            <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-[var(--gc-surface)] border border-[var(--gc-border)]">
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                    dockerStatus.running
                      ? 'bg-emerald-500/15 text-emerald-500'
                      : 'bg-amber-500/15 text-amber-500'
                  }`}
                >
                  <Icon name="widgets" size={15} />
                </div>
                <div>
                  <div className="text-xs font-semibold text-[var(--gc-text)]">Docker Container Engine</div>
                  <div className="text-[11px] text-[var(--gc-text-muted)]">
                    {dockerStatus.running
                      ? `Running (v${dockerStatus.version || 'ready'})`
                      : dockerStatus.installed
                      ? 'Installed but paused - start Docker for container apps'
                      : 'Not installed (Bare-metal apps like Ollama still work)'}
                  </div>
                </div>
              </div>
              <Badge variant={dockerStatus.running ? 'success' : 'warning'}>
                {dockerStatus.running ? 'Ready' : dockerStatus.installed ? 'Stopped' : 'Missing'}
              </Badge>
            </div>
          )}

          {gpuInfo && (
            <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-[var(--gc-surface)] border border-[var(--gc-border)]">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-violet-500/15 text-accent flex items-center justify-center shrink-0">
                  <Icon name="memory" size={15} />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[var(--gc-text)] truncate">{gpuInfo.name}</div>
                  <div className="text-[11px] text-[var(--gc-text-muted)] truncate">
                    {gpuInfo.vram_mb > 0
                      ? `${(gpuInfo.vram_mb / 1024).toFixed(1)} GB VRAM · ${gpuInfo.vendor.toUpperCase()}`
                      : 'Unified / CPU execution mode'}
                    {gpuInfo.nvidia_docker ? ' · NVIDIA Docker Ready' : ''}
                  </div>
                </div>
              </div>
              <Badge variant={gpuInfo.vendor !== 'none' ? 'info' : 'neutral'}>
                {gpuInfo.vendor !== 'none' ? gpuInfo.vendor.toUpperCase() : 'CPU'}
              </Badge>
            </div>
          )}
        </div>
      )}

      {/* Category Pills */}
      <div className="flex flex-wrap items-center gap-1.5 bg-[var(--gc-surface-sunken)] p-1.5 rounded-2xl border border-[var(--gc-border)] w-fit">
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            onClick={() => setSelectedCategory(cat.id)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer ease-[cubic-bezier(0.32,0.72,0,1)] ${
              selectedCategory === cat.id
                ? 'bg-violet-600 text-white shadow-md shadow-violet-600/30 scale-[1.02]'
                : 'text-[var(--gc-text-muted)] hover:text-[var(--gc-text)] hover:bg-[var(--gc-border)]'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Grid of Tools */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredRecipes.map(recipe => {
          const state = states[recipe.id];
          const isRunning = state?.status === 'running';
          const isStarting = state?.status === 'starting';
          const isError = state?.status === 'error';
          const isLoading = loadingAction === recipe.id;

          const primaryPort = recipe.ports[0]?.host_port;

          return (
            <div
              key={recipe.id}
              className={`double-bezel group transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 ${
                isRunning
                  ? 'border-violet-500/40 shadow-[0_0_24px_rgba(139,92,246,0.15)]'
                  : 'border-[var(--gc-border)] hover:border-violet-500/30'
              }`}
            >
              <div className="double-bezel-inner h-full flex flex-col justify-between p-4.5 bg-[var(--gc-surface)]">
                <div>
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      {(() => {
                        const meta = getToolIconMeta(recipe.id, recipe.category);
                        return (
                          <IconBadge
                            icon={meta.icon}
                            variant={meta.variant}
                            size="md"
                            glow={isRunning}
                            className="group-hover:scale-105"
                          />
                        );
                      })()}
                      <div>
                        <h3 className="text-sm font-bold text-[var(--gc-text)] group-hover:text-accent transition-colors tracking-tight">
                          {recipe.name}
                        </h3>
                        <div className="text-[11px] text-[var(--gc-text-muted)] font-mono mt-0.5 capitalize flex items-center gap-1.5">
                          <span>{recipe.deployment.replace('_', ' ')}</span>
                          {recipe.deployment === 'native_binary' && (
                            <span
                              className="text-[9px] px-1.5 py-0.5 rounded-[var(--gc-squircle-sm)] bg-violet-500/20 text-accent border border-violet-500/30 uppercase font-semibold whitespace-nowrap shrink-0"
                              style={{ borderRadius: 'var(--gc-squircle-sm)' }}
                            >
                              Bare Metal
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <Badge
                      variant={
                        isRunning ? 'success' : isStarting ? 'warning' : isError ? 'danger' : 'neutral'
                      }
                    >
                      {isRunning ? 'Running' : isStarting ? 'Starting' : isError ? 'Error' : 'Ready'}
                    </Badge>
                  </div>

                  {/* Description */}
                  <p className="text-xs text-[var(--gc-text-muted)] mt-3 line-clamp-2 leading-relaxed">
                    {recipe.description}
                  </p>

                  {isError && state?.error_message && (
                    <div className="mt-2.5 p-2 rounded-lg bg-rose-500/10 border border-rose-500/25 text-[11px] text-rose-400 line-clamp-2">
                      {state.error_message}
                    </div>
                  )}

                  {/* Specs */}
                  <div className="flex flex-wrap items-center gap-1.5 mt-3 text-[10px] text-[var(--gc-text-muted)] font-mono">
                    {primaryPort && (
                      <span className="px-2 py-0.5 rounded-md bg-[var(--gc-surface-sunken)] border border-[var(--gc-border)] text-[var(--gc-text)]">
                        :{primaryPort}
                      </span>
                    )}
                    {recipe.gpu.required && (
                      <span className="px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-500 border border-amber-500/20 flex items-center gap-1 font-semibold">
                        <Icon name="memory" size={11} /> {recipe.gpu.recommended_vram_mb / 1024}GB VRAM
                      </span>
                    )}
                    {recipe.web_ui && (
                      <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 font-semibold flex items-center gap-1">
                        <Icon name="public" size={11} /> Web UI
                      </span>
                    )}
                  </div>
                </div>

                {/* Bottom Actions */}
                <div className="flex items-center justify-between gap-2 mt-4 pt-3.5 border-t border-[var(--gc-border)]">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleViewLogs(recipe)}
                      title="View Container / Engine Logs"
                      className="p-1.5 rounded-lg hover:bg-[var(--gc-border)] text-[var(--gc-text-muted)] hover:text-[var(--gc-text)] transition-colors cursor-pointer"
                    >
                      <Icon name="terminal" size={14} />
                    </button>
                    {recipe.web_ui && isRunning && primaryPort && (
                      <a
                        href={`http://localhost:${primaryPort}${recipe.web_ui_path || ''}`}
                        target="_blank"
                        rel="noreferrer"
                        title="Open Web Dashboard"
                        className="p-1.5 rounded-lg hover:bg-[var(--gc-border)] text-[var(--gc-text-muted)] hover:text-accent transition-colors cursor-pointer"
                      >
                        <Icon name="open_in_new" size={14} />
                      </a>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {isRunning ? (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => handleStop(recipe)}
                        disabled={isLoading}
                        className="flex items-center gap-1.5 text-xs px-3.5 py-1.5 rounded-lg active:scale-[0.98]"
                      >
                        {isLoading ? <Icon name="refresh" size={12} className="animate-spin" /> : <Icon name="stop" size={12} />}
                        Stop
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => handleInstallAndRun(recipe)}
                        disabled={isLoading}
                        className="flex items-center gap-1.5 text-xs px-3.5 py-1.5 rounded-lg active:scale-[0.98]"
                      >
                        {isLoading ? <Icon name="refresh" size={12} className="animate-spin" /> : <Icon name="play_arrow" size={12} />}
                        Launch
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filteredRecipes.length === 0 && (
        <div className="double-bezel">
          <div className="double-bezel-inner py-16 text-center text-muted">
            <p className="text-sm">No tools matching your search criteria.</p>
            <button
              onClick={() => {
                setSelectedCategory('all');
                setSearchQuery('');
              }}
              className="mt-3 text-xs text-accent underline cursor-pointer"
            >
              Clear filters
            </button>
          </div>
        </div>
      )}

      {/* Logs Drawer Modal */}
      {selectedLogs && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-6 animate-fade-in">
          <div className="double-bezel w-full max-w-3xl h-[600px] shadow-2xl">
            <div className="double-bezel-inner h-full flex flex-col p-0 overflow-hidden bg-[var(--gc-surface)]">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--gc-border)]">
                <div className="flex items-center gap-2">
                  <Icon name="terminal" size={18} className="text-accent" />
                  <h3 className="font-semibold text-[var(--gc-text)] text-sm">
                    Console Logs: <span className="text-accent font-mono">{selectedLogs.name}</span>
                  </h3>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setSelectedLogs(null)}>
                  Close
                </Button>
              </div>
              <div className="flex-1 p-5 overflow-y-auto font-mono text-xs text-[var(--gc-text)] whitespace-pre-wrap leading-relaxed select-text bg-[var(--gc-surface-sunken)]">
                {selectedLogs.content}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
