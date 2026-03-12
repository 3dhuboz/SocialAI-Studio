import React, { useState, useEffect, useRef } from 'react';
import { Brain, Zap, Calendar, CheckCircle, TrendingUp, Instagram, Facebook, Sparkles, Clock } from 'lucide-react';

const SCENES = [
  {
    id: 'writing',
    label: 'AI Writes Your Post',
    icon: Brain,
    color: 'from-purple-500 to-indigo-600',
    accent: '#a855f7',
  },
  {
    id: 'scheduling',
    label: 'Auto-Scheduled',
    icon: Calendar,
    color: 'from-amber-500 to-orange-500',
    accent: '#f59e0b',
  },
  {
    id: 'publishing',
    label: 'Published & Growing',
    icon: TrendingUp,
    color: 'from-emerald-500 to-teal-500',
    accent: '#10b981',
  },
];

const POST_TEXT = "🚀 Is your business ready for an AI revolution? We help local businesses automate their social media — so you can focus on what matters. DM us 'AI Ready' for a free consultation!";
const HASHTAGS = ['#aimarketing', '#smallbusiness', '#socialmedia', '#automation', '#rockhampton'];

const CALENDAR_POSTS = [
  { day: 'Mon', time: '9:00 AM', platform: 'instagram', topic: 'Brand Story' },
  { day: 'Wed', time: '12:00 PM', platform: 'facebook', topic: 'Product Spotlight' },
  { day: 'Fri', time: '7:00 PM', platform: 'instagram', topic: 'Engagement Post' },
  { day: 'Sat', time: '10:00 AM', platform: 'facebook', topic: 'Weekend Promo' },
];

