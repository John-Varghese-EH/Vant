import React, { useState, useEffect } from 'react';
import { Icon } from './common/Icon';
import {
  getPairedDevices,
  revokeDevice,
  removeDevice,
  updatePeerRole,
  generatePeerApiToken,
  generatePairingLink,
  TrustedPeer,
  UserRole
} from '../lib/tauri';
import { Badge } from './common/Badge';
import { Button } from './common/Button';
import { IconBadge } from './common/IconBadge';
import { CustomSelect } from './common/CustomSelect';
import { ConfirmModal } from './common/ConfirmModal';
import { useToast } from './common/Toast';

export const UserManagementPanel: React.FC = () => {
  const toast = useToast();
  const [peers, setPeers] = useState<TrustedPeer[]>([]);
  const [pairingLink, setPairingLink] = useState<string>('');
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [rpmDrafts, setRpmDrafts] = useState<Record<string, string>>({});
  const [confirmRemovePeer, setConfirmRemovePeer] = useState<TrustedPeer | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);

  const loadPeers = async () => {
    try {
      const list = await getPairedDevices();
      setPeers(list);
      const drafts: Record<string, string> = {};
      list.forEach(p => {
        drafts[p.peer_id] = String(p.rate_limit_rpm);
      });
      setRpmDrafts(drafts);
    } catch (e) {
      console.error('Failed to load peers:', e);
    }
  };

  useEffect(() => {
    loadPeers();
  }, []);

  const handleGenerateLink = async () => {
    try {
      const link = await generatePairingLink();
      setPairingLink(link);
      toast.success('Invitation Link Ready', 'Encrypted Noise pairing link generated.');
    } catch (e: any) {
      toast.error('Failed to generate link', typeof e === 'string' ? e : e?.message);
    }
  };

  const handleRoleChange = async (peerId: string, newRole: UserRole, currentRpm: number) => {
    try {
      await updatePeerRole(peerId, newRole, currentRpm);
      await loadPeers();
      toast.success('Role Updated', `Peer role changed to ${newRole}.`);
    } catch (e: any) {
      toast.error('Failed to update role', typeof e === 'string' ? e : e?.message);
    }
  };

  const commitRateLimit = async (peer: TrustedPeer) => {
    const raw = rpmDrafts[peer.peer_id];
    const parsed = parseInt(raw || '', 10);
    const bounded = Number.isNaN(parsed) ? peer.rate_limit_rpm : Math.max(1, Math.min(6000, parsed));
    setRpmDrafts(prev => ({ ...prev, [peer.peer_id]: String(bounded) }));
    if (bounded === peer.rate_limit_rpm) return;

    try {
      await updatePeerRole(peer.peer_id, peer.role, bounded);
      await loadPeers();
      toast.success('Rate Limit Updated', `${peer.device_name} limited to ${bounded} req/min.`);
    } catch (e: any) {
      toast.error('Failed to update rate limit', typeof e === 'string' ? e : e?.message);
    }
  };

  const handleGenerateToken = async (peerId: string) => {
    try {
      const token = await generatePeerApiToken(peerId);
      navigator.clipboard.writeText(token);
      setCopiedToken(peerId);
      setTimeout(() => setCopiedToken(null), 2500);
      await loadPeers();
      toast.success('Bearer Token Copied', 'Token copied to clipboard.');
    } catch (e: any) {
      toast.error('Failed to generate token', typeof e === 'string' ? e : e?.message);
    }
  };

  const handleRevoke = async (peerId: string) => {
    try {
      await revokeDevice(peerId);
      await loadPeers();
      toast.warning('Access Revoked', 'Client device can no longer authenticate.');
    } catch (e: any) {
      toast.error('Failed to revoke peer', typeof e === 'string' ? e : e?.message);
    }
  };

  const handleConfirmRemove = async () => {
    if (!confirmRemovePeer) return;
    setIsRemoving(true);
    try {
      await removeDevice(confirmRemovePeer.peer_id);
      await loadPeers();
      toast.info('Device Removed', `${confirmRemovePeer.device_name} removed from trusted store.`);
      setConfirmRemovePeer(null);
    } catch (e: any) {
      toast.error('Failed to remove peer', typeof e === 'string' ? e : e?.message);
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[var(--gc-text)] flex items-center gap-2">
            <Icon name="group" size={20} className="text-accent" />
            <span>Multi-User &amp; Access Control (RBAC)</span>
          </h2>
          <p className="text-sm text-[var(--gc-text-muted)] mt-1">
            Manage authenticated client devices, assign roles (Admin, Developer, Viewer), and configure API tokens.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={loadPeers} className="flex items-center gap-1.5 text-[var(--gc-text)]">
            <Icon name="refresh" size={14} /> Refresh
          </Button>
          <Button size="sm" variant="primary" onClick={handleGenerateLink} className="flex items-center gap-1.5">
            <Icon name="add" size={14} /> Generate Invite Link
          </Button>
        </div>
      </div>

      {/* Generated Token Banner */}
      {pairingLink && (
        <div className="double-bezel">
          <div className="double-bezel-inner bg-[var(--gc-accent-muted)] border-[var(--gc-accent)] flex flex-col gap-2">
            <div className="text-[11px] font-semibold text-accent uppercase tracking-wider flex items-center gap-1.5">
              <Icon name="vpn_key" size={13} className="text-accent" />
              <span>One-Click Client Invitation Link (Encrypted Token + Tunnel):</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={pairingLink}
                className="flex-1 bg-[var(--gc-surface-sunken)] border border-[var(--gc-border)] rounded-xl px-3.5 py-2 text-xs font-mono text-[var(--gc-text)] select-all focus:outline-none"
              />
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  navigator.clipboard.writeText(pairingLink);
                  setCopiedLink(true);
                  setTimeout(() => setCopiedLink(false), 2000);
                }}
                className="flex items-center gap-1.5 text-xs px-4 py-2"
              >
                {copiedLink ? <Icon name="check" size={14} className="text-emerald-300" /> : <Icon name="content_copy" size={14} />}
                <span>{copiedLink ? 'Copied' : 'Copy Link'}</span>
              </Button>
            </div>
            <div className="text-[11px] text-[var(--gc-text-muted)]">
              Securely encodes the Cloudflare Tunnel URL and cryptographic Noise pairing secret.
            </div>
          </div>
        </div>
      )}

      {/* Peer List Table */}
      <div className="double-bezel">
        <div className="double-bezel-inner p-0 overflow-visible">
          {peers.length === 0 ? (
            <div className="p-16 text-center text-[var(--gc-text-muted)]">
              <Icon name="verified_user" size={36} className="mx-auto mb-3 opacity-40 text-accent" />
              <div className="text-sm font-semibold text-[var(--gc-text)]">No paired client devices connected</div>
              <div className="text-xs text-[var(--gc-text-muted)] mt-1">
                Generate an invite link above to pair remote client laptops.
              </div>
            </div>
          ) : (
            <div className="divide-y divide-[var(--gc-border)]">
              {peers.map(peer => {
                const isCopied = copiedToken === peer.peer_id;
                return (
                  <div
                    key={peer.peer_id}
                    className="p-4 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 hover:bg-[var(--gc-surface-elevated)] transition-colors rounded-xl"
                  >
                    <div className="flex items-center gap-3">
                      <IconBadge
                        icon={<Icon name="laptop_mac" size={18} />}
                        variant={peer.role === 'admin' ? 'rose' : peer.role === 'developer' ? 'accent' : 'neutral'}
                        size="md"
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-[var(--gc-text)] text-sm">
                            {peer.nickname || peer.device_name}
                          </span>
                          <Badge variant={peer.revoked ? 'danger' : 'success'}>
                            {peer.revoked ? 'Revoked' : 'Active'}
                          </Badge>
                        </div>
                        <div className="text-xs text-[var(--gc-text-muted)] font-mono mt-0.5">
                          {peer.nickname ? `${peer.device_name} · ` : ''}ID: {peer.peer_id.substring(0, 12)}...
                        </div>
                      </div>
                    </div>

                    {/* Role & Rate Limit Controls */}
                    <div className="flex flex-wrap items-center gap-2.5">
                      <div className="w-36">
                        <CustomSelect
                          value={peer.role}
                          onChange={val => handleRoleChange(peer.peer_id, val as UserRole, peer.rate_limit_rpm)}
                          options={[
                            { value: 'developer', label: 'Developer' },
                            { value: 'admin', label: 'Admin' },
                            { value: 'viewer', label: 'Viewer' },
                          ]}
                        />
                      </div>

                      <div
                        className="flex items-center gap-1.5 bg-[var(--gc-surface-sunken)] px-2.5 py-2 rounded-xl border border-[var(--gc-border)]"
                        title="Requests per minute quota (press Enter or blur to save)"
                      >
                        <Icon name="speed" size={13} className="text-[var(--gc-text-muted)]" />
                        <span className="text-[11px] text-[var(--gc-text-muted)] font-mono">RPM:</span>
                        <input
                          type="number"
                          min="1"
                          max="6000"
                          value={rpmDrafts[peer.peer_id] ?? String(peer.rate_limit_rpm)}
                          onChange={e =>
                            setRpmDrafts(prev => ({ ...prev, [peer.peer_id]: e.target.value }))
                          }
                          onBlur={() => commitRateLimit(peer)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              (e.target as HTMLInputElement).blur();
                            }
                          }}
                          className="w-14 bg-transparent text-xs text-[var(--gc-text)] font-mono focus:outline-none"
                        />
                      </div>

                      <button
                        onClick={() => handleGenerateToken(peer.peer_id)}
                        title={peer.api_token ? `Token: ${peer.api_token}` : 'Generate Bearer API Token'}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[var(--gc-surface-elevated)] hover:bg-[var(--gc-border)] border border-[var(--gc-border)] text-xs text-[var(--gc-text)] font-mono transition-colors cursor-pointer"
                      >
                        <Icon name="vpn_key" size={13} className={peer.api_token ? 'text-amber-500' : 'text-[var(--gc-text-muted)]'} />
                        <span>{isCopied ? 'Copied!' : peer.api_token ? 'Rotate & Copy Token' : 'New Token'}</span>
                      </button>

                      <div className="flex items-center gap-1">
                        {!peer.revoked && (
                          <Button size="sm" variant="ghost" onClick={() => handleRevoke(peer.peer_id)} className="text-xs text-amber-500 hover:text-amber-400">
                            Revoke
                          </Button>
                        )}
                        <button
                          onClick={() => setConfirmRemovePeer(peer)}
                          title="Remove device"
                          className="p-2 rounded-xl hover:bg-red-500/15 text-[var(--gc-text-muted)] hover:text-rose-500 transition-colors cursor-pointer"
                        >
                          <Icon name="delete" size={15} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <ConfirmModal
        open={Boolean(confirmRemovePeer)}
        onClose={() => setConfirmRemovePeer(null)}
        onConfirm={handleConfirmRemove}
        title="Remove Trusted Device"
        description={`Remove "${confirmRemovePeer?.device_name || 'this device'}" from trusted peers? It will need to re-pair to access your compute node again.`}
        confirmLabel="Remove Device"
        variant="danger"
        loading={isRemoving}
      />
    </div>
  );
};
