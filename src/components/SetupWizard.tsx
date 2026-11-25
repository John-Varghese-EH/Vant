import React, { useState, useEffect } from 'react';
import { Icon } from './common/Icon';
import { Button } from './common/Button';
import { PairingPanel } from './PairingPanel';
import { useOllama } from '../hooks/useOllama';
import { useHosting } from '../hooks/useHosting';
import { StatusDot } from './common/StatusDot';
import { ThemeToggle } from './common/ThemeToggle';
import { Logo } from './common/Logo';
import { IconBadge } from './common/IconBadge';
import { useToast } from './common/Toast';
import { detectGpuHardware, getDockerStatus, DockerStatus, GpuInfo } from '../lib/tauri';

export interface SetupWizardProps {
  onComplete: (role: 'host' | 'client') => void;
}

export const SetupWizard: React.FC<SetupWizardProps> = ({ onComplete }) => {
  const toast = useToast();
  const [step, setStep] = useState(1);
  const [role, setRole] = useState<'host' | 'client' | null>(null);
  const [gpuInfo, setGpuInfo] = useState<GpuInfo | null>(null);
  const [dockerStatus, setDockerStatus] = useState<DockerStatus | null>(null);
  const [showHardwareDetails, setShowHardwareDetails] = useState(false);

  const { status, models, pullModel, startEngine, isStarting, ollamaError, pullProgress, isPulling, refresh } = useOllama();
  const { startHosting, hostingError } = useHosting();

  useEffect(() => {
    detectGpuHardware().then(setGpuInfo).catch(() => {});
    getDockerStatus().then(setDockerStatus).catch(() => {});
  }, []);

  useEffect(() => {
    if (step >= 2 && role === 'host') {
      startHosting().catch(err => {
        toast.error('Host Server Warning', typeof err === 'string' ? err : err?.message);
      });
    }
  }, [step, role, startHosting, toast]);

  const handleNext = () => {
    if (step === 1 && role) {
      setStep(2);
    } else if (step === 2) {
      if (role === 'host') {
        setStep(3);
      } else {
        onComplete('client');
      }
    } else if (step === 3) {
      onComplete('host');
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
    }
  };

  const stepTitles = [
    'Select Mode',
    role === 'host' ? 'Host Broadcast & Pairing' : 'Connect to Host',
    'Local Inference Engine',
  ];

  const totalSteps = role === 'host' ? 3 : 2;

  return (
    <div className="w-full h-screen overflow-y-auto overflow-x-hidden flex flex-col items-center bg-[var(--gc-bg)] relative select-none">
      {/* Top right theme toggle */}
      <div className="fixed top-5 right-5 z-20">
        <ThemeToggle size="md" />
      </div>

      {/* Background ambient radial lights */}
      <div className="fixed top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-violet-600/12 blur-[140px] pointer-events-none rounded-full" />
      <div className="fixed bottom-12 right-12 w-[320px] h-[260px] bg-indigo-600/6 blur-[110px] pointer-events-none rounded-full" />

      <div className="w-full max-w-[660px] relative z-10 flex flex-col my-auto py-10 px-5 shrink-0">
        {/* Clean Editorial Header */}
        <div className="mb-8 text-center flex flex-col items-center">
          <div className="mb-4">
            <Logo size={54} />
          </div>

          <h1
            className="text-[28px] font-semibold tracking-[-0.03em] text-[var(--gc-text)]"
            style={{ lineHeight: 1.15 }}
          >
            Welcome to Vant
          </h1>
          <p className="text-[var(--gc-text-muted)] text-[13.5px] mt-1.5 max-w-md mx-auto leading-relaxed">
            Private, encrypted GPU compute sharing between your workstation and portable laptop.
          </p>

          {/* Minimal Stepper */}
          <div className="flex flex-col items-center gap-2 mt-6 w-full max-w-[260px]">
            <div className="flex justify-between items-center w-full text-[11px] font-medium text-[var(--gc-text-muted)]">
              <span className="tabular-nums">Step {step} of {totalSteps}</span>
              <span className="text-[var(--gc-text)]">{stepTitles[step - 1]}</span>
            </div>
            <div className="flex items-center gap-1.5 w-full">
              {Array.from({ length: totalSteps }).map((_, idx) => (
                <span
                  key={idx}
                  className={`h-[3px] rounded-full transition-all duration-300 flex-1 ${
                    step >= idx + 1 ? 'bg-violet-500 shadow-[0_0_10px_rgba(139,92,246,0.5)]' : 'bg-[var(--gc-border)]'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>

        {hostingError && step >= 2 && role === 'host' && (
          <div
            className="mb-4 px-4 py-3 rounded-xl border text-[12.5px] text-danger flex items-center gap-2"
            style={{ background: 'var(--gc-danger-muted)', borderColor: 'rgba(239, 68, 68, 0.3)' }}
          >
            <Icon name="warning" size={16} className="shrink-0" />
            <span>{hostingError}</span>
          </div>
        )}

        {/* Wizard Step Body */}
        <div className="flex flex-col justify-center">
          {/* STEP 1: Double-Bezel Depth & Glow Mode Selection */}
          {step === 1 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-fade-in">
              {/* Host Node Card */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => setRole('host')}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setRole('host'); } }}
                className={`double-bezel cursor-pointer transition-all duration-300 group ${
                  role === 'host'
                    ? 'border-violet-500/60 shadow-[0_0_28px_rgba(139,92,246,0.24)]'
                    : 'hover:border-violet-500/35'
                }`}
              >
                <div
                  className={`double-bezel-inner h-full flex flex-col justify-between gap-4 transition-colors ${
                    role === 'host' ? 'bg-[var(--gc-accent-muted)]' : 'bg-[var(--gc-surface)]'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between mb-4">
                      <IconBadge
                        icon={<Icon name="dns" size={22} />}
                        variant={role === 'host' ? 'accent' : 'neutral'}
                        size="lg"
                        glow={role === 'host'}
                        className="group-hover:scale-105"
                      />
                      <div
                        className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                          role === 'host'
                            ? 'bg-violet-600 border-violet-500 shadow-[0_0_12px_rgba(139,92,246,0.5)]'
                            : 'border-[var(--gc-border-light)] bg-transparent'
                        }`}
                      >
                        {role === 'host' && <Icon name="check" size={14} className="text-white font-bold" />}
                      </div>
                    </div>

                    <h3 className="text-[16px] font-semibold text-[var(--gc-text)] tracking-[-0.015em]">
                      Server Mode (Host)
                    </h3>
                    <p className="text-[var(--gc-text-muted)] text-[12.5px] leading-relaxed mt-1.5">
                      Share this GPU workstation or gaming laptop to run local LLMs, media tools, and AI containers.
                    </p>
                  </div>

                  <div
                    className="pt-3 border-t text-[11.5px] text-[var(--gc-text-muted)] flex items-center justify-between"
                    style={{ borderColor: 'var(--gc-border)' }}
                  >
                    <span>GPU Acceleration · Tunnel · RBAC</span>
                    <Icon name="chevron_right" size={14} className={role === 'host' ? 'text-accent' : 'text-dim'} />
                  </div>
                </div>
              </div>

              {/* Client Node Card */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => setRole('client')}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setRole('client'); } }}
                className={`double-bezel cursor-pointer transition-all duration-300 group ${
                  role === 'client'
                    ? 'border-violet-500/60 shadow-[0_0_28px_rgba(139,92,246,0.24)]'
                    : 'hover:border-violet-500/35'
                }`}
              >
                <div
                  className={`double-bezel-inner h-full flex flex-col justify-between gap-4 transition-colors ${
                    role === 'client' ? 'bg-[var(--gc-accent-muted)]' : 'bg-[var(--gc-surface)]'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between mb-4">
                      <IconBadge
                        icon={<Icon name="laptop_mac" size={22} />}
                        variant={role === 'client' ? 'blue' : 'neutral'}
                        size="lg"
                        glow={role === 'client'}
                        className="group-hover:scale-105"
                      />
                      <div
                        className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                          role === 'client'
                            ? 'bg-violet-600 border-violet-500 shadow-[0_0_12px_rgba(139,92,246,0.5)]'
                            : 'border-[var(--gc-border-light)] bg-transparent'
                        }`}
                      >
                        {role === 'client' && <Icon name="check" size={14} className="text-white font-bold" />}
                      </div>
                    </div>

                    <h3 className="text-[16px] font-semibold text-[var(--gc-text)] tracking-[-0.015em]">
                      Client Mode (Consumer)
                    </h3>
                    <p className="text-[var(--gc-text-muted)] text-[12.5px] leading-relaxed mt-1.5">
                      Connect a lightweight laptop to run chat, Cursor, and Claude Code on your remote GPU node.
                    </p>
                  </div>

                  <div
                    className="pt-3 border-t text-[11.5px] text-[var(--gc-text-muted)] flex items-center justify-between"
                    style={{ borderColor: 'var(--gc-border)' }}
                  >
                    <span>Local :11434 Proxy · IDE Bridge</span>
                    <Icon name="chevron_right" size={14} className={role === 'client' ? 'text-accent' : 'text-dim'} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Network & Pairing */}
          {step === 2 && (
            <div className="w-full animate-fade-in">
              <PairingPanel mode={role!} />
            </div>
          )}

          {/* STEP 3: Models & Launch (Host Only) */}
          {step === 3 && role === 'host' && (
            <div
              className="w-full flex flex-col gap-5 p-6 animate-fade-in border rounded-2xl"
              style={{ background: 'var(--gc-surface)', borderColor: 'var(--gc-border)', boxShadow: 'var(--gc-shadow-sm)' }}
            >
              <div className="flex flex-wrap justify-between items-center gap-3 pb-3 border-b border-[var(--gc-border)]">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-semibold text-[var(--gc-text)] tracking-tight">Ollama Engine</span>
                  <span className="text-[11.5px] text-[var(--gc-text-muted)] font-mono">Local Runtime</span>
                </div>
                <div className="flex items-center gap-2.5">
                  {status === 'Stopped' && (
                    <Button
                      size="sm"
                      variant="primary"
                      loading={isStarting}
                      onClick={() =>
                        startEngine()
                          .then(() => toast.success('Ollama Started', 'Inference engine is now online.'))
                          .catch(e => toast.error('Failed to Start Ollama', String(e)))
                      }
                      className="text-xs"
                    >
                      Start Engine
                    </Button>
                  )}
                  <button
                    type="button"
                    onClick={refresh}
                    className="p-1 rounded-lg hover:bg-[var(--gc-border)] text-[var(--gc-text-muted)] hover:text-[var(--gc-text)] cursor-pointer"
                    title="Re-check Ollama status"
                  >
                    <Icon name="refresh" size={14} />
                  </button>
                  <span className="text-xs text-[var(--gc-text-muted)] font-mono">
                    {status === 'Running' ? 'Online' : status === 'Stopped' ? 'Stopped' : 'Not Installed'}
                  </span>
                  <StatusDot status={status === 'Running' ? 'active' : status === 'Stopped' ? 'connecting' : 'error'} />
                </div>
              </div>

              {status !== 'Running' && (
                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-xs text-[var(--gc-text)] flex flex-col gap-2">
                  <div className="font-semibold text-amber-500 flex items-center gap-1.5">
                    <Icon name="info" size={15} />
                    <span>
                      {status === 'NotInstalled'
                        ? 'Ollama was not detected on this PC'
                        : 'Ollama is installed but currently stopped'}
                    </span>
                  </div>
                  <p className="text-[var(--gc-text-muted)] leading-relaxed">
                    {status === 'NotInstalled'
                      ? 'Install Ollama from ollama.com/download (or start it if already installed), then click Refresh above.'
                      : 'Click "Start Engine" above or launch Ollama Desktop so Vant can serve models.'}
                  </p>
                  {status === 'NotInstalled' && (
                    <div>
                      <a
                        href="https://ollama.com/download"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
                      >
                        <span>Download Ollama</span>
                        <Icon name="open_in_new" size={12} />
                      </a>
                    </div>
                  )}
                </div>
              )}

              {ollamaError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-400">
                  {ollamaError}
                </div>
              )}

              <div>
                <h4 className="text-[11px] font-semibold text-[var(--gc-text-muted)] uppercase tracking-wider mb-2">
                  Installed Models
                </h4>
                {models.length > 0 ? (
                  <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto pr-1">
                    {models.map(m => (
                      <div
                        key={m.name}
                        className="flex justify-between items-center px-3.5 py-2.5 bg-[var(--gc-surface-sunken)] border border-[var(--gc-border)] rounded-xl text-xs"
                      >
                        <span className="text-mono font-medium text-[var(--gc-text)]">{m.name}</span>
                        <span className="text-[var(--gc-text-muted)] text-[11px] tabular-nums">
                          {(m.size / 1024 / 1024 / 1024).toFixed(2)} GB
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 rounded-xl bg-[var(--gc-surface-sunken)] border border-[var(--gc-border)] text-center text-xs text-[var(--gc-text-muted)]">
                    No models cached locally yet. Pull one below once Ollama is online.
                  </div>
                )}
              </div>

              <div>
                <h4 className="text-[11px] font-semibold text-[var(--gc-text-muted)] uppercase tracking-wider mb-2">
                  Pull Model to Host
                </h4>
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="input text-xs"
                    placeholder="e.g. llama3.2:3b, qwen2.5-coder:7b, deepseek-r1:8b"
                    id="model-input"
                  />
                  <Button
                    disabled={status !== 'Running' || isPulling}
                    onClick={() => {
                      const el = document.getElementById('model-input') as HTMLInputElement;
                      if (el && el.value.trim()) {
                        pullModel(el.value.trim()).catch(e => toast.error('Pull Failed', String(e)));
                        el.value = '';
                      }
                    }}
                    className="flex items-center gap-1.5 shrink-0 px-4"
                  >
                    <Icon name="download" size={16} />
                    <span>Pull</span>
                  </Button>
                </div>

                {(isPulling || pullProgress) && (
                  <div className="mt-3 p-3 rounded-xl bg-[var(--gc-accent-muted)] border border-violet-500/30 flex flex-col gap-1.5 animate-fade-in">
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="font-semibold text-accent flex items-center gap-1.5">
                        <Icon name="download" size={13} className="animate-bounce text-accent" />
                        {pullProgress?.status || 'Downloading weights...'}
                      </span>
                      {pullProgress?.completed && pullProgress?.total ? (
                        <span className="text-mono text-[var(--gc-text-muted)] text-[10px]">
                          {(pullProgress.completed / 1024 / 1024 / 1024).toFixed(2)} GB /{' '}
                          {(pullProgress.total / 1024 / 1024 / 1024).toFixed(2)} GB (
                          {Math.round((pullProgress.completed / pullProgress.total) * 100)}%)
                        </span>
                      ) : null}
                    </div>
                    <div className="w-full h-1 bg-[var(--gc-surface-sunken)] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-violet-500 transition-all duration-300"
                        style={{
                          width:
                            pullProgress?.completed && pullProgress?.total
                              ? `${Math.min(100, Math.round((pullProgress.completed / pullProgress.total) * 100))}%`
                              : '100%',
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Minimal System & Hardware Disclosure (above Continue) */}
        {(gpuInfo || dockerStatus) && (
          <div className="mt-6">
            <button
              type="button"
              onClick={() => setShowHardwareDetails(prev => !prev)}
              className="flex items-center gap-1.5 text-[11.5px] text-[var(--gc-text-muted)] hover:text-[var(--gc-text)] transition-colors cursor-pointer"
            >
              <Icon name={showHardwareDetails ? 'expand_less' : 'expand_more'} size={15} />
              <span>
                System Hardware
                {gpuInfo && gpuInfo.vendor !== 'none' ? ` · ${gpuInfo.name}` : ''}
              </span>
            </button>

            {showHardwareDetails && (
              <div
                className="mt-2 px-3.5 py-2.5 rounded-xl border text-[11.5px] grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 animate-fade-in"
                style={{
                  background: 'var(--gc-surface-sunken)',
                  borderColor: 'var(--gc-border)',
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[var(--gc-text-muted)]">Graphics</span>
                  <span className="text-mono text-[var(--gc-text)] truncate">
                    {gpuInfo && gpuInfo.vendor !== 'none' ? gpuInfo.name : 'CPU / Integrated'}
                  </span>
                </div>
                {gpuInfo && gpuInfo.vram_mb > 0 && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[var(--gc-text-muted)]">Dedicated VRAM</span>
                    <span className="text-mono text-[var(--gc-text)] tabular-nums">
                      {(gpuInfo.vram_mb / 1024).toFixed(1)} GB
                    </span>
                  </div>
                )}
                {gpuInfo?.driver_version && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[var(--gc-text-muted)]">Driver</span>
                    <span className="text-mono text-[var(--gc-text)]">{gpuInfo.driver_version}</span>
                  </div>
                )}
                {dockerStatus && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[var(--gc-text-muted)]">Container Runtime</span>
                    <span className="text-mono text-[var(--gc-text)]">
                      {dockerStatus.running
                        ? `Docker ${dockerStatus.version || 'Ready'}`
                        : dockerStatus.installed
                          ? 'Docker Stopped'
                          : 'Not Installed'}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Wizard Controls */}
        <div className="flex justify-between items-center mt-4 pt-4 border-t border-[var(--gc-border)]">
          <Button
            variant="ghost"
            onClick={handleBack}
            disabled={step === 1}
            className="flex items-center gap-1.5 text-[12.5px]"
          >
            <Icon name="arrow_back" size={15} />
            <span>Back</span>
          </Button>

          <Button
            variant="primary"
            onClick={handleNext}
            disabled={step === 1 && !role}
            className="flex items-center gap-2 text-[13px] font-medium px-5 py-2.5 rounded-xl"
          >
            <span>{step === totalSteps ? 'Finish & Launch' : 'Continue'}</span>
            <Icon name="arrow_forward" size={15} />
          </Button>
        </div>

        {/* Author Credit Footer */}
        <div className="mt-8 text-center text-[11px] text-[var(--gc-text-muted)]">
          Vant · Developed by{' '}
          <a
            href="https://linkedin.com/in/John--Varghese"
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline font-medium"
          >
            John Varghese (J0X)
          </a>
          {' · '}
          <a
            href="https://github.com/John-Varghese-EH"
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline font-medium"
          >
            GitHub
          </a>
        </div>
      </div>
    </div>
  );
};