export const AnimatedDemo: React.FC = () => {
  const [scene, setScene] = useState(0);
  const [sceneProgress, setSceneProgress] = useState(0); // 0–100
  const [typedChars, setTypedChars] = useState(0);
  const [visiblePosts, setVisiblePosts] = useState(0);
  const [statsVisible, setStatsVisible] = useState(false);
  const [publishIdx, setPublishIdx] = useState(-1);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);

  const SCENE_DURATION = 4500; // ms each scene

  // Advance scenes on a timer
  useEffect(() => {
    const id = setInterval(() => {
      setScene(s => (s + 1) % SCENES.length);
      setSceneProgress(0);
      setTypedChars(0);
      setVisiblePosts(0);
      setStatsVisible(false);
      setPublishIdx(-1);
    }, SCENE_DURATION);
    return () => clearInterval(id);
  }, []);

  // Scene progress 0→100 over SCENE_DURATION
  useEffect(() => {
    const start = performance.now();
    const tick = (now: number) => {
      const pct = Math.min(100, ((now - start) / SCENE_DURATION) * 100);
      setSceneProgress(pct);
      if (pct < 100) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [scene]);

  // Scene 0 — typewriter
  useEffect(() => {
    if (scene !== 0) return;
    const total = POST_TEXT.length;
    const speed = SCENE_DURATION / (total * 1.2);
    const id = setInterval(() => setTypedChars(c => Math.min(c + 3, total)), speed);
    return () => clearInterval(id);
  }, [scene]);

  // Scene 1 — stagger calendar posts
  useEffect(() => {
    if (scene !== 1) return;
    setVisiblePosts(0);
    const timers = CALENDAR_POSTS.map((_, i) =>
      setTimeout(() => setVisiblePosts(v => Math.max(v, i + 1)), 400 + i * 600)
    );
    return () => timers.forEach(clearTimeout);
  }, [scene]);

  // Scene 2 — publish sequence then stats
  useEffect(() => {
    if (scene !== 2) return;
    setPublishIdx(-1);
    setStatsVisible(false);
    const t1 = setTimeout(() => setPublishIdx(0), 300);
    const t2 = setTimeout(() => setPublishIdx(1), 900);
    const t3 = setTimeout(() => setStatsVisible(true), 2000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [scene]);

  const currentScene = SCENES[scene];

  return (
    <div className="relative w-full h-full bg-[#080810] overflow-hidden select-none">

      {/* Ambient background glow */}
      <div
        className="absolute inset-0 transition-all duration-1000 pointer-events-none"
        style={{ background: `radial-gradient(ellipse at 50% 40%, ${currentScene.accent}18 0%, transparent 70%)` }}
      />

      {/* Top bar — app chrome */}
      <div className="relative z-10 flex items-center justify-between px-5 py-3 border-b border-white/5 bg-black/30 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
            <Sparkles size={12} className="text-white" />
          </div>
          <span className="text-white text-xs font-black">SocialAI Studio</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] text-white/40">AI Active</span>
        </div>
      </div>

      {/* Scene indicator pills */}
      <div className="absolute top-14 left-0 right-0 flex justify-center gap-2 z-20 px-4">
        {SCENES.map((s, i) => (
          <button
            key={s.id}
            onClick={() => { setScene(i); setSceneProgress(0); setTypedChars(0); setVisiblePosts(0); setStatsVisible(false); setPublishIdx(-1); }}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold transition-all duration-300"
            style={{
              background: i === scene ? `${s.accent}25` : 'rgba(255,255,255,0.04)',
              border: `1px solid ${i === scene ? `${s.accent}50` : 'rgba(255,255,255,0.08)'}`,
              color: i === scene ? s.accent : 'rgba(255,255,255,0.3)',
            }}
          >
            <s.icon size={9} />
            {s.label}
          </button>
        ))}
      </div>

      {/* Progress bar */}
      <div className="absolute top-0 left-0 right-0 h-0.5 z-30">
        <div
          className="h-full transition-none"
          style={{
            width: `${sceneProgress}%`,
            background: `linear-gradient(90deg, ${currentScene.accent}, ${currentScene.accent}80)`,
          }}
        />
      </div>

      {/* ── SCENE 0 — AI Writing ── */}
      {scene === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 pt-14">
          <div className="w-full max-w-sm space-y-3">
            {/* Prompt chip */}
            <div className="flex items-center gap-2 bg-purple-500/10 border border-purple-500/20 rounded-xl px-3 py-2 text-xs">
              <Brain size={12} className="text-purple-400 flex-shrink-0" />
              <span className="text-purple-300/80 font-medium">Topic: AI services for local businesses</span>
            </div>

            {/* Writing card */}
            <div className="bg-white/4 border border-white/10 rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-2 mb-2">
                <Instagram size={13} className="text-pink-400" />
                <span className="text-[10px] text-white/40 font-semibold">Instagram Caption</span>
                <div className="ml-auto flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                  <span className="text-[9px] text-purple-400/70">Writing…</span>
                </div>
              </div>
              <p className="text-xs text-white/80 leading-relaxed min-h-[80px]">
                {POST_TEXT.substring(0, typedChars)}
                {typedChars < POST_TEXT.length && (
                  <span className="inline-block w-0.5 h-3.5 bg-purple-400 ml-0.5 animate-pulse align-middle" />
                )}
              </p>
              {typedChars >= POST_TEXT.length && (
                <div className="flex flex-wrap gap-1 pt-1 border-t border-white/5">
                  {HASHTAGS.map((h, i) => (
                    <span
                      key={h}
                      className="text-[10px] text-amber-400/70 font-medium transition-all"
                      style={{ opacity: typedChars >= POST_TEXT.length ? 1 : 0, transitionDelay: `${i * 80}ms` }}
                    >
                      {h}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* AI stats */}
            <div className="flex gap-2">
              {[
                { label: 'Engagement Score', value: '94%', color: 'text-emerald-400' },
                { label: 'Best Time', value: '9:00 AM', color: 'text-amber-400' },
              ].map((s) => (
                <div key={s.label} className="flex-1 bg-white/3 border border-white/8 rounded-xl px-3 py-2 text-center">
                  <p className={`text-base font-black ${s.color}`}>{s.value}</p>
                  <p className="text-[9px] text-white/30 mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── SCENE 1 — Auto-Scheduling ── */}
      {scene === 1 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-5 pt-16">
          <div className="w-full max-w-sm space-y-2">
            <div className="flex items-center gap-2 mb-3">
              <Calendar size={14} className="text-amber-400" />
              <span className="text-xs font-black text-white">This Week's Schedule</span>
              <span className="ml-auto text-[10px] text-white/30">{visiblePosts}/{CALENDAR_POSTS.length} posts</span>
            </div>
            {CALENDAR_POSTS.map((p, i) => (
              <div
                key={i}
                className="flex items-center gap-3 bg-white/4 border border-white/8 rounded-xl px-3 py-2.5 transition-all duration-500"
                style={{
                  opacity: i < visiblePosts ? 1 : 0,
                  transform: i < visiblePosts ? 'translateY(0)' : 'translateY(10px)',
                }}
              >
                <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/20 flex flex-col items-center justify-center flex-shrink-0">
                  <span className="text-[9px] text-amber-400/60 font-bold leading-none">{p.day}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-white/80 truncate">{p.topic}</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <Clock size={9} className="text-white/25" />
                    <span className="text-[10px] text-white/30">{p.time}</span>
                  </div>
                </div>
                {p.platform === 'instagram'
                  ? <Instagram size={14} className="text-pink-400 flex-shrink-0" />
                  : <Facebook size={14} className="text-blue-400 flex-shrink-0" />}
                {i < visiblePosts && (
                  <CheckCircle size={13} className="text-emerald-400 flex-shrink-0" />
                )}
              </div>
            ))}
            {visiblePosts >= CALENDAR_POSTS.length && (
              <div className="flex items-center justify-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl py-2.5 mt-1">
                <Zap size={12} className="text-emerald-400" />
                <span className="text-xs font-bold text-emerald-400">Week fully scheduled — hands free!</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── SCENE 2 — Published & Stats ── */}
      {scene === 2 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-5 pt-16">
          <div className="w-full max-w-sm space-y-3">
            {/* Published posts */}
            {[
              { platform: 'instagram', label: 'Instagram', color: 'text-pink-400', bg: 'bg-pink-500/10', border: 'border-pink-500/20', snippet: '🚀 Is your business ready for AI…' },
              { platform: 'facebook', label: 'Facebook', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20', snippet: '💡 We help local businesses automate…' },
            ].map((p, i) => (
              <div
                key={p.platform}
                className={`flex items-center gap-3 border rounded-xl px-3 py-3 transition-all duration-500 ${p.bg} ${p.border}`}
                style={{
                  opacity: publishIdx >= i ? 1 : 0,
                  transform: publishIdx >= i ? 'scale(1)' : 'scale(0.95)',
                }}
              >
                {p.platform === 'instagram'
                  ? <Instagram size={18} className={p.color} />
                  : <Facebook size={18} className={p.color} />}
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-black text-white/50 uppercase tracking-wide">{p.label}</p>
                  <p className="text-xs text-white/70 truncate">{p.snippet}</p>
                </div>
                {publishIdx >= i && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <CheckCircle size={14} className="text-emerald-400" />
                    <span className="text-[10px] text-emerald-400 font-bold">Live</span>
                  </div>
                )}
              </div>
            ))}

            {/* Live stats */}
            {statsVisible && (
              <div
                className="grid grid-cols-3 gap-2 transition-all duration-700"
                style={{ opacity: statsVisible ? 1 : 0 }}
              >
                {[
                  { icon: '👁️', value: '2,847', label: 'Reach', color: 'text-blue-300' },
                  { icon: '❤️', value: '184', label: 'Likes', color: 'text-pink-300' },
                  { icon: '💬', value: '37', label: 'Comments', color: 'text-amber-300' },
                ].map((s) => (
                  <div key={s.label} className="bg-white/4 border border-white/8 rounded-xl p-2.5 text-center">
                    <div className="text-base">{s.icon}</div>
                    <p className={`text-sm font-black ${s.color}`}>{s.value}</p>
                    <p className="text-[9px] text-white/30">{s.label}</p>
                  </div>
                ))}
              </div>
            )}

            {statsVisible && (
              <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3 py-2">
                <TrendingUp size={13} className="text-emerald-400" />
                <span className="text-xs text-emerald-300 font-semibold">Engagement up 47% this week</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bottom label */}
      <div className="absolute bottom-4 left-0 right-0 flex flex-col items-center gap-1.5">
        <div
          className={`inline-flex items-center gap-1.5 bg-gradient-to-r ${currentScene.color} text-white text-[10px] font-black px-3 py-1.5 rounded-full shadow-lg transition-all duration-500`}
        >
          <currentScene.icon size={10} />
          {currentScene.label}
        </div>
        <div className="flex gap-1">
          {SCENES.map((_, i) => (
            <div
              key={i}
              className="h-0.5 rounded-full transition-all duration-300"
              style={{
                width: i === scene ? 20 : 6,
                background: i === scene ? currentScene.accent : 'rgba(255,255,255,0.15)',
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
