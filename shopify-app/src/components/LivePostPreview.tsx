// Live FB / IG preview card.
//
// Renders a stylised mock-up of how the post will look on Facebook or
// Instagram once published. Used in the Compose page to give the merchant
// instant feedback on the {image, caption, platform} they're editing.
//
// Polaris doesn't ship a feed-card primitive — these are deliberately
// hand-rolled boxes that match Meta's basic visual layout (rounded
// container, header with shop name + timestamp, square/portrait image,
// caption row, reaction strip).
//
// Width is bounded to ~360px to match the typical mobile feed feel.

import { Box, BlockStack, InlineStack, Text, Avatar } from '@shopify/polaris';

export type PreviewPlatform = 'facebook' | 'instagram';

interface Props {
  platform: PreviewPlatform;
  caption: string;
  imageUrl: string | null;
  shopName: string;
}

export function LivePostPreview({ platform, caption, imageUrl, shopName }: Props) {
  const isInstagram = platform === 'instagram';

  // Truncate the caption preview to match the platform "see more" cutoff.
  // FB collapses at ~125 chars on mobile feed; IG collapses at ~125 too.
  const previewCaption = caption.length > 280 ? caption.slice(0, 280) + '…' : caption;

  return (
    <Box
      background={isInstagram ? 'bg-surface' : 'bg-surface'}
      borderRadius="300"
      borderWidth="025"
      borderColor="border"
      padding="0"
      maxWidth="380px"
    >
      <BlockStack gap="0">
        {/* Header — avatar + shop name + "Sponsored" / timestamp */}
        <Box padding="300">
          <InlineStack gap="200" blockAlign="center">
            <Avatar initials={shopName.slice(0, 2).toUpperCase()} size="sm" />
            <BlockStack gap="0">
              <Text as="span" variant="bodyMd" fontWeight="bold">
                {shopName}
              </Text>
              <Text as="span" variant="bodySm" tone="subdued">
                {isInstagram ? 'Just now' : 'Sponsored · Just now · 🌐'}
              </Text>
            </BlockStack>
          </InlineStack>
        </Box>

        {/* IG puts the image directly under the header; FB shows caption
            first, then image. Match the platform convention. */}
        {!isInstagram && caption && (
          <Box paddingInlineStart="300" paddingInlineEnd="300" paddingBlockEnd="300">
            <Text as="p" variant="bodyMd">{previewCaption}</Text>
          </Box>
        )}

        {imageUrl ? (
          <Box
            background="bg-surface-secondary"
            minHeight={isInstagram ? '380px' : '300px'}
          >
            {/* Use a native <img> so aspect ratio is preserved naturally.
                Polaris doesn't have a feed-image primitive that handles
                arbitrary aspect ratios cleanly. */}
            <img
              src={imageUrl}
              alt="Generated post"
              style={{
                width: '100%',
                aspectRatio: isInstagram ? '1 / 1' : '16 / 9',
                objectFit: 'cover',
                display: 'block',
              }}
            />
          </Box>
        ) : (
          <Box
            background="bg-surface-secondary"
            padding="800"
            minHeight={isInstagram ? '380px' : '240px'}
          >
            <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
              Image will appear here
            </Text>
          </Box>
        )}

        {/* Reaction strip — purely cosmetic, but it makes the mock feel
            real. The labels are hardcoded to match each platform. */}
        <Box
          paddingInlineStart="300"
          paddingInlineEnd="300"
          paddingBlockStart="200"
          paddingBlockEnd="200"
          borderBlockStartWidth="025"
          borderColor="border"
        >
          {isInstagram ? (
            <InlineStack gap="400" blockAlign="center">
              <Text as="span" variant="bodyMd">♡</Text>
              <Text as="span" variant="bodyMd">💬</Text>
              <Text as="span" variant="bodyMd">↗</Text>
              <Box>
                <Text as="span" variant="bodyMd">🔖</Text>
              </Box>
            </InlineStack>
          ) : (
            <InlineStack gap="400" blockAlign="center" align="space-between">
              <Text as="span" variant="bodySm" tone="subdued">👍 Like</Text>
              <Text as="span" variant="bodySm" tone="subdued">💬 Comment</Text>
              <Text as="span" variant="bodySm" tone="subdued">↗ Share</Text>
            </InlineStack>
          )}
        </Box>

        {/* IG shows the caption under the reaction strip with the username
            prefix. FB already showed it above the image. */}
        {isInstagram && caption && (
          <Box paddingInlineStart="300" paddingInlineEnd="300" paddingBlockEnd="300">
            <Text as="p" variant="bodySm">
              <Text as="span" variant="bodySm" fontWeight="bold">{shopName.toLowerCase().replace(/\s+/g, '_')}</Text>
              {' '}
              {previewCaption}
            </Text>
          </Box>
        )}
      </BlockStack>
    </Box>
  );
}
