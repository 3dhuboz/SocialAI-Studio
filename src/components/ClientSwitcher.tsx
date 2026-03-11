import React, { useState } from 'react';
import { ClientWorkspace } from '../types';
import { CLIENT } from '../client.config';
import { ChevronDown, Plus, Users, X, Building2 } from 'lucide-react';

interface Props {
  clients: ClientWorkspace[];
  activeClientId: string | null;
  onSwitch: (clientId: string | null) => void;
  onAdd: (name: string, businessType: string) => Promise<void>;
  onDelete: (clientId: string) => Promise<void>;
  agencyName: string;
}

export const ClientSwitcher: React.FC<Props> = ({
  clients, activeClientId, onSwitch, onAdd, onDelete, agencyName,
}) => {
  const [open, setOpen] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('');
  const [adding, setAdding] = useState(false);

  const activeClient = clients.find(c => c.id === activeClientId);
  const label = activeClient ? activeClient.name : agencyName || 'My Agency';
  const atLimit = clients.length >= CLIENT.agencyClientLimit;

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
          <div className="absolute left-0 top-full mt-2 w-72 bg-[#1a1a2e] border border-white/10 rounded-2xl shadow-2xl z-50 overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
              <span className="text-xs text-white/40 font-medium uppercase tracking-wider">Client Workspaces</span>
              <span className="text-xs text-emerald-400">{clients.length}/{CLIENT.agencyClientLimit}</span>
            </div>

            {/* Agency own workspace */}
            <button
              onClick={() => { onSwitch(null); setOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition ${!activeClientId ? 'bg-white/5' : ''}`}
            >
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center flex-shrink-0">
                <Building2 size={13} className="text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-white truncate">{agencyName || 'My Agency'}</p>
                <p className="text-xs text-white/30">Agency account</p>
              </div>
              {!activeClientId && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-400" />}
            </button>

            {/* Client list */}
            {clients.length > 0 && (
              <div className="border-t border-white/5">
                {clients.map(client => (
                  <div
                    key={client.id}
                    className={`flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition group ${activeClientId === client.id ? 'bg-white/5' : ''}`}
                  >
                    <button
                      className="flex items-center gap-3 flex-1 min-w-0 text-left"
                      onClick={() => { onSwitch(client.id); setOpen(false); }}
                    >
                      <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
                        <span className="text-white text-xs font-bold">{client.name.charAt(0).toUpperCase()}</span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white truncate">{client.name}</p>
                        <p className="text-xs text-white/30 truncate">{client.businessType}</p>
                      </div>
                      {activeClientId === client.id && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />}
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Remove "${client.name}"? This will delete all their posts and data.`)) {
                          onDelete(client.id);
                        }
                      }}
                      className="opacity-0 group-hover:opacity-100 text-white/20 hover:text-red-400 transition p-1 flex-shrink-0"
                    >
                      <X size={12} />
                    </button>
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
                  {atLimit ? `Limit reached (${CLIENT.agencyClientLimit} clients)` : 'Add New Client'}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
