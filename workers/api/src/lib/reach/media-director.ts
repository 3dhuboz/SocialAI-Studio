import type {
  ApprovedMediaAsset,
  MediaDirection,
  MediaDirectorInput,
  OrganicPlatform,
} from './types';

export function chooseFormat(
  objective: string,
  platform: OrganicPlatform,
  history: MediaDirectorInput['history'],
): ApprovedMediaAsset['assetType'] {
  const samePlatform = history.filter((row) => row.platform === platform
    && Number.isFinite(row.score));
  const sameObjective = samePlatform.filter((row) => row.objective === objective);
  const eligible = sameObjective.length >= 5 ? sameObjective : samePlatform;
  if (eligible.length >= 5) {
    const byFormat = new Map<ApprovedMediaAsset['assetType'], number[]>();
    for (const row of eligible) {
      const scores = byFormat.get(row.format) ?? [];
      scores.push(row.score);
      byFormat.set(row.format, scores);
    }
    const ranked = [...byFormat.entries()]
      .filter(([, scores]) => scores.length >= 3)
      .map(([format, scores]) => ({
        format,
        mean: scores.reduce((sum, score) => sum + score, 0) / scores.length,
      }))
      .sort((a, b) => b.mean - a.mean);
    if (ranked.length > 0) return ranked[0].format;
  }
  if (platform === 'instagram'
    && ['demonstration', 'behind_scenes'].includes(objective)) {
    return 'video';
  }
  return 'image';
}

export function chooseMediaDirection(input: MediaDirectorInput): MediaDirection {
  const requiredTags = input.requiredTags
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
  const real = input.assets.find((asset) => {
    const tags = asset.tags.map((tag) => tag.trim().toLowerCase());
    return asset.rightsStatus === 'confirmed'
      && requiredTags.length > 0
      && requiredTags.every((tag) => tags.includes(tag));
  });
  if (real) {
    return {
      source: 'approved_asset',
      assetId: real.id,
      format: real.assetType,
      generate: false,
    };
  }
  return {
    source: 'generated',
    assetId: null,
    format: chooseFormat(input.objective, input.platform, input.history),
    generate: true,
  };
}
