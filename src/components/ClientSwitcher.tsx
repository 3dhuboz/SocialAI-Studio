import React, { useState } from 'react';
import { ClientWorkspace } from '../types';
import { CLIENT } from '../client.config';
import { ChevronDown, Plus, Users, X, Building2, Pencil, Check, Trash2 } from 'lucide-react';

interface Props {
  clients: ClientWorkspace[];
  activeClientId: string | null;
  onSwitch: (clientId: string | null) => void;
  onAdd: (name: string, businessType: string) => Promise<void>;
  onRename: (clientId: string, name: string, businessType: string) => Promise<void>;
  onDelete: (clientId: string) => Promise<void>;
  agencyName: string;
}

export const ClientSwitcher: React.FC<Props> = ({
  clients, activeClientId, onSwitch, onAdd, onRename, onDelete, agencyName,
}) => {
  const [open, setOpen] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('');
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState('');
  const [saving, setSaving] = useState(false);

  const activeClient = clients.find(c => c.id === activeClientId);
  const label = activeClient ? activeClient.name : agencyName || 'My Agency';
  const atLimit = clients.length >= CLIENT.agencyClientLimit;
  const slotsUsed = clients.length;
  const slotsTotal = CLIENT.agencyClientLimit;

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setAdding(true);
    try {
      await onAdd(newName.trim(), newType.trim() || 'Business');
      setNewName('');
      setNewType('');
      setShowAdd(false);
    } finally {
      setAdding(false);
    }
  };

  const startEdit = (client: ClientWorkspace) => {
    setEditingId(client.id);
    setEditName(client.name);
    setEditType(client.businessType);
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editName.trim()) return;
    setSaving(true);
    try {
      await onRename(editingId, editName.trim(), editType.trim() || 'Business');
      setEditingId(null);
    } finally {
      setSaving(false);
    }
  };

  const cancelEdit = () => { setEditingId(null); setEditName(''); setEditType(''); };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-sm text-white transition"
      >
        <Users size={14} className="text-emerald-400" />
        <span className="max-w-[140px] truncate font-medium">{label}</span>
        <ChevronDown size={13} className={`text-white/40 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-2 w-80 bg-[#1a1a2e] border border-white/10 rounded-2xl shadow-2xl z-50 overflow-hidden">

            {/* Header with slot usage */}
            <div className="px-4 py-3 border-b border-white/5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-white/40 font-medium uppercase tracking-wider">Client Workspaces</span>
                <span className={`text-xs font-bold ${atLimit ? 'text-red-400' : 'text-emerald-400'}`}>
                  {slotsUsed}/{slotsTotal} slots used
                </span>
              </div>
              <div className="w-full bg-white/10 rounded-full h-1.5">
                <div
                  className={`h-1.5 rounded-full transition-all ${atLimit ? 'bg-red-500' : 'bg-emerald-500'}`}
                  style={{ width: `${Math.min(100, (slotsUsed / slotsTotal) * 100)}%` }}
                />
              </div>
            </div>

            {/* Agency own workspace */}
            <button
              onClick={() => { onSwitch(null); setOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition ${!activeClientId ? 'bg-white/5' : ''}`}
            >
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center flex-shrink-0 shadow">
                <Building2 size={14} className="text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white truncate">{agencyName || 'My Agency'}</p>
                <p className="text-xs text-white/30">Agency account</p>
              </div>
              {!activeClientId && <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />}
            </button>

            {/* Client list */}
            {clients.length > 0 && (
              <div className="border-t border-white/5 max-h-64 overflow-y-auto">
                {clients.map(client => (
                  <div key={client.id} className={`border-b border-white/5 last:border-b-0 ${activeClientId === client.id ? 'bg-white/5' : ''}`}>
                    {editingId === client.id ? (
                      /* ── Inline edit form ── */
                      <div className="px-4 py-3 space-y-2">
                        <input
                          autoFocus
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                          placeholder="Business name"
                          className="w-full bg-white/8 border border-white/15 rounded-lg px-3 py-1.5 text-sm text-white placeholder-white/25 focus:outline-none focus:border-emerald-500/60"
                        />
                        <input
                          value={editType}
                          onChange={e => setEditType(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                          placeholder="Business type"
                          className="w-full bg-white/8 border border-white/15 rounded-lg px-3 py-1.5 text-sm text-white placeholder-white/25 focus:outline-none focus:border-emerald-500/60"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={handleSaveEdit}
                            disabled={saving || !editName.trim()}
                            className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-semibold py-1.5 rounded-lg transition"
                          >
                            <Check size={12} /> {saving ? 'Saving…' : 'Save'}
                          </button>
                          <button onClick={cancelEdit} className="px-3 py-1.5 bg-white/8 hover:bg-white/15 text-white/40 rounded-lg transition">
                            <X size={13} />
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* ── Normal client row ── */
                      <div className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition group">
                        <button
                          className="flex items-center gap-3 flex-1 min-w-0 text-left"
                          onClick={() => { onSwitch(client.id); setOpen(false); }}
                        >
                          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center flex-shrink-0 shadow">
                            <span className="text-white text-xs font-bold">{client.name.charAt(0).toUpperCase()}</span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-white truncate">{client.name}</p>
                            <p className="text-xs text-white/30 truncate">{client.businessType}</p>
                          </div>
                          {activeClientId === client.id && <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />}
                        </button>
                        {/* Action buttons — visible on hover */}
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition flex-shrink-0">
                          <button
                            onClick={e => { e.stopPropagation(); startEdit(client); }}
                            className="p-1.5 text-white/25 hover:text-amber-400 hover:bg-amber-500/10 rounded-lg transition"
                            title="Rename"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              if (confirm(`Remove "${client.name}"? This will delete all their posts and data.`)) {
                                onDelete(client.id);
                              }
                            }}
                            className="p-1.5 text-white/25 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition"
                            title="Delete"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Add client */}
            <div className="border-t border-white/5 p-3">
              {showAdd ? (
                <div className="space-y-2">
                  <input
                    autoFocus
                    placeholder="Client business name"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAdd()}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 focus:outline-none focus:border-emerald-500/50"
                  />
                  <input
                    placeholder="Business type (e.g. Café, Gym)"
                    value={newType}
                    onChange={e => setNewType(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAdd()}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/25 focus:outline-none focus:border-emerald-500/50"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleAdd}
                      disabled={adding || !newName.trim()}
                      className="flex-1 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-semibold py-2 rounded-lg transition"
                    >
                      {adding ? 'Adding…' : 'Add Client'}
                    </button>
                    <button
                      onClick={() => { setShowAdd(false); setNewName(''); setNewType(''); }}
                      className="px-3 py-2 bg-white/5 hover:bg-white/10 text-white/40 rounded-lg transition"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowAdd(true)}
                  disabled={atLimit}
                  className="w-full flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300 disabled:opacity-40 disabled:cursor-not-allowed transition py-1"
                >
                  <Plus size={14} />
                  {atLimit ? `All ${slotsTotal} client slots used` : `Add New Client (${slotsTotal - slotsUsed} slot${slotsTotal - slotsUsed !== 1 ? 's' : ''} remaining)`}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
