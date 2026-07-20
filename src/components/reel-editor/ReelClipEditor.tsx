import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Crop,
  Image as ImageIcon,
  Loader2,
  Music2,
  Pause,
  Play,
  Plus,
  Redo2,
  RotateCw,
  Scissors,
  SlidersHorizontal,
  Trash2,
  Type,
  Undo2,
  Upload,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { FinishedReelMedia } from '../../services/reelMedia';
import type { ReelRenderProgress } from './renderTimeline';
import {
  duplicateReelClip,
  locateReelProjectTime,
  moveReelClip,
  reelClipDuration,
  reelProjectDuration,
  removeReelClip,
  splitReelClip,
  updateReelClip,
  type ReelClip,
  type ReelProject,
} from './timeline';

type InspectorTab = 'clip' | 'look' | 'text' | 'audio';

interface ReelClipEditorProps {
  project: ReelProject;
  onProjectChange: (project: ReelProject, recordHistory?: boolean) => void;
  onAddFiles: (files: File[]) => Promise<void> | void;
  onAddMusic: (file: File) => void;
  onRemoveMusic: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  coverSeconds: number;
  onCoverChange: (seconds: number) => void;
  finishedMedia: FinishedReelMedia | null;
  finishError: string | null;
  finishIssue: string | null;
  isImporting: boolean;
  isFinishing: boolean;
  renderProgress: ReelRenderProgress | null;
  uploadProgress: number;
  onFinish: () => Promise<void> | void;
  onCancelFinish: () => void;
}

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const TEXT_COLOURS = ['#ffffff', '#f6c55f', '#ef4444', '#111111'];

const formatTimestamp = (seconds: number) => {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds - minutes * 60;
  return `${minutes}:${remainder.toFixed(1).padStart(4, '0')}`;
};

function clipProjectStart(project: ReelProject, clipId: string): number {
  let cursor = 0;
  for (const clip of project.clips) {
    if (clip.id === clipId) return cursor;
    cursor += reelClipDuration(clip);
  }
  return 0;
}

function visualFilter(clip: ReelClip): string {
  return `brightness(${clip.brightness}) contrast(${clip.contrast}) saturate(${clip.saturation})`;
}

