import React, { useState } from 'react';
import {
  X, CreditCard, LogOut, Trash2, KeyRound, ChevronRight,
  CheckCircle, AlertTriangle, Loader2, ExternalLink, Crown, Zap,
  ShieldCheck, User,
} from 'lucide-react';
import { useUser } from '@clerk/react';
import { useDb } from '../hooks/useDb';
import { CLIENT } from '../client.config';
import { useAuth } from '../contexts/AuthContext';

interface Props {
  activePlan: string;
  userEmail: string;
  onClose: () => void;
  onUpgrade: () => void;
  onSignOut: () => void;
}

const planColors: Record<string, string> = {
  starter: 'from-blue-500 to-indigo-600',
  growth:  'from-amber-500 to-orange-500',
  pro:     'from-purple-500 to-pink-600',
  agency:  'from-emerald-500 to-teal-600',
};

const planBorders: Record<string, string> = {
  starter: 'border-blue-500/30',
  growth:  'border-amber-500/30',
  pro:     'border-purple-500/30',
  agency:  'border-emerald-500/30',
};

type Section = 'main' | 'password' | 'delete';

export const AccountPanel: React.FC<Props> = ({
  activePlan, userEmail, onClose, onUpgrade, onSignOut,
}) => {
  const { user } = useAuth();
  const { user: clerkUser } = useUser();
  const db = useDb();
  const planCfg = CLIENT.plans.find(p => p.id === activePlan);
  const color = planColors[activePlan] || 'from-white/10 to-white/5';
  const border = planBorders[activePlan] || 'border-white/10';

  const [section, setSection] = useState<Section>('main');

  // ── Change password ──────────────────────────────────────
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState(false);

  const handleChangePassword = async () => {
    setPwError('');
    if (newPw.length < 8) { setPwError('New password must be at least 8 characters.'); return; }
    if (newPw !== confirmPw) { setPwError('Passwords do not match.'); return; }
    if (!clerkUser) return;
    setPwLoading(true);
    try {
      await clerkUser.updatePassword({ currentPassword: oldPw, newPassword: newPw });
      setPwSuccess(true);
      setOldPw(''); setNewPw(''); setConfirmPw('');
    } catch (e: any) {
      const msg = e?.errors?.[0]?.message || e?.message || 'Failed to update password.';
      setPwError(msg);
    } finally {
      setPwLoading(false);
    }
  };

  // ── Delete account ───────────────────────────────────────
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');

  const handleDeleteAccount = async () => {
    setDeleteError('');
    if (deleteConfirm !== 'DELETE') { setDeleteError('Type DELETE to confirm.'); return; }
    if (!clerkUser || !user) return;
    setDeleteLoading(true);
    try {
      await db.deleteUser().catch(() => {});
      await clerkUser.delete();
    } catch (e: any) {
      const msg = e?.errors?.[0]?.message || e?.message || 'Failed to delete account.';
      setDeleteError(msg);
      setDeleteLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[999] bg-black/80 backdrop-blur-lg flex items-start justify-end p-4 pt-16">
      <div className="w-full max-w-sm bg-[#13131f] border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-5rem)]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center shadow`}>
              <User size={14} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-white">My Account</p>
              <p className="text-[11px] text-white/35 truncate max-w-[180px]">{userEmail}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/30 hover:text-white p-1.5 rounded-lg hover:bg-white/8 transition">
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1">

          {/* ── MAIN ── */}
          {section === 'main' && (
            <div className="p-5 space-y-4">

              {/* Current plan card */}
              <div className={`rounded-2xl border ${border} p-4 bg-gradient-to-br ${color.replace('from-', 'from-').replace('to-', 'to-')}/10`}
                style={{ background: `linear-gradient(135deg, ${activePlan === 'starter' ? 'rgba(59,130,246,0.12)' : activePlan === 'growth' ? 'rgba(245,158,11,0.12)' : activePlan === 'pro' ? 'rgba(168,85,247,0.12)' : 'rgba(16,185,129,0.12)'} 0%, transparent 100%)` }}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className={`inline-flex items-center gap-1.5 bg-gradient-to-r ${color} text-white text-[10px] font-black px-2.5 py-1 rounded-full mb-2`}>
                      <Crown size={9} /> {planCfg?.name ?? 'Free'} Plan
                    </div>
                    <p className="text-2xl font-black text-white">
                      {planCfg ? `$${planCfg.price}` : '$0'}
                      <span className="text-sm font-normal text-white/35">/mo</span>
                    </p>
                  </div>
                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center shadow-lg`}>
                    <Zap size={16} className="text-white" />
                  </div>
                </div>
                {planCfg && (
                  <ul className="space-y-1.5 mb-4">
                    {planCfg.features.slice(0, 4).map((f, i) => (
                      <li key={i} className="flex items-center gap-1.5 text-xs text-white/60">
                        <CheckCircle size={11} className={activePlan === 'starter' ? 'text-blue-400' : activePlan === 'growth' ? 'text-amber-400' : activePlan === 'pro' ? 'text-purple-400' : 'text-emerald-400'} />
                        {f}
                      </li>
                    ))}
                    {planCfg.features.length > 4 && (
                      <li className="text-xs text-white/25">+ {planCfg.features.length - 4} more features</li>
                    )}
                  </ul>
                )}
                <div className="flex gap-2">
                  <a
                    href={CLIENT.paypalManageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-1.5 bg-white/10 hover:bg-white/15 text-white text-xs font-semibold py-2 rounded-xl transition"
                  >
                    <CreditCard size={12} /> Manage Billing <ExternalLink size={10} />
                  </a>
                  {activePlan !== 'agency' && (
                    <button
                      onClick={() => { onClose(); onUpgrade(); }}
                      className={`flex-1 flex items-center justify-center gap-1.5 bg-gradient-to-r ${color} text-white text-xs font-semibold py-2 rounded-xl hover:opacity-90 transition`}
                    >
                      <Crown size={12} /> Upgrade
                    </button>
                  )}
                  {activePlan === 'agency' && (
                    <div className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold py-2 rounded-xl">
                      <CheckCircle size={12} /> Top Plan
                    </div>
                  )}
                </div>
              </div>

              {/* Account actions */}
              <div className="bg-white/3 border border-white/8 rounded-2xl divide-y divide-white/5 overflow-hidden">
                <button
                  onClick={() => { setSection('password'); setPwError(''); setPwSuccess(false); }}
                  className="w-full flex items-center justify-between px-4 py-3.5 text-sm text-white/70 hover:text-white hover:bg-white/5 transition"
                >
                  <span className="flex items-center gap-2.5"><KeyRound size={14} className="text-white/40" /> Change Password</span>
                  <ChevronRight size={14} className="text-white/20" />
                </button>
                <button
                  onClick={onSignOut}
                  className="w-full flex items-center justify-between px-4 py-3.5 text-sm text-white/70 hover:text-white hover:bg-white/5 transition"
                >
                  <span className="flex items-center gap-2.5"><LogOut size={14} className="text-white/40" /> Sign Out</span>
                  <ChevronRight size={14} className="text-white/20" />
                </button>
                <button
                  onClick={() => { setSection('delete'); setDeleteError(''); setDeleteConfirm(''); }}
                  className="w-full flex items-center justify-between px-4 py-3.5 text-sm text-red-400/70 hover:text-red-400 hover:bg-red-500/5 transition"
                >
                  <span className="flex items-center gap-2.5"><Trash2 size={14} className="text-red-500/40" /> Delete Account</span>
                  <ChevronRight size={14} className="text-red-500/20" />
                </button>
              </div>

              {/* Trust footer */}
              <p className="flex items-center justify-center gap-1.5 text-[11px] text-white/15">
                <ShieldCheck size={11} /> Secured with Clerk + Stripe
              </p>
            </div>
          )}

          {/* ── CHANGE PASSWORD ── */}
          {section === 'password' && (
            <div className="p-5">
              <button onClick={() => setSection('main')} className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white mb-5 transition">
                ← Back
              </button>
              <h3 className="text-base font-black text-white mb-1">Change Password</h3>
              <p className="text-xs text-white/35 mb-5">Enter your current password to verify, then set a new one.</p>

              {pwSuccess ? (
                <div className="flex flex-col items-center gap-3 py-8">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 flex items-center justify-center">
                    <CheckCircle size={22} className="text-emerald-400" />
                  </div>
                  <p className="text-sm font-semibold text-white">Password updated!</p>
                  <button onClick={() => { setPwSuccess(false); setSection('main'); }} className="text-xs text-white/40 hover:text-white mt-1 transition">Back to account</button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-white/40 mb-1 block">Current password</label>
                    <input
                      type="password" value={oldPw} onChange={e => setOldPw(e.target.value)}
                      placeholder="••••••••"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-white/25"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-white/40 mb-1 block">New password</label>
                    <input
                      type="password" value={newPw} onChange={e => setNewPw(e.target.value)}
                      placeholder="Min. 8 characters"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-white/25"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-white/40 mb-1 block">Confirm new password</label>
                    <input
                      type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleChangePassword()}
                      placeholder="Repeat new password"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-white/25"
                    />
                  </div>
                  {pwError && (
                    <p className="flex items-center gap-1.5 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
                      <AlertTriangle size={12} /> {pwError}
                    </p>
                  )}
                  <button
                    onClick={handleChangePassword}
                    disabled={pwLoading || !oldPw || !newPw || !confirmPw}
                    className="w-full flex items-center justify-center gap-2 bg-white text-black font-bold py-3 rounded-xl hover:bg-white/90 disabled:opacity-40 transition text-sm mt-1"
                  >
                    {pwLoading ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={14} />}
                    {pwLoading ? 'Updating…' : 'Update Password'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── DELETE ACCOUNT ── */}
          {section === 'delete' && (
            <div className="p-5">
              <button onClick={() => setSection('main')} className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white mb-5 transition">
                ← Back
              </button>

              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-2xl bg-red-500/15 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle size={18} className="text-red-400" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white">Delete Account</h3>
                  <p className="text-xs text-white/35">This is permanent and cannot be undone.</p>
                </div>
              </div>

              <div className="bg-red-500/8 border border-red-500/20 rounded-2xl p-3 mb-4 text-xs text-red-300/70 space-y-1">
                <p>• All your posts and calendar data will be deleted</p>
                <p>• All client workspaces will be removed</p>
                <p>• Your subscription will not be automatically cancelled — contact support to cancel billing</p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-xs text-white/40 mb-1 block">Type <span className="text-red-400 font-mono font-bold">DELETE</span> to confirm</label>
                  <input
                    type="text" value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)}
                    placeholder="DELETE"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-red-500/40 font-mono"
                  />
                </div>
                {deleteError && (
                  <p className="flex items-center gap-1.5 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
                    <AlertTriangle size={12} /> {deleteError}
                  </p>
                )}
                <button
                  onClick={handleDeleteAccount}
                  disabled={deleteLoading || deleteConfirm !== 'DELETE'}
                  className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 text-white font-bold py-3 rounded-xl disabled:opacity-40 transition text-sm"
                >
                  {deleteLoading ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={14} />}
                  {deleteLoading ? 'Deleting…' : 'Permanently Delete Account'}
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
