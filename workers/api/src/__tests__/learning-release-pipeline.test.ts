import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import type { CriticKind, CriticResult } from '../lib/learning/critic-types';
import {
  inspectFinalVideoUrl,
  runMediaCritic,
} from '../lib/learning/media-critic';
import { runReleaseJudge } from '../lib/learning/release-judge';
import {
  runReleasePipeline,
  type CandidateInput,
  type ReleaseContext,
  type ReleasePipelineDeps,
} from '../lib/learning/release-pipeline';

const candidate: CandidateInput = {
  userId: 'u1',
  clientId: null,
  ownerKind: 'user',
  ownerId: 'u1',
  postId: 'p1',
  content: 'Fresh brisket today',
  mode: 'shadow',
  platform: 'facebook',
  hashtags: [],
  media: { kind: 'none', url: null, thumbnailUrl: null },
};

const context: ReleaseContext = {
  profile: { businessName: 'Hugheseys Que' },
  verifiedFacts: ['Brisket only'],
  forbiddenSubjects: ['pork', 'chicken'],
  recentPostDigests: ['low and slow'],
};

const verdict = (
  kind: CriticKind,
  patch: Partial<CriticResult> = {},
): CriticResult => ({
  kind,
  verdict: 'pass',
  severity: 'advisory',
  confidence: 0.95,
  evidence: [`${kind}.checked`],
  repairs: [],
  provider: 'test',
  model: 'test',
  ...patch,
});

const passingText = (): CriticResult[] =>
  (['brand', 'fact', 'repetition', 'platform'] as CriticKind[]).map((kind) =>
    verdict(kind),
  );

const passingDeps = (): ReleasePipelineDeps => ({
  runDeterministicCritics: async () => [],
  runTextCouncil: async () => passingText(),
  runHarmCritic: async () => verdict('business_harm'),
  runMediaCritic: async (input) =>
    verdict(input.media.kind === 'video' ? 'video_manifest' : 'image'),
  repair: async (input) => input,
  judge: async () => 'pass_green',
});

describe('runReleasePipeline', () => {
  it('repairs warnings and passes without mandatory human approval', async () => {
    let repairs = 0;
    const deps = passingDeps();
    deps.runTextCouncil = async () =>
      repairs === 0
        ? [
            verdict('brand', {
              verdict: 'warn_repairable',
              repairs: ['remove unsupported superlative'],
            }),
            ...passingText().slice(1),
          ]
        : passingText();
    deps.repair = async (input) => {
      repairs += 1;
      return { ...input, content: 'Brisket available today' };
    };

    const result = await runReleasePipeline(candidate, context, deps);

    expect(result.state).toBe('pass_green');
    expect(result.candidate.content).toBe('Brisket available today');
    expect(repairs).toBe(1);
    expect(result.repairHistory).toEqual([['remove unsupported superlative']]);
  });

  it('caps repairs at two and then holds', async () => {
    let repairs = 0;
    const deps = passingDeps();
    deps.runTextCouncil = async () => [
      verdict('brand', {
        verdict: 'warn_repairable',
        repairs: ['rewrite'],
      }),
      ...passingText().slice(1),
    ];
    deps.repair = async (input) => {
      repairs += 1;
      return input;
    };

    const result = await runReleasePipeline(candidate, context, deps);

    expect(result.state).toBe('hold_amber');
    expect(repairs).toBe(2);
    expect(result.attempts).toHaveLength(3);
  });

  it('blocks deterministic risk before any model call', async () => {
    const calls = { text: 0, harm: 0, judge: 0 };
    const deps = passingDeps();
    deps.runDeterministicCritics = async () => [
      verdict('brand', { verdict: 'block', severity: 'release_critical' }),
    ];
    deps.runTextCouncil = async () => {
      calls.text += 1;
      return passingText();
    };
    deps.runHarmCritic = async () => {
      calls.harm += 1;
      return verdict('business_harm');
    };
    deps.judge = async () => {
      calls.judge += 1;
      return 'pass_green';
    };

    expect((await runReleasePipeline(candidate, context, deps)).state).toBe('block_red');
    expect(calls).toEqual({ text: 0, harm: 0, judge: 0 });
  });

  it('does not let the Release Judge override a critical content block', async () => {
    let judgeCalls = 0;
    const deps = passingDeps();
    deps.runTextCouncil = async () => [
      verdict('brand'),
      verdict('fact', { verdict: 'block', severity: 'release_critical' }),
      verdict('repetition'),
      verdict('platform'),
    ];
    deps.judge = async () => {
      judgeCalls += 1;
      return 'pass_green';
    };

    expect((await runReleasePipeline(candidate, context, deps)).state).toBe('block_red');
    expect(judgeCalls).toBe(0);
  });

  it('holds when the separate Release Judge cannot decide', async () => {
    const deps = passingDeps();
    deps.judge = async () => 'hold_amber';

    expect((await runReleasePipeline(candidate, context, deps)).state).toBe('hold_amber');
  });

  it('never sends generator reasoning to the Release Judge', async () => {
    let judgeInput = '';
    const deps = passingDeps();
    deps.judge = async (input) => {
      judgeInput = JSON.stringify(input);
      return 'pass_green';
    };
    const untrusted = {
      ...candidate,
      generatorReasoning: 'SECRET_CHAIN',
    } as CandidateInput;

    await runReleasePipeline(untrusted, context, deps);

    expect(judgeInput).not.toContain('SECRET_CHAIN');
  });

  it('judges the image that will actually publish when a reel falls back', async () => {
    let mediaKind = '';
    const deps = passingDeps();
    deps.runMediaCritic = async (input) => {
      mediaKind = input.media.kind;
      return verdict('image');
    };
    const fallbackCandidate: CandidateInput = {
      ...candidate,
      requestedMediaKind: 'video',
      media: {
        kind: 'image',
        url: 'https://cdn.example/fallback.jpg',
        thumbnailUrl: null,
      },
    };

    const result = await runReleasePipeline(fallbackCandidate, context, deps);

    expect(mediaKind).toBe('image');
    expect(result.state).toBe('pass_green');
  });
});

