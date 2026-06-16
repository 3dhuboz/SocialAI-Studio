const GLADSTONE_CONTEXT_RE =
  /\b(?:gladstone\s+bbq\s+festival|gladstonebbqfest\.au|tannum\s+seagulls|boyne\s+island)\b/i;

const STALE_GLADSTONE_TICKET_RE =
  /\b(?:vip|full\s+vip\s+experience|general\s+admission\s*(?:pre-sale|presale)?\s*\$?\s*20|pre-sale\s+adult\s+general\s+admission\s*\$?\s*20|adult\s+general\s+admission\s*\$?\s*20|\$20|high\s+school\s*(?:kids?)?\s*\$?\s*10|primary\s+school\s+(?:kids?\s+)?free)\b/i;

const CURRENT_GLADSTONE_TICKET_FACTS =
  'Tickets are Adult $30, Family Pass $80 for 2 adults and 2 kids, High School $15, Kids 5-12 $5, and Under 5s free.';

export function hasStaleGladstoneTicketFacts(content: string): boolean {
  return GLADSTONE_CONTEXT_RE.test(content) && STALE_GLADSTONE_TICKET_RE.test(content);
}

export function sanitizeKnownEventTicketFacts(content: string): string {
  if (!hasStaleGladstoneTicketFacts(content)) return content;

  const parts = content.match(/[^.!?\n]+[.!?]?|\n+/g) ?? [content];
  const cleaned: string[] = [];

  for (const part of parts) {
    if (/^\n+$/.test(part)) continue;
    if (STALE_GLADSTONE_TICKET_RE.test(part)) continue;
    const trimmed = part.trim();
    if (trimmed) cleaned.push(trimmed);
  }

  const hasCurrentFacts = cleaned.some((part) =>
    /adult\s+\$30|family\s+pass\s+\$80|kids\s+5-12\s+\$5/i.test(part),
  );

  if (!hasCurrentFacts) {
    cleaned.splice(Math.min(1, cleaned.length), 0, CURRENT_GLADSTONE_TICKET_FACTS);
  }

  return (cleaned.length ? cleaned.join(' ') : CURRENT_GLADSTONE_TICKET_FACTS)
    .replace(/\s{2,}/g, ' ')
    .trim();
}

