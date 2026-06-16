export type PostproxyPublishPlatform = 'facebook' | 'instagram';

export function postproxyMediaArray(mediaUrl: string | null | undefined): string[] {
  return mediaUrl ? [mediaUrl] : [];
}

export function postproxyMissingMediaReason(args: {
  platform: PostproxyPublishPlatform;
  postType: string | null | undefined;
  mediaUrl: string | null | undefined;
}): string | null {
  if (args.mediaUrl) return null;

  if (args.postType === 'video') {
    return 'Reel post has no video URL - open Calendar to regenerate or convert to an image/text post.';
  }

  if (args.platform === 'instagram') {
    return 'Instagram posts require a public image/video URL - regenerate media before publishing.';
  }

  return null;
}
