import React, { useState } from 'react';
import {
  X, Facebook, Instagram, Send, Trash2, Save, Loader2,
  Calendar, Clock, Edit2, CheckCircle, Image as ImageIcon,
  RefreshCw, Upload, Hash
} from 'lucide-react';
import { SocialPost } from '../types';

interface Props {
  post: SocialPost;
  image?: string;
  isGeneratingImage?: boolean;
  fbConnected: boolean;
  hasApiKey: boolean;
  onClose: () => void;
  onPublish: (post: SocialPost) => Promise<void>;
  onDelete: (id: string) => void;
  onSave: (id: string, updates: Partial<SocialPost>) => Promise<void>;
  onRegenImage: (postId: string, prompt: string) => void;
  onUpload: (postId: string) => void;
}

export const PostModal: React.FC<Props> = ({
  post, image, isGeneratingImage, fbConnected, hasApiKey,
  onClose, onPublish, onDelete, onSave, onRegenImage, onUpload,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(post.content);
  const [editHashtags, setEditHashtags] = useState((post.hashtags || []).join(' '));
  const [editDate, setEditDate] = useState(() => {
    const d = new Date(post.scheduledFor);
    return d.toISOString().slice(0, 16);
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const displayImage = image || post.image;

  const handleSave = async () => {
    setIsSaving(true);
    const tags = editHashtags.trim()
      ? editHashtags.trim().split(/\s+/).map(t => t.startsWith('#') ? t : `#${t}`)
      : [];
    await onSave(post.id, {
      content: editContent,
      hashtags: tags,
      scheduledFor: new Date(editDate).toISOString(),
    });
    setIsSaving(false);
    setIsEditing(false);
  };

  const handlePublish = async () => {
    setIsPublishing(true);
    await onPublish(post);
    setIsPublishing(false);
    onClose();
  };

  const handleDelete = async () => {
    if (!confirm('Delete this post?')) return;
    setIsDeleting(true);
    onDelete(post.id);
    onClose();
  };

  const isIG = post.platform === 'Instagram';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-lg bg-[#0f0f17] border border-white/10 rounded-3xl shadow-2xl shadow-black/60 overflow-hidden">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/6">
          <div className="flex items-center gap-2">
            {isIG
              ? <Instagram size={15} className="text-pink-400" />
              : <Facebook size={15} className="text-blue-400" />}
            <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
              post.status === 'Posted' ? 'bg-green-500/15 text-green-300' :
              post.status === 'Scheduled' ? 'bg-blue-500/15 text-blue-300' :
              'bg-white/8 text-white/30'
            }`}>{post.status}</span>
            {post.pillar && (
              <span className="text-[10px] bg-purple-500/15 text-purple-300 px-2 py-0.5 rounded-full">{post.pillar}</span>
            )}
          </div>
          <button onClick={onClose} className="text-white/25 hover:text-white/70 transition p-1">
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto max-h-[80vh]">
          {/* ── Image ── */}
          {displayImage ? (
            <div className="relative">
              <img src={displayImage} alt="" className="w-full max-h-56 object-cover" />
              <div className="absolute top-2 right-2 flex gap-1.5">
                {post.imagePrompt && hasApiKey && (
                  <button
                    onClick={() => onRegenImage(post.id, post.imagePrompt!)}
                    className="bg-black/60 hover:bg-black/80 border border-white/15 text-white/70 p-1.5 rounded-lg transition backdrop-blur"
                    title="Regenerate image"
                  >
                    <RefreshCw size={12} />
                  </button>
                )}
                <button
                  onClick={() => onUpload(post.id)}
                  className="bg-black/60 hover:bg-black/80 border border-white/15 text-white/70 p-1.5 rounded-lg transition backdrop-blur"
                  title="Upload image"
                >
                  <Upload size={12} />
                </button>
              </div>
            </div>
          ) : isGeneratingImage ? (
            <div className="w-full h-32 bg-black/30 flex items-center justify-center gap-2 border-b border-white/6">
              <Loader2 size={16} className="animate-spin text-amber-400" />
              <span className="text-xs text-amber-400/70">Generating image…</span>
            </div>
          ) : (
            <div className="w-full h-24 bg-black/20 flex items-center justify-center gap-3 border-b border-white/6">
              <ImageIcon size={16} className="text-white/15" />
              <div className="flex gap-2">
                {post.imagePrompt && hasApiKey && (
                  <button
                    onClick={() => onRegenImage(post.id, post.imagePrompt!)}
                    className="text-xs bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 px-3 py-1.5 rounded-lg transition border border-amber-500/20"
                  >
                    Generate AI Image
                  </button>
                )}
                <button
                  onClick={() => onUpload(post.id)}
                  className="text-xs bg-white/6 hover:bg-white/10 text-white/40 px-3 py-1.5 rounded-lg transition border border-white/10"
                >
                  Upload Image
                </button>
              </div>
            </div>
          )}

          <div className="p-6 space-y-4">
            {/* ── Schedule info ── */}
            <div className="flex items-center gap-4 text-xs text-white/35">
              <span className="flex items-center gap-1.5">
                <Calendar size={12} />
                {new Date(post.scheduledFor).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
              <span className="flex items-center gap-1.5">
                <Clock size={12} />
                {new Date(post.scheduledFor).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>

            {/* ── Content ── */}
            {isEditing ? (
              <div className="space-y-3">
                <textarea
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 focus:border-amber-500/40 rounded-xl p-4 text-white text-sm resize-none min-h-[140px] placeholder:text-white/20 focus:outline-none transition"
                  placeholder="Post caption…"
                />
                <div>
                  <label className="text-[11px] text-white/35 flex items-center gap-1 mb-1.5">
                    <Hash size={10} /> Hashtags (space-separated)
                  </label>
                  <input
                    value={editHashtags}
                    onChange={e => setEditHashtags(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 focus:border-amber-500/40 rounded-xl px-4 py-2.5 text-amber-300/80 text-xs focus:outline-none transition placeholder:text-white/20"
                    placeholder="#hashtag1 #hashtag2 …"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-white/35 flex items-center gap-1 mb-1.5">
                    <Calendar size={10} /> Scheduled for
                  </label>
                  <input
                    type="datetime-local"
                    value={editDate}
                    onChange={e => setEditDate(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 focus:border-amber-500/40 rounded-xl px-4 py-2.5 text-white text-xs focus:outline-none transition"
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-black font-bold px-4 py-2 rounded-xl text-sm transition"
                  >
                    {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    {isSaving ? 'Saving…' : 'Save Changes'}
                  </button>
                  <button
                    onClick={() => { setIsEditing(false); setEditContent(post.content); setEditHashtags((post.hashtags || []).join(' ')); }}
                    className="text-white/40 hover:text-white/70 px-4 py-2 rounded-xl text-sm transition"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-white/75 leading-relaxed whitespace-pre-wrap">{post.content}</p>
                {post.hashtags?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {post.hashtags.map((t, i) => (
                      <span key={i} className="text-[11px] bg-amber-500/10 text-amber-300/70 px-2 py-0.5 rounded-full border border-amber-500/15">
                        {t.startsWith('#') ? t : `#${t}`}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Footer actions ── */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-white/6 bg-black/20">
          <div className="flex gap-2">
            {/* Publish */}
            {fbConnected && post.status !== 'Posted' && (
              <button
                onClick={handlePublish}
                disabled={isPublishing || isEditing}
                className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:opacity-90 disabled:opacity-60 text-white font-bold px-4 py-2.5 rounded-xl text-sm transition shadow-lg shadow-blue-900/20"
              >
                {isPublishing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {isPublishing ? 'Publishing…' : 'Publish Now'}
              </button>
            )}
            {post.status === 'Posted' && (
              <span className="flex items-center gap-1.5 text-xs text-green-400 px-3 py-2.5">
                <CheckCircle size={13} /> Published
              </span>
            )}
            {/* Edit */}
            {!isEditing && post.status !== 'Posted' && (
              <button
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-2 bg-white/6 hover:bg-white/10 border border-white/10 text-white/60 hover:text-white font-semibold px-4 py-2.5 rounded-xl text-sm transition"
              >
                <Edit2 size={13} /> Edit
              </button>
            )}
          </div>
          {/* Delete */}
          <button
            onClick={handleDelete}
            disabled={isDeleting}
            className="flex items-center gap-1.5 text-white/20 hover:text-red-400 hover:bg-red-500/10 px-3 py-2.5 rounded-xl text-xs transition"
          >
            <Trash2 size={13} /> Delete
          </button>
        </div>
      </div>
    </div>
  );
};
