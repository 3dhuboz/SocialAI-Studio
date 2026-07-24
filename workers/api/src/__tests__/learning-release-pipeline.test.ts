import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import type { CriticKind, CriticResult } from '../lib/learning/critic-types';
import {
  inspectFinalVideoUrl,
  runMediaCritic,
} from '../lib/learning/media-critic';
import {
  runReleaseJudge,
  runReleaseJudgeWithTelemetry,
} from '../lib/learning/release-judge';
import {
  runReleasePipeline,
  type CandidateInput,
  type ReleaseContext,
  type ReleasePipelineDeps,
} from '../lib/learning/release-pipeline';
import { reviewVideoManifestIndependent } from '../lib/learning/release-preflight';

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
  judge: async () => ({ state: 'pass_green', status: 'available' }),
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

  it('holds when a repair mutates any publish-critical field', async () => {
    const mutations: Array<[string, (input: CandidateInput) => CandidateInput]> = [
      ['user identity', (input) => ({ ...input, userId: 'u2' })],
      ['client ownership', (input) => ({
        ...input, clientId: 'c2', ownerKind: 'client', ownerId: 'c2',
      })],
      ['post identity', (input) => ({ ...input, postId: 'p2' })],
      ['learning mode', (input) => ({ ...input, mode: 'protected_autopilot' })],
      ['platform', (input) => ({ ...input, platform: 'instagram' })],
      ['selected media', (input) => ({
        ...input,
        media: {
          kind: 'image',
          url: 'https://cdn.example/unreviewed.jpg',
          thumbnailUrl: null,
        },
      })],
      ['requested media', (input) => ({ ...input, requestedMediaKind: 'video' })],
      ['video script', (input) => ({ ...input, videoScript: 'Unreviewed script' })],
      ['video shots', (input) => ({ ...input, videoShots: ['Unreviewed shot'] })],
    ];

    for (const [field, mutate] of mutations) {
      let textAttempts = 0;
      let judgeCalls = 0;
      const deps = passingDeps();
      deps.runTextCouncil = async () => {
        textAttempts += 1;
        return textAttempts === 1
          ? [
              verdict('brand', {
                verdict: 'warn_repairable',
                repairs: ['rewrite caption'],
              }),
              ...passingText().slice(1),
            ]
          : passingText();
      };
      deps.repair = async (input) => mutate(input);
      deps.judge = async () => {
        judgeCalls += 1;
        return { state: 'pass_green', status: 'available' };
      };

      const result = await runReleasePipeline(candidate, context, deps);

      expect(result.state, field).toBe('hold_amber');
      expect(result.judgeStatus, field).toBe('not_run');
      expect(result.candidate, field).toMatchObject(candidate);
      expect(judgeCalls, field).toBe(0);
    }
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
      return { state: 'pass_green', status: 'available' };
    };

    expect(await runReleasePipeline(candidate, context, deps)).toMatchObject({
      state: 'block_red',
      judgeStatus: 'not_run',
    });
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
      return { state: 'pass_green', status: 'available' };
    };

    expect((await runReleasePipeline(candidate, context, deps)).state).toBe('block_red');
    expect(judgeCalls).toBe(0);
  });

  it('holds when the separate Release Judge cannot decide', async () => {
    const deps = passingDeps();
    deps.judge = async () => ({ state: 'hold_amber', status: 'available' });

    expect(await runReleasePipeline(candidate, context, deps)).toMatchObject({
      state: 'hold_amber',
      judgeStatus: 'available',
    });
  });

  it('never accepts a green state with unavailable judge telemetry', async () => {
    const deps = passingDeps();
    deps.judge = async () => ({ state: 'pass_green', status: 'unavailable' });

    await expect(runReleasePipeline(candidate, context, deps)).resolves.toMatchObject({
      state: 'hold_amber',
      judgeStatus: 'unavailable',
    });
  });

  it('fails closed with unavailable telemetry when the Release Judge throws', async () => {
    const deps = passingDeps();
    deps.judge = async () => {
      throw new Error('judge provider unavailable');
    };

    await expect(runReleasePipeline(candidate, context, deps)).resolves.toMatchObject({
      state: 'hold_amber',
      judgeStatus: 'unavailable',
    });
  });

  it('never sends generator reasoning to the Release Judge', async () => {
    let judgeInput = '';
    const deps = passingDeps();
    deps.judge = async (input) => {
      judgeInput = JSON.stringify(input);
      return { state: 'pass_green', status: 'available' };
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

describe('reviewVideoManifestIndependent', () => {
  it('uses an independent strict script critic with scoped telemetry before video release', async () => {
    let systemPrompt = '';
    let prompt = '';
    let operationContext: Record<string, unknown> | null = null;

    const result = await reviewVideoManifestIndependent(
      {} as Env,
      {
        ...candidate,
        videoScript: 'Slice the brisket and show the verified smoke ring.',
        videoShots: ['Whole brisket', 'Clean slice'],
        media: {
          kind: 'video',
          url: 'https://cdn.example/final.mp4',
          thumbnailUrl: 'https://cdn.example/thumb.jpg',
          status: 'ready',
        },
      },
      context,
      async (system, userPrompt, callContext) => {
        systemPrompt = system;
        prompt = userPrompt;
        operationContext = callContext;
        return {
          text: JSON.stringify({
            video_manifest: {
              verdict: 'pass',
              severity: 'advisory',
              confidence: 1,
              evidence: ['Script and shots match the verified caption'],
              repairs: [],
            },
          }),
          provider: 'independent-provider',
          model: 'independent-video-critic',
        };
      },
    );

    expect(result).toMatchObject({
      kind: 'video_manifest',
      verdict: 'pass',
      provider: 'independent-provider',
      model: 'independent-video-critic',
    });
    expect(systemPrompt).toContain('independent video script and storyboard critic');
    expect(prompt).toContain('<<UNTRUSTED_FROM_CANDIDATE_CAPTION>>');
    expect(prompt).toContain('<<UNTRUSTED_FROM_VIDEO_SCRIPT>>');
    expect(prompt).toContain('<<UNTRUSTED_FROM_VIDEO_SHOTS>>');
    expect(operationContext).toEqual({
      operation: 'learning_video_manifest_critic',
      userId: 'u1',
      clientId: null,
      postId: 'p1',
    });
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

  it('records unavailable telemetry when the independent judge call fails', async () => {
    const result = await runReleaseJudgeWithTelemetry(
      {} as Env,
      judgeInput,
      async () => {
        throw new Error('providers unavailable');
      },
    );

    expect(result).toEqual({
      state: 'hold_amber',
      status: 'unavailable',
    });
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

  it('records not-run telemetry when critic evidence prevents a judge call', async () => {
    const call = vi.fn();
    const result = await runReleaseJudgeWithTelemetry(
      {} as Env,
      { ...judgeInput, results: [verdict('brand')] },
      call,
    );

    expect(result).toEqual({
      state: 'hold_amber',
      status: 'not_run',
    });
    expect(call).not.toHaveBeenCalled();
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

  it('records available telemetry only for a valid independent judge result', async () => {
    const result = await runReleaseJudgeWithTelemetry(
      {} as Env,
      judgeInput,
      async () => ({
        text: '{"state":"pass_green"}',
        provider: 'test',
        model: 'test',
      }),
    );

    expect(result).toEqual({
      state: 'pass_green',
      status: 'available',
    });
  });
});