describe('inspectFinalVideoUrl', () => {
  it('rejects unsafe video URLs before making a network request', async () => {
    const fetchMock = vi.fn();

    await expect(
      inspectFinalVideoUrl('http://cdn.example/final.mp4', fetchMock as typeof fetch),
    ).rejects.toThrow('Final video URL must use HTTPS');
    await expect(
      inspectFinalVideoUrl(
        'https://user:password@cdn.example/final.mp4',
        fetchMock as typeof fetch,
      ),
    ).rejects.toThrow('Final video URL must not include credentials');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses bounded timeout signals and retries one transient inspection failure', async () => {
    const timeoutSignal = new AbortController().signal;
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutSignal);
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'))
      .mockResolvedValueOnce(new Response(null, {
        status: 200,
        headers: {
          'content-type': 'video/mp4',
          'content-length': '4096',
        },
      }));

    try {
      await expect(
        inspectFinalVideoUrl(
          'https://cdn.example/final.mp4',
          fetchMock as typeof fetch,
        ),
      ).resolves.toEqual({ contentType: 'video/mp4', contentLength: 4096 });
      expect(timeoutSpy).toHaveBeenCalledTimes(2);
      expect(timeoutSpy).toHaveBeenNthCalledWith(1, 10_000);
      expect(timeoutSpy).toHaveBeenNthCalledWith(2, 10_000);
    } finally {
      timeoutSpy.mockRestore();
    }

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://cdn.example/final.mp4',
      expect.objectContaining({ method: 'HEAD', signal: timeoutSignal }),
    );
  });

  it('stops after two failed inspection attempts', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('upstream unavailable'));

    await expect(
      inspectFinalVideoUrl(
        'https://cdn.example/final.mp4',
        fetchMock as typeof fetch,
      ),
    ).rejects.toThrow('Final video inspection failed after 2 attempts');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('runMediaCritic', () => {
  it('uses the final image URL, caption, and owner denylist', async () => {
    let params: any;
    const result = await runMediaCritic(
      {} as Env,
      {
        ...candidate,
        media: {
          kind: 'image',
          url: 'https://cdn.example/final.jpg',
          thumbnailUrl: null,
          archetypeSlug: 'bbq-smokehouse',
        },
      },
      context,
      {
        critiqueImage: async (_env, input) => {
          params = input;
          return { score: 9, match: 'yes', reasoning: 'Matches brisket' };
        },
        inspectVideo: async () => ({ contentType: 'video/mp4', contentLength: 100 }),
        reviewVideoText: async () => verdict('video_manifest'),
      },
    );

    expect(result).toMatchObject({ kind: 'image', verdict: 'pass' });
    expect(params).toMatchObject({
      imageUrl: 'https://cdn.example/final.jpg',
      caption: 'Fresh brisket today',
      forbiddenSubjects: ['pork', 'chicken'],
      userId: 'u1',
      postId: 'p1',
    });
  });

  it('blocks an image below the locked critique threshold', async () => {
    const result = await runMediaCritic(
      {} as Env,
      {
        ...candidate,
        media: { kind: 'image', url: 'https://cdn.example/bad.jpg', thumbnailUrl: null },
      },
      context,
      {
        critiqueImage: async () => ({ score: 4, match: 'no', reasoning: 'Wrong meat' }),
        inspectVideo: async () => ({ contentType: 'video/mp4', contentLength: 100 }),
        reviewVideoText: async () => verdict('video_manifest'),
      },
    );

    expect(result).toMatchObject({
      kind: 'image',
      verdict: 'block',
      severity: 'release_critical',
    });
  });

  it('blocks the Macca surreal-BBQ anatomy regression before release', async () => {
    const result = await runMediaCritic(
      {} as Env,
      {
        ...candidate,
        content: 'What makes a brisket actually perfect?',
        media: {
          kind: 'image',
          url: 'https://cdn.example/surreal-brisket.jpg',
          thumbnailUrl: null,
          archetypeSlug: 'bbq-smokehouse',
        },
      },
      {
        ...context,
        forbiddenSubjects: [
          ...context.forbiddenSubjects,
          'surreal meat anatomy',
          'citrus-shaped brisket',
        ],
      },
      {
        critiqueImage: async () => ({
          score: 1,
          match: 'no',
          reasoning: 'Anatomically impossible citrus-shaped raw meat does not depict smoked brisket',
        }),
        inspectVideo: async () => ({ contentType: 'video/mp4', contentLength: 100 }),
        reviewVideoText: async () => verdict('video_manifest'),
      },
    );

    expect(result).toMatchObject({
      kind: 'image',
      verdict: 'block',
      severity: 'release_critical',
      provider: 'vision_critic',
    });
    expect(result.evidence.join(' ')).toContain('Anatomically impossible');
    expect(result.repairs).toContain(
      'Regenerate the image against the caption and brand exclusions',
    );
  });

  it('returns unavailable when final media is missing', async () => {
    const result = await runMediaCritic(
      {} as Env,
      {
        ...candidate,
        media: { kind: 'video', url: null, thumbnailUrl: null, status: 'ready' },
      },
      context,
      {
        critiqueImage: async () => ({ score: 9, match: 'yes', reasoning: 'Good' }),
        inspectVideo: async () => ({ contentType: 'video/mp4', contentLength: 100 }),
        reviewVideoText: async () => verdict('video_manifest'),
      },
    );

    expect(result).toMatchObject({
      kind: 'video_manifest',
      verdict: 'unavailable',
      severity: 'release_critical',
    });
  });

  it('passes a ready reel only after thumbnail, script, type, and length checks', async () => {
    const result = await runMediaCritic(
      {} as Env,
      {
        ...candidate,
        videoScript: 'Slice the brisket and show the smoke ring.',
        videoShots: ['Whole brisket', 'Clean slice'],
        media: {
          kind: 'video',
          url: 'https://cdn.example/final.mp4',
          thumbnailUrl: 'https://cdn.example/thumb.jpg',
          status: 'ready',
        },
      },
      context,
      {
        critiqueImage: async () => ({ score: 8, match: 'yes', reasoning: 'On brand' }),
        inspectVideo: async () => ({ contentType: 'video/mp4', contentLength: 4096 }),
        reviewVideoText: async () => verdict('video_manifest'),
      },
    );

    expect(result).toMatchObject({
      kind: 'video_manifest',
      verdict: 'pass',
    });
    expect(result.evidence).toEqual(
      expect.arrayContaining(['video.final_url', 'video.thumbnail', 'video.script', 'video.mime', 'video.length']),
    );
  });
});

