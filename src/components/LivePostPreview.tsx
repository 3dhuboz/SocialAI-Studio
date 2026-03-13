import React from 'react';
import { Loader2, ThumbsUp, MessageCircle, Share2, Bookmark, Heart, Send } from 'lucide-react';

interface Props {
  platform: 'Facebook' | 'Instagram';
  profileName: string;
  profileLogo?: string;
  content: string;
  hashtags: string[];
  image: string | null;
  videoUrl: string | null;
  isGeneratingReel: boolean;
  videoProgress: number;
  contentType: 'text' | 'image' | 'video';
}

const FB_BLUE = '#1877F2';
const IG_GRAD = 'linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)';

export const LivePostPreview: React.FC<Props> = ({
  platform, profileName, profileLogo, content, hashtags,
  image, videoUrl, isGeneratingReel, videoProgress, contentType,
}) => {
  const initial = (profileName || 'B').charAt(0).toUpperCase();
  const isFb = platform === 'Facebook';

  return (
    <div className="w-full">
      {/* Label */}
      <div className="flex items-center gap-2 mb-2.5">
        <div className="h-px flex-1 bg-white/6" />
        <span className="text-[10px] font-bold text-white/20 uppercase tracking-widest px-2">
          {platform} preview
        </span>
        <div className="h-px flex-1 bg-white/6" />
      </div>

      {/* ── Facebook card ── */}
      {isFb && (
        <div className="bg-white rounded-2xl shadow-2xl shadow-black/40 overflow-hidden text-gray-900 font-sans max-w-md mx-auto border border-black/5">
          {/* Header */}
          <div className="flex items-center gap-2.5 px-4 pt-3 pb-2">
            {profileLogo ? (
              <img src={profileLogo} alt="" className="w-10 h-10 rounded-full object-cover border border-black/5 flex-shrink-0" />
            ) : (
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-black text-sm flex-shrink-0" style={{ background: FB_BLUE }}>
                {initial}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="font-bold text-[13px] leading-tight truncate">{profileName || 'Your Business'}</p>
              <p className="text-[11px] text-gray-400 flex items-center gap-1">Just now · 🌐</p>
            </div>
            <div className="text-gray-400 text-xl leading-none">···</div>
          </div>

          {/* Body */}
          <div className="px-4 pb-2">
            <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-gray-800">{content}</p>
            {hashtags.length > 0 && (
              <p className="text-[13px] mt-1.5 leading-relaxed" style={{ color: FB_BLUE }}>
                {hashtags.map(t => t.startsWith('#') ? t : `#${t}`).join(' ')}
              </p>
            )}
          </div>

          {/* Media */}
          {videoUrl ? (
            <video
              src={videoUrl}
              className="w-full max-h-72 object-cover bg-black"
              autoPlay loop muted playsInline
            />
          ) : isGeneratingReel && contentType === 'video' ? (
            <div className="w-full bg-gray-100 flex flex-col items-center justify-center py-10 gap-3 border-t border-b border-gray-200">
              <Loader2 size={22} className="animate-spin text-purple-500" />
              <p className="text-xs text-gray-500 font-medium">Generating video… {Math.round(videoProgress * 100)}%</p>
              <div className="w-40 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-purple-500 rounded-full transition-all duration-500" style={{ width: `${Math.round(videoProgress * 100)}%` }} />
              </div>
            </div>
          ) : image && contentType !== 'video' ? (
            <img src={image} alt="" className="w-full max-h-72 object-cover" />
          ) : null}

          {/* Reaction summary */}
          <div className="px-4 py-1.5 flex items-center justify-between text-[12px] text-gray-500 border-b border-gray-100">
            <span className="flex items-center gap-1">
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-[11px]" style={{ background: FB_BLUE }}>👍</span>
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] bg-red-500">❤️</span>
              <span className="ml-0.5">Be the first to react</span>
            </span>
          </div>

          {/* Action bar */}
          <div className="flex items-center justify-around px-2 py-0.5">
            {[
              { icon: <ThumbsUp size={16} />, label: 'Like' },
              { icon: <MessageCircle size={16} />, label: 'Comment' },
              { icon: <Share2 size={16} />, label: 'Share' },
            ].map(({ icon, label }) => (
              <button key={label} className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[13px] font-semibold text-gray-500 hover:bg-gray-50 rounded-lg transition">
                {icon} {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Instagram card ── */}
      {!isFb && (
        <div className="bg-white rounded-2xl shadow-2xl shadow-black/40 overflow-hidden text-gray-900 font-sans max-w-sm mx-auto border border-black/5">
          {/* Header */}
          <div className="flex items-center gap-2.5 px-3 py-2.5 border-b border-gray-100">
            {profileLogo ? (
              <img src={profileLogo} alt="" className="w-8 h-8 rounded-full object-cover border-2 border-transparent p-px flex-shrink-0" style={{ background: IG_GRAD, backgroundOrigin: 'border-box' }} />
            ) : (
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-white font-black text-xs flex-shrink-0 p-px" style={{ background: IG_GRAD }}>
                <div className="w-full h-full rounded-full flex items-center justify-center bg-gray-800 text-white">{initial}</div>
              </div>
            )}
            <p className="font-bold text-[13px] flex-1 truncate">{(profileName || 'yourbusiness').toLowerCase().replace(/\s+/g, '_')}</p>
            <div className="text-gray-400 text-xl leading-none">···</div>
          </div>

          {/* Media */}
          {videoUrl ? (
            <div className="relative w-full bg-black" style={{ aspectRatio: '9/16', maxHeight: '340px' }}>
              <video src={videoUrl} className="w-full h-full object-cover" autoPlay loop muted playsInline />
              <div className="absolute top-2 left-2 bg-purple-600/80 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full">REEL</div>
            </div>
          ) : isGeneratingReel && contentType === 'video' ? (
            <div className="w-full bg-gray-100 flex flex-col items-center justify-center py-12 gap-3" style={{ aspectRatio: '1/1' }}>
              <Loader2 size={22} className="animate-spin text-purple-500" />
              <p className="text-xs text-gray-500">Generating Reel… {Math.round(videoProgress * 100)}%</p>
            </div>
          ) : image && contentType !== 'video' ? (
            <img src={image} alt="" className="w-full object-cover" style={{ aspectRatio: '1/1' }} />
          ) : (
            <div className="w-full bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center" style={{ aspectRatio: '1/1' }}>
              <span className="text-4xl">📸</span>
            </div>
          )}

          {/* Actions */}
          <div className="px-3 pt-2.5 pb-1">
            <div className="flex items-center gap-3 mb-2">
              <Heart size={22} className="text-gray-800 hover:text-red-500 cursor-pointer transition" />
              <MessageCircle size={22} className="text-gray-800 cursor-pointer" />
              <Send size={22} className="text-gray-800 cursor-pointer" />
              <Bookmark size={22} className="text-gray-800 ml-auto cursor-pointer" />
            </div>
            <p className="text-[13px] font-bold text-gray-900 mb-0.5">Be the first to like this</p>
            <p className="text-[13px] leading-relaxed text-gray-800">
              <span className="font-bold mr-1">{(profileName || 'yourbusiness').toLowerCase().replace(/\s+/g, '_')}</span>
              {content}
            </p>
            {hashtags.length > 0 && (
              <p className="text-[12px] mt-0.5 text-blue-600 leading-relaxed">
                {hashtags.map(t => t.startsWith('#') ? t : `#${t}`).join(' ')}
              </p>
            )}
            <p className="text-[11px] text-gray-400 mt-1 uppercase tracking-wide">Just now</p>
          </div>
        </div>
      )}
    </div>
  );
};
