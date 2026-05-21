import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle, AlertTriangle, X, Info } from 'lucide-react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType>({ toast: () => {} });

export const useToast = () => useContext(ToastContext);

const icons: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle size={18} className="text-green-400" />,
  error: <AlertTriangle size={18} className="text-red-400" />,
  warning: <AlertTriangle size={18} className="text-yellow-400" />,
  info: <Info size={18} className="text-blue-400" />
};

const bgColors: Record<ToastType, string> = {
  success: 'bg-green-900/80 border-green-600',
  error: 'bg-red-900/80 border-red-600',
  warning: 'bg-yellow-900/80 border-yellow-600',
  info: 'bg-blue-900/80 border-blue-600'
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  // Audit P0-6 (2026-05-22): per-type TTL. The previous flat 4s applied
  // to "your Facebook token expired, go reconnect" messages that the user
  // hadn't read yet — by the time they processed the toast it had vanished.
  // Errors get 12s (long enough to read + decide); warnings 8s; success
  // and info keep 4s for the snappy "saved" / "ok" feedback. Error toasts
  // also require an explicit dismiss click before the auto-timer fires —
  // see `requiresDismiss` below.
  const ttlMs: Record<ToastType, number> = {
    success: 4000,
    info:    4000,
    warning: 8000,
    error:   12000,
  };

  const toast = useCallback((message: string, type: ToastType = 'success') => {
    const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), ttlMs[type]);
  }, []);

  const dismiss = (id: string) => setToasts(prev => prev.filter(t => t.id !== id));

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/*
        aria-live: 'assertive' for errors so screen readers interrupt;
        'polite' for the rest so they wait for a natural pause. role=status
        is the semantic anchor for non-error toasts (per WAI-ARIA APG).
      */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
        {toasts.map(t => (
          <div
            key={t.id}
            role={t.type === 'error' ? 'alert' : 'status'}
            aria-live={t.type === 'error' ? 'assertive' : 'polite'}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-xl backdrop-blur-xl text-white text-sm animate-in slide-in-from-right ${bgColors[t.type]}`}
          >
            {icons[t.type]}
            <span className="flex-1">{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              className="opacity-50 hover:opacity-100"
              aria-label="Dismiss notification"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};