describe('runReleaseJudge', () => {
  const judgeInput = {
    candidate,
    context,
    results: [...passingText(), verdict('business_harm')],
    repairHistory: [] as string[][],
  };

  it('holds when both independent providers are unavailable', async () => {
    const state = await runReleaseJudge({} as Env, judgeInput, async () => {
      throw new Error('providers unavailable');
    });

    expect(state).toBe('hold_amber');
  });

  it('rejects invalid judge states', async () => {
    const state = await runReleaseJudge({} as Env, judgeInput, async () => ({
      text: '{"state":"approve_everything"}',
      provider: 'test',
      model: 'test',
    }));

    expect(state).toBe('hold_amber');
  });

  it('cannot pass when required critic evidence is missing', async () => {
    const state = await runReleaseJudge(
      {} as Env,
      { ...judgeInput, results: [verdict('brand')] },
      async () => ({
        text: '{"state":"pass_green"}',
        provider: 'test',
        model: 'test',
      }),
    );

    expect(state).toBe('hold_amber');
  });

  it('cannot override a release-critical block', async () => {
    const state = await runReleaseJudge(
      {} as Env,
      {
        ...judgeInput,
        results: [
          ...passingText(),
          verdict('business_harm', {
            verdict: 'block',
            severity: 'release_critical',
          }),
        ],
      },
      async () => ({
        text: '{"state":"pass_green"}',
        provider: 'test',
        model: 'test',
      }),
    );

    expect(state).toBe('block_red');
  });

  it('wraps judge inputs and omits generator reasoning', async () => {
    let prompt = '';
    const state = await runReleaseJudge(
      {} as Env,
      {
        ...judgeInput,
        candidate: {
          ...candidate,
          generatorReasoning: 'SECRET_CHAIN',
        } as CandidateInput,
      },
      async (_system, userPrompt) => {
        prompt = userPrompt;
        return {
          text: '{"state":"pass_green"}',
          provider: 'test',
          model: 'test',
        };
      },
    );

    expect(state).toBe('pass_green');
    expect(prompt).toContain('<<UNTRUSTED_FROM_CANDIDATE>>');
    expect(prompt).toContain('<<UNTRUSTED_FROM_CRITIC_RESULTS>>');
    expect(prompt).not.toContain('SECRET_CHAIN');
  });
});