export const ReelClipEditor: React.FC<ReelClipEditorProps> = ({
  project,
  onProjectChange,
  onAddFiles,
  onAddMusic,
  onRemoveMusic,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  coverSeconds,
  onCoverChange,
  finishedMedia,
  finishError,
  finishIssue,
  isImporting,
  isFinishing,
  renderProgress,
  uploadProgress,
  onFinish,
  onCancelFinish,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const musicInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('clip');
  const [isPlaying, setIsPlaying] = useState(false);
  const [playheadSourceSeconds, setPlayheadSourceSeconds] = useState(0);
  const [draggedClipId, setDraggedClipId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<'clip' | 'master'>('clip');

  const selectedClip = useMemo(
    () => project.clips.find((clip) => clip.id === project.selectedClipId) || project.clips[0] || null,
    [project.clips, project.selectedClipId],
  );
  const selectedIndex = selectedClip ? project.clips.findIndex((clip) => clip.id === selectedClip.id) : -1;
  const totalDurationSeconds = reelProjectDuration(project);
  const projectPlayheadSeconds = selectedClip
    ? clipProjectStart(project, selectedClip.id)
      + Math.max(0, playheadSourceSeconds - selectedClip.trimStartSeconds) / selectedClip.speed
    : 0;

  useEffect(() => {
    if (!selectedClip) return;
    setPlayheadSourceSeconds(selectedClip.trimStartSeconds);
    setIsPlaying(false);
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    const seek = pendingSeekRef.current ?? selectedClip.trimStartSeconds;
    pendingSeekRef.current = null;
    try { video.currentTime = seek; } catch {}
  }, [selectedClip?.id]);

  useEffect(() => {
    if (finishedMedia) setPreviewMode('master');
  }, [finishedMedia]);

  const commitClip = (patch: Partial<Omit<ReelClip, 'id' | 'sourceId' | 'file' | 'url'>>) => {
    if (!selectedClip) return;
    onProjectChange(updateReelClip(project, selectedClip.id, patch));
  };

  const chooseClip = (clip: ReelClip, sourceSeconds = clip.trimStartSeconds) => {
    pendingSeekRef.current = sourceSeconds;
    onProjectChange({ ...project, selectedClipId: clip.id }, false);
    setPreviewMode('clip');
  };

  const togglePlayback = async () => {
    const video = videoRef.current;
    if (!video || !selectedClip) return;
    if (!video.paused) {
      video.pause();
      setIsPlaying(false);
      return;
    }
    if (video.currentTime < selectedClip.trimStartSeconds || video.currentTime >= selectedClip.trimEndSeconds - 0.05) {
      video.currentTime = selectedClip.trimStartSeconds;
    }
    video.playbackRate = selectedClip.speed;
    video.volume = selectedClip.muted ? 0 : selectedClip.volume;
    try {
      await video.play();
      setIsPlaying(true);
    } catch {
      setIsPlaying(false);
    }
  };

  const nudgePlayhead = (seconds: number) => {
    const video = videoRef.current;
    if (!video || !selectedClip) return;
    video.pause();
    setIsPlaying(false);
    video.currentTime = Math.min(
      selectedClip.trimEndSeconds,
      Math.max(selectedClip.trimStartSeconds, video.currentTime + seconds),
    );
  };

  const selectGlobalTime = (seconds: number) => {
    onCoverChange(seconds);
    const location = locateReelProjectTime(project, seconds);
    if (!location) return;
    pendingSeekRef.current = location.sourceSeconds;
    if (location.clip.id !== selectedClip?.id) {
      onProjectChange({ ...project, selectedClipId: location.clip.id }, false);
    } else if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = location.sourceSeconds;
      setIsPlaying(false);
    }
    setPreviewMode('clip');
  };

  const splitAtPlayhead = () => {
    if (!selectedClip) return;
    const next = splitReelClip(
      project,
      selectedClip.id,
      playheadSourceSeconds,
      crypto.randomUUID(),
      crypto.randomUUID(),
    );
    if (next === project) return;
    onProjectChange(next);
  };

  const duplicateSelected = () => {
    if (!selectedClip) return;
    onProjectChange(duplicateReelClip(project, selectedClip.id, crypto.randomUUID()));
  };

  const removeSelected = () => {
    if (!selectedClip) return;
    onProjectChange(removeReelClip(project, selectedClip.id));
  };

  const moveSelected = (direction: -1 | 1) => {
    if (!selectedClip) return;
    onProjectChange(moveReelClip(project, selectedClip.id, direction));
  };

  const dropClip = (targetId: string) => {
    if (!draggedClipId || draggedClipId === targetId) return;
    const clips = [...project.clips];
    const fromIndex = clips.findIndex((clip) => clip.id === draggedClipId);
    const targetIndex = clips.findIndex((clip) => clip.id === targetId);
    if (fromIndex < 0 || targetIndex < 0) return;
    const [moved] = clips.splice(fromIndex, 1);
    clips.splice(targetIndex, 0, moved);
    setDraggedClipId(null);
    onProjectChange({ ...project, clips });
  };

  const progressValue = renderProgress
    ? renderProgress.progress
    : uploadProgress > 0 && uploadProgress < 1 ? uploadProgress : 0;
  const progressLabel = renderProgress
    ? renderProgress.phase === 'rendering'
      ? `Rendering clip ${renderProgress.clipIndex + 1} of ${renderProgress.clipCount}`
      : renderProgress.phase === 'encoding' ? 'Encoding master' : 'Preparing clips'
    : uploadProgress > 0 && uploadProgress < 1 ? 'Uploading master' : 'Finishing MP4 and cover';

  return (
    <div className="reel-editor">
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files || []);
          if (files.length) void onAddFiles(files);
          event.currentTarget.value = '';
        }}
      />
      <input
        ref={musicInputRef}
        type="file"
        accept="audio/mpeg,audio/mp4,audio/wav,audio/aac,audio/ogg"
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) onAddMusic(file);
          event.currentTarget.value = '';
        }}
      />

      <div className="reel-editor__toolbar">
        <div className="reel-editor__toolgroup">
          <button type="button" className="reel-icon-button" onClick={onUndo} disabled={!canUndo} title="Undo" aria-label="Undo">
            <Undo2 size={17} />
          </button>
          <button type="button" className="reel-icon-button" onClick={onRedo} disabled={!canRedo} title="Redo" aria-label="Redo">
            <Redo2 size={17} />
          </button>
        </div>
        <button type="button" className="reel-editor__add" onClick={() => fileInputRef.current?.click()} disabled={isImporting || isFinishing}>
          {isImporting ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}
          Add clips
        </button>
        <div className="reel-editor__aspect" aria-label="Reel aspect ratio">
          {(['9:16', '4:5', '1:1'] as const).map((ratio) => (
            <button
              key={ratio}
              type="button"
              className={project.aspectRatio === ratio ? 'is-selected' : ''}
              onClick={() => onProjectChange({ ...project, aspectRatio: ratio })}
            >
              {ratio}
            </button>
          ))}
        </div>
        <span className={`reel-editor__duration${totalDurationSeconds > 60 ? ' is-over' : ''}`}>
          {formatTimestamp(totalDurationSeconds)} / 1:00
        </span>
      </div>

      {project.clips.length === 0 ? (
        <button
          type="button"
          className="reel-editor__empty"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const files = Array.from(event.dataTransfer.files || []);
            if (files.length) void onAddFiles(files);
          }}
        >
          <Upload size={28} />
          <strong>Add Pete's clips</strong>
          <span>Select one or several MP4, MOV, or WebM files</span>
        </button>
      ) : (
        <>
          <div className="reel-editor__workspace">
            <div className="reel-editor__stage-wrap">
              <div className="reel-editor__stage-tabs">
                <button type="button" className={previewMode === 'clip' ? 'is-selected' : ''} onClick={() => setPreviewMode('clip')}>Clip preview</button>
                <button type="button" className={previewMode === 'master' ? 'is-selected' : ''} onClick={() => setPreviewMode('master')} disabled={!finishedMedia}>Finished master</button>
              </div>
              <div className="reel-editor__stage" style={{ aspectRatio: project.aspectRatio.replace(':', ' / ') }}>
                {previewMode === 'master' && finishedMedia ? (
                  <video src={finishedMedia.url} poster={finishedMedia.coverUrl} controls playsInline preload="metadata" />
                ) : selectedClip ? (
                  <>
                    <video
                      key={selectedClip.id}
                      ref={videoRef}
                      src={selectedClip.url}
                      playsInline
                      preload="auto"
                      muted={selectedClip.muted}
                      style={{
                        objectFit: selectedClip.fit,
                        filter: visualFilter(selectedClip),
                        transform: `translate(${selectedClip.offsetX * 18}%, ${selectedClip.offsetY * 18}%) scale(${selectedClip.zoom}) rotate(${selectedClip.rotation}deg)`,
                      }}
                      onLoadedMetadata={(event) => {
                        const seek = pendingSeekRef.current ?? selectedClip.trimStartSeconds;
                        pendingSeekRef.current = null;
                        event.currentTarget.currentTime = seek;
                        event.currentTarget.playbackRate = selectedClip.speed;
                        event.currentTarget.volume = selectedClip.muted ? 0 : selectedClip.volume;
                      }}
                      onPlay={() => setIsPlaying(true)}
                      onPause={() => setIsPlaying(false)}
                      onTimeUpdate={(event) => {
                        const current = event.currentTarget.currentTime;
                        setPlayheadSourceSeconds(current);
                        if (current >= selectedClip.trimEndSeconds - 0.025) {
                          event.currentTarget.pause();
                          event.currentTarget.currentTime = selectedClip.trimStartSeconds;
                        }
                      }}
                    />
                    {selectedClip.overlayText.trim() ? (
                      <div className={`reel-editor__overlay is-${selectedClip.overlayPosition}${selectedClip.overlayBackground ? ' has-background' : ''}`} style={{ color: selectedClip.overlayColor }}>
                        {selectedClip.overlayText}
                      </div>
                    ) : null}
                    <div className="reel-editor__transport">
                      <button type="button" onClick={() => nudgePlayhead(-1)} title="Back one second" aria-label="Back one second"><ChevronLeft size={18} /></button>
                      <button type="button" className="is-primary" onClick={() => void togglePlayback()} title={isPlaying ? 'Pause' : 'Play'} aria-label={isPlaying ? 'Pause' : 'Play'}>
                        {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                      </button>
                      <button type="button" onClick={() => nudgePlayhead(1)} title="Forward one second" aria-label="Forward one second"><ChevronRight size={18} /></button>
                      <output>{formatTimestamp(projectPlayheadSeconds)}</output>
                    </div>
                  </>
                ) : null}
              </div>
            </div>

            {selectedClip ? (
              <aside className="reel-editor__inspector">
                <div className="reel-editor__inspector-tabs" role="tablist" aria-label="Clip tools">
                  {([
                    ['clip', Scissors, 'Clip'],
                    ['look', SlidersHorizontal, 'Look'],
                    ['text', Type, 'Text'],
                    ['audio', Volume2, 'Audio'],
                  ] as const).map(([tab, Icon, label]) => (
                    <button key={tab} type="button" role="tab" aria-selected={inspectorTab === tab} className={inspectorTab === tab ? 'is-selected' : ''} onClick={() => setInspectorTab(tab)}>
                      <Icon size={15} /> {label}
                    </button>
                  ))}
                </div>

                {inspectorTab === 'clip' ? (
                  <div className="reel-editor__controls">
                    <label className="reel-control">
                      <span>Start <output>{formatTimestamp(selectedClip.trimStartSeconds)}</output></span>
                      <input type="range" min={0} max={Math.max(0, selectedClip.trimEndSeconds - 0.35)} step={0.05} value={selectedClip.trimStartSeconds} onChange={(event) => commitClip({ trimStartSeconds: Number(event.target.value) })} />
                    </label>
                    <label className="reel-control">
                      <span>End <output>{formatTimestamp(selectedClip.trimEndSeconds)}</output></span>
                      <input type="range" min={selectedClip.trimStartSeconds + 0.35} max={selectedClip.sourceDurationSeconds} step={0.05} value={selectedClip.trimEndSeconds} onChange={(event) => commitClip({ trimEndSeconds: Number(event.target.value) })} />
                    </label>
                    <label className="reel-control reel-control--select">
                      <span>Speed</span>
                      <select value={selectedClip.speed} onChange={(event) => commitClip({ speed: Number(event.target.value) })}>
                        {SPEED_OPTIONS.map((speed) => <option key={speed} value={speed}>{speed}x</option>)}
                      </select>
                    </label>
                    <div className="reel-editor__action-row">
                      <button type="button" onClick={splitAtPlayhead}><Scissors size={15} /> Split</button>
                      <button type="button" onClick={duplicateSelected}><Copy size={15} /> Duplicate</button>
                      <button type="button" className="is-danger" onClick={removeSelected}><Trash2 size={15} /> Delete</button>
                    </div>
                  </div>
                ) : null}

                {inspectorTab === 'look' ? (
                  <div className="reel-editor__controls">
                    <div className="reel-control">
                      <span><Crop size={14} /> Frame</span>
                      <div className="reel-editor__segment">
                        {(['cover', 'contain'] as const).map((fit) => <button key={fit} type="button" className={selectedClip.fit === fit ? 'is-selected' : ''} onClick={() => commitClip({ fit })}>{fit === 'cover' ? 'Fill' : 'Fit'}</button>)}
                      </div>
                    </div>
                    <label className="reel-control">
                      <span>Zoom <output>{selectedClip.zoom.toFixed(2)}x</output></span>
                      <input type="range" min={1} max={2.5} step={0.05} value={selectedClip.zoom} onChange={(event) => commitClip({ zoom: Number(event.target.value) })} />
                    </label>
                    <label className="reel-control">
                      <span>Horizontal position <output>{Math.round(selectedClip.offsetX * 100)}</output></span>
                      <input type="range" min={-1} max={1} step={0.05} value={selectedClip.offsetX} onChange={(event) => commitClip({ offsetX: Number(event.target.value) })} />
                    </label>
                    <label className="reel-control">
                      <span>Vertical position <output>{Math.round(selectedClip.offsetY * 100)}</output></span>
                      <input type="range" min={-1} max={1} step={0.05} value={selectedClip.offsetY} onChange={(event) => commitClip({ offsetY: Number(event.target.value) })} />
                    </label>
                    <div className="reel-control reel-control--inline">
                      <span><RotateCw size={14} /> Rotation</span>
                      <button type="button" onClick={() => commitClip({ rotation: ((selectedClip.rotation + 90) % 360) as ReelClip['rotation'] })}>{selectedClip.rotation}°</button>
                    </div>
                    <label className="reel-control"><span>Brightness <output>{Math.round(selectedClip.brightness * 100)}%</output></span><input type="range" min={0.5} max={1.5} step={0.05} value={selectedClip.brightness} onChange={(event) => commitClip({ brightness: Number(event.target.value) })} /></label>
                    <label className="reel-control"><span>Contrast <output>{Math.round(selectedClip.contrast * 100)}%</output></span><input type="range" min={0.5} max={1.5} step={0.05} value={selectedClip.contrast} onChange={(event) => commitClip({ contrast: Number(event.target.value) })} /></label>
                    <label className="reel-control"><span>Saturation <output>{Math.round(selectedClip.saturation * 100)}%</output></span><input type="range" min={0} max={2} step={0.05} value={selectedClip.saturation} onChange={(event) => commitClip({ saturation: Number(event.target.value) })} /></label>
                    <div className="reel-control">
                      <span>Background</span>
                      <div className="reel-editor__segment">
                        {(['blur', 'black'] as const).map((background) => <button key={background} type="button" className={project.background === background ? 'is-selected' : ''} onClick={() => onProjectChange({ ...project, background })}>{background === 'blur' ? 'Blur' : 'Black'}</button>)}
                      </div>
                    </div>
                  </div>
                ) : null}

                {inspectorTab === 'text' ? (
                  <div className="reel-editor__controls">
                    <label className="reel-control reel-control--textarea">
                      <span>On-video text <output>{selectedClip.overlayText.length}/120</output></span>
                      <textarea maxLength={120} rows={4} value={selectedClip.overlayText} onChange={(event) => commitClip({ overlayText: event.target.value })} placeholder="Fresh from Pete's counter" />
                    </label>
                    <div className="reel-control">
                      <span>Position</span>
                      <div className="reel-editor__segment">
                        {(['top', 'centre', 'bottom'] as const).map((position) => <button key={position} type="button" className={selectedClip.overlayPosition === position ? 'is-selected' : ''} onClick={() => commitClip({ overlayPosition: position })}>{position}</button>)}
                      </div>
                    </div>
                    <div className="reel-control">
                      <span>Text colour</span>
                      <div className="reel-editor__swatches">
                        {TEXT_COLOURS.map((colour) => <button key={colour} type="button" className={selectedClip.overlayColor === colour ? 'is-selected' : ''} style={{ '--swatch': colour } as React.CSSProperties} onClick={() => commitClip({ overlayColor: colour })} aria-label={`Use ${colour} text`} />)}
                      </div>
                    </div>
                    <label className="reel-editor__toggle">
                      <input type="checkbox" checked={selectedClip.overlayBackground} onChange={(event) => commitClip({ overlayBackground: event.target.checked })} />
                      <span>Text background</span>
                    </label>
                  </div>
                ) : null}

                {inspectorTab === 'audio' ? (
                  <div className="reel-editor__controls">
                    <div className="reel-control reel-control--inline">
                      <span>Original sound</span>
                      <button type="button" onClick={() => commitClip({ muted: !selectedClip.muted })} title={selectedClip.muted ? 'Unmute clip' : 'Mute clip'}>
                        {selectedClip.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                        {selectedClip.muted ? 'Muted' : 'On'}
                      </button>
                    </div>
                    <label className="reel-control">
                      <span>Clip volume <output>{Math.round(selectedClip.volume * 100)}%</output></span>
                      <input type="range" min={0} max={1} step={0.05} value={selectedClip.volume} disabled={selectedClip.muted} onChange={(event) => commitClip({ volume: Number(event.target.value) })} />
                    </label>
                    <div className="reel-editor__music">
                      <div>
                        <Music2 size={18} />
                        <span><strong>{project.music?.name || 'Background music'}</strong><small>{project.music ? 'Included in the master mix' : 'MP3, M4A, WAV, AAC, or OGG'}</small></span>
                      </div>
                      <button type="button" onClick={() => musicInputRef.current?.click()}>{project.music ? 'Replace' : 'Choose'}</button>
                    </div>
                    {project.music ? (
                      <>
                        <label className="reel-control"><span>Music volume <output>{Math.round(project.music.volume * 100)}%</output></span><input type="range" min={0} max={1} step={0.05} value={project.music.volume} onChange={(event) => onProjectChange({ ...project, music: project.music ? { ...project.music, volume: Number(event.target.value) } : null })} /></label>
                        <div className="reel-editor__action-row"><button type="button" className="is-danger" onClick={onRemoveMusic}><X size={15} /> Remove music</button></div>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </aside>
            ) : null}
          </div>

          <div className="reel-editor__timeline-heading">
            <div><strong>Timeline</strong><span>Drag clips to reorder</span></div>
            <div className="reel-editor__timeline-actions">
              <button type="button" className="reel-icon-button" onClick={() => moveSelected(-1)} disabled={selectedIndex <= 0} title="Move clip left" aria-label="Move clip left"><ChevronLeft size={16} /></button>
              <button type="button" className="reel-icon-button" onClick={() => moveSelected(1)} disabled={selectedIndex < 0 || selectedIndex >= project.clips.length - 1} title="Move clip right" aria-label="Move clip right"><ChevronRight size={16} /></button>
            </div>
          </div>
          <div className="reel-editor__timeline" role="list" aria-label="Reel clip timeline">
            {project.clips.map((clip, index) => (
              <button
                key={clip.id}
                type="button"
                role="listitem"
                draggable
                className={`reel-editor__clip${selectedClip?.id === clip.id ? ' is-selected' : ''}`}
                style={{ flexGrow: Math.max(1, reelClipDuration(clip)) }}
                onClick={() => chooseClip(clip)}
                onDragStart={() => setDraggedClipId(clip.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => dropClip(clip.id)}
                onDragEnd={() => setDraggedClipId(null)}
              >
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{clip.name}</strong>
                <small>{formatTimestamp(reelClipDuration(clip))}</small>
              </button>
            ))}
            <button type="button" className="reel-editor__clip-add" onClick={() => fileInputRef.current?.click()} title="Add clips" aria-label="Add clips"><Plus size={19} /></button>
          </div>

          <div className="reel-editor__cover">
            <div className="reel-control">
              <span><ImageIcon size={14} /> Cover frame <output>{formatTimestamp(coverSeconds)}</output></span>
              <input type="range" min={0} max={Math.max(0, totalDurationSeconds)} step={0.05} value={Math.min(coverSeconds, totalDurationSeconds)} onChange={(event) => selectGlobalTime(Number(event.target.value))} />
            </div>
          </div>

          {finishError ? <div className="reel-editor__error" role="alert">{finishError}</div> : null}
          {finishedMedia ? (
            <button type="button" className="reel-editor__finished" onClick={() => setPreviewMode('master')}>
              <img src={finishedMedia.coverUrl} alt="Selected Reel cover frame" />
              <span><strong>Finished master ready</strong><small>MP4 and cover saved for publishing</small></span>
              <Play size={17} />
            </button>
          ) : null}

          {isFinishing ? (
            <div className="reel-editor__render-progress" role="status">
              <div><span>{progressLabel}</span><strong>{Math.round(progressValue * 100)}%</strong></div>
              <div className="reel-editor__progress-track"><span style={{ width: `${Math.round(progressValue * 100)}%` }} /></div>
              <button type="button" onClick={onCancelFinish}>Cancel</button>
            </div>
          ) : (
            <button type="button" className="reel-finish-action" onClick={() => void onFinish()} disabled={Boolean(finishIssue)} title={finishIssue || 'Render the edited Reel'}>
              {finishedMedia ? <RotateCw size={16} /> : <Scissors size={16} />}
              {finishedMedia ? 'Update finished master' : 'Render finished Reel'}
            </button>
          )}
          {finishIssue ? <p className="reel-editor__issue">{finishIssue}</p> : null}
        </>
      )}
    </div>
  );
};

export default ReelClipEditor;
