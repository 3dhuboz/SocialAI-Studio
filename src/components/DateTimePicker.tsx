import React, { useState, useRef, useEffect } from 'react';
import { Calendar, Clock, ChevronLeft, ChevronRight, X } from 'lucide-react';

interface Props {
  value: string;           // ISO datetime string or ''
  onChange: (val: string) => void;
}

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const pad = (n: number) => String(n).padStart(2, '0');

const parseValue = (val: string) => {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
};

export const DateTimePicker: React.FC<Props> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const parsed = parseValue(value);

  const now = new Date();
  const [viewYear, setViewYear] = useState(parsed?.getFullYear() ?? now.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed?.getMonth() ?? now.getMonth());
  const [selectedDate, setSelectedDate] = useState<Date | null>(parsed);
  const [hour, setHour] = useState(parsed ? pad(parsed.getHours()) : '09');
  const [minute, setMinute] = useState(parsed ? pad(parsed.getMinutes()) : '00');

  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Sync when value prop changes externally
  useEffect(() => {
    const d = parseValue(value);
    if (d) {
      setSelectedDate(d);
      setViewYear(d.getFullYear());
      setViewMonth(d.getMonth());
      setHour(pad(d.getHours()));
      setMinute(pad(d.getMinutes()));
    } else {
      setSelectedDate(null);
    }
  }, [value]);

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };

  const selectDay = (day: number) => {
    const d = new Date(viewYear, viewMonth, day);
    setSelectedDate(d);
  };

  const confirm = () => {
    if (!selectedDate) return;
    const d = new Date(selectedDate);
    d.setHours(parseInt(hour, 10));
    d.setMinutes(parseInt(minute, 10));
    d.setSeconds(0);
    const localISO = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    onChange(localISO);
    setOpen(false);
  };

  const clear = () => { onChange(''); setSelectedDate(null); setOpen(false); };

  const isToday = (day: number) => {
    const t = new Date();
    return t.getFullYear() === viewYear && t.getMonth() === viewMonth && t.getDate() === day;
  };
  const isSelected = (day: number) =>
    selectedDate?.getFullYear() === viewYear &&
    selectedDate?.getMonth() === viewMonth &&
    selectedDate?.getDate() === day;

  const displayLabel = parsed
    ? `${parsed.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
    : 'Schedule for later';

  return (
    <div className="relative" ref={ref}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border transition text-sm font-medium ${
          value
            ? 'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/15'
            : 'bg-black/40 border-white/10 text-white/40 hover:border-white/20 hover:text-white/60'
        }`}
      >
        <Calendar size={13} className="flex-shrink-0" />
        <span>{displayLabel}</span>
        {value && (
          <span
            role="button"
            onClick={e => { e.stopPropagation(); clear(); }}
            className="ml-1 text-white/30 hover:text-white/60 transition"
          >
            <X size={11} />
          </span>
        )}
      </button>

      {/* Popover */}
      {open && (
        <div className="absolute bottom-full mb-2 left-0 z-50 w-[300px] bg-[#0e0e1c] border border-white/10 rounded-2xl shadow-2xl shadow-black/60 backdrop-blur-xl overflow-hidden select-none">
          {/* Month navigation */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
            <button onClick={prevMonth} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/8 transition text-white/50 hover:text-white">
              <ChevronLeft size={15} />
            </button>
            <span className="text-sm font-bold text-white">{MONTHS[viewMonth]} {viewYear}</span>
            <button onClick={nextMonth} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/8 transition text-white/50 hover:text-white">
              <ChevronRight size={15} />
            </button>
          </div>

          {/* Day grid */}
          <div className="p-3">
            <div className="grid grid-cols-7 mb-1">
              {DAYS.map(d => (
                <div key={d} className="text-center text-[10px] font-bold text-white/20 py-1">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              {Array.from({ length: firstDayOfWeek }).map((_, i) => <div key={`e${i}`} />)}
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => (
                <button
                  key={day}
                  onClick={() => selectDay(day)}
                  className={`w-full aspect-square rounded-xl text-xs font-semibold transition flex items-center justify-center
                    ${isSelected(day)
                      ? 'bg-amber-500 text-black font-black shadow-lg shadow-amber-500/30'
                      : isToday(day)
                      ? 'bg-white/8 text-amber-400 border border-amber-500/30'
                      : 'text-white/60 hover:bg-white/8 hover:text-white'
                    }`}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>

          {/* Time selector */}
          <div className="flex items-center gap-2 px-4 pb-3 border-t border-white/[0.06] pt-3">
            <Clock size={13} className="text-white/30 flex-shrink-0" />
            <span className="text-xs text-white/30">Time</span>
            <select
              value={hour}
              onChange={e => setHour(e.target.value)}
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white text-sm font-mono focus:outline-none focus:border-amber-500/40 appearance-none text-center"
            >
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={pad(i)}>{pad(i)}</option>
              ))}
            </select>
            <span className="text-white/30 font-bold">:</span>
            <select
              value={minute}
              onChange={e => setMinute(e.target.value)}
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white text-sm font-mono focus:outline-none focus:border-amber-500/40 appearance-none text-center"
            >
              {['00','05','10','15','20','25','30','35','40','45','50','55'].map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          {/* Actions */}
          <div className="flex gap-2 px-4 pb-4">
            <button
              onClick={clear}
              className="flex-1 py-2 rounded-xl bg-white/5 hover:bg-white/8 text-white/40 hover:text-white/60 text-xs font-semibold transition border border-white/[0.06]"
            >
              Clear
            </button>
            <button
              onClick={confirm}
              disabled={!selectedDate}
              className="flex-1 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black font-bold text-xs transition shadow-lg shadow-amber-500/20"
            >
              {selectedDate ? `Schedule ${pad(parseInt(hour))}:${minute}` : 'Select a date'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
