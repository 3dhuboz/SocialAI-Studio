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

export function legacyImmediateVideoReason(args: {
  postType: string | null | undefined;
  usePostproxy: boolean;
}): string | null {
  if (args.postType !== 'video' || args.usePostproxy) return null;
  return 'Immediate Reel publishing needs the current publishing connection. Connect again in Settings, or schedule the Reel instead.';
}
