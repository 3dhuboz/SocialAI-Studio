import { CRITIQUE_ACCEPT_THRESHOLD } from '../../../../../shared/critique-thresholds';
import type { Env } from '../../env';
import { critiqueImageInternal } from '../critique';
import type { CriticResult } from './critic-types';
import type {
  CandidateInput,
  ReleaseContext,
} from './release-pipeline';

interface VideoInspection {
  contentType: string | null;
  contentLength: number | null;
}

export interface MediaCriticDeps {
  critiqueImage: typeof critiqueImageInternal;
  inspectVideo(url: string): Promise<VideoInspection>;
  reviewVideoText(
    input: CandidateInput,
    context: ReleaseContext,
  ): Promise<CriticResult>;
}

const defaultDeps: MediaCriticDeps = {
  critiqueImage: critiqueImageInternal,
  inspectVideo: async (url) => {
    const response = await fetch(url, { method: 'HEAD' });
    if (!response.ok) throw new Error(`Media HEAD returned ${response.status}`);
    const rawLength = response.headers.get('content-length');
    return {
      contentType: response.headers.get('content-type'),
      contentLength: rawLength ? Number(rawLength) : null,
    };
  },
  reviewVideoText: async () => unavailable(
    'video_manifest',
    'Video script critic unavailable',
  ),
};

function criticResult(
  kind: 'image' | 'video_manifest',
  patch: Partial<CriticResult>,
): CriticResult {
  return {
    kind,
    verdict: 'pass',
    severity: 'advisory',
    confidence: 1,
    evidence: [],
    repairs: [],
    provider: 'internal',
    model: 'media-manifest-v1',
    ...patch,
  };
}

function unavailable(
  kind: 'image' | 'video_manifest',
  reason: string,
): CriticResult {
  return criticResult(kind, {
    verdict: 'unavailable',
    severity: 'release_critical',
    confidence: 0,
    evidence: [reason],
  });
}

async function critiqueFinalImage(
  env: Env,
  input: CandidateInput,
  context: ReleaseContext,
  imageUrl: string,
  deps: MediaCriticDeps,
): Promise<CriticResult> {
  const critique = await deps.critiqueImage(env, {
    imageUrl,
    caption: input.content,
    archetypeSlug: input.media.archetypeSlug ?? null,
    forbiddenSubjects: context.forbiddenSubjects,
    userId: input.userId,
    clientId: input.clientId,
    postId: input.postId,
  });
  if (!critique) return unavailable('image', 'Final image critique unavailable');
  if (critique.score < CRITIQUE_ACCEPT_THRESHOLD) {
    return criticResult('image', {
      verdict: 'block',
      severity: 'release_critical',
      confidence: 1,
      evidence: [
        `Image score ${critique.score} below ${CRITIQUE_ACCEPT_THRESHOLD}`,
        critique.reasoning,
      ],
      repairs: ['Regenerate the image against the caption and brand exclusions'],
      provider: 'vision_critic',
      model: 'existing-critique-chokepoint',
    });
  }
  return criticResult('image', {
    evidence: [`Image score ${critique.score}`, critique.reasoning],
    provider: 'vision_critic',
    model: 'existing-critique-chokepoint',
  });
}

export async function runMediaCritic(
  env: Env,
  input: CandidateInput,
  context: ReleaseContext,
  deps: MediaCriticDeps = defaultDeps,
): Promise<CriticResult> {
  if (input.media.kind === 'image') {
    if (!input.media.url) return unavailable('image', 'Final image URL missing');
    try {
      return await critiqueFinalImage(env, input, context, input.media.url, deps);
    } catch (error) {
      return unavailable(
        'image',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  if (input.media.kind !== 'video') {
    return unavailable('video_manifest', 'No publishable media selected');
  }
  if (!input.media.url) return unavailable('video_manifest', 'Final video URL missing');
  const status = input.media.status?.toLowerCase() ?? '';
  if (status === 'failed' || status === 'error') {
    return criticResult('video_manifest', {
      verdict: 'block',
      severity: 'release_critical',
      evidence: [`Video generation state is ${status}`],
    });
  }
  if (!['ready', 'completed', 'published'].includes(status)) {
    return unavailable('video_manifest', `Video is not ready (${status || 'missing status'})`);
  }
  if (!input.media.thumbnailUrl) {
    return unavailable('video_manifest', 'Final video thumbnail missing');
  }

  try {
    const thumbnail = await critiqueFinalImage(
      env,
      input,
      context,
      input.media.thumbnailUrl,
      deps,
    );
    if (thumbnail.verdict !== 'pass') {
      return criticResult('video_manifest', {
        ...thumbnail,
        kind: 'video_manifest',
        evidence: ['video.thumbnail', ...thumbnail.evidence],
      });
    }

    const script = await deps.reviewVideoText(input, context);
    if (script.verdict !== 'pass') {
      return criticResult('video_manifest', {
        ...script,
        kind: 'video_manifest',
        evidence: ['video.script', ...script.evidence],
      });
    }

    const inspection = await deps.inspectVideo(input.media.url);
    const contentType = inspection.contentType?.split(';')[0].trim().toLowerCase();
    if (!contentType || !['video/mp4', 'video/webm', 'video/quicktime'].includes(contentType)) {
      return criticResult('video_manifest', {
        verdict: 'block',
        severity: 'release_critical',
        evidence: [`Unsupported video MIME type: ${contentType || 'missing'}`],
      });
    }
    if (!inspection.contentLength || inspection.contentLength <= 0) {
      return criticResult('video_manifest', {
        verdict: 'block',
        severity: 'release_critical',
        evidence: ['Video content length is missing or zero'],
      });
    }

    return criticResult('video_manifest', {
      evidence: [
        'video.final_url',
        'video.thumbnail',
        'video.script',
        'video.mime',
        'video.length',
      ],
    });
  } catch (error) {
    return unavailable(
      'video_manifest',
      error instanceof Error ? error.message : String(error),
    );
  }
}
