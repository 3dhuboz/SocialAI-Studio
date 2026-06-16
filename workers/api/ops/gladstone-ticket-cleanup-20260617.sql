-- Clean stale Gladstone BBQ Festival ticket facts from SocialAI production data.
-- Correct facts as of 2026-06-17:
-- Adult $30, Family Pass $80, High School $15, Kids 5-12 $5, Under 5s free.

UPDATE clients
SET profile = json_set(
  profile,
  '$.productsServices',
  'Gladstone BBQ Festival tickets: Adult $30, Family Pass $80 for 2 adults and 2 kids, High School $15, Kids 5-12 $5, Under 5s free. BBQ competition, food vendors, cooking demonstrations, market stalls, live music, Fathers Day weekend community event at Tannum Seagulls Rugby League Club.',
  '$.contentTopics',
  'Ticket sales with current prices, Fathers Day weekend, BBQ competition, Australian Barbecue Alliance, food vendors, cooking demonstrations, market stalls, live music, mens mental health fundraising, Tannum Seagulls venue.'
)
WHERE id = 'gladstonebbq-001';

UPDATE campaigns
SET brief = 'Gladstone BBQ Festival 2026 ticket campaign. Facts: Saturday 5 September 2026, 11:00 AM to 9:00 PM at Tannum Seagulls Rugby League Club, 35 Pioneer Drive, Boyne Island. Tickets available: Adult $30, Family Pass $80 for 2 adults and 2 kids, High School $15, Kids 5-12 $5, Under 5s free. Includes free rides, a mechanical bull, food vendors, cooking demonstrations, market stalls, food competitions, live music, and an Australian Barbecue Alliance sanctioned BBQ competition. Raises money for mens mental health. Visual angles: festival crowd, brisket, ribs, smokers, food truck rows, trophies, market stalls, Tannum Seagulls venue.',
    brief_summary = 'Verified event facts: 5 Sep 2026, 11am-9pm at Tannum Seagulls; tickets Adult $30, Family Pass $80, High School $15, Kids 5-12 $5, Under 5s free; BBQ competition, vendors, demos, stalls, live music, mens mental health fundraiser.'
WHERE id = '1e592edd-aa82-42e7-aa26-2be75046e772';

UPDATE posts
SET content = 'Removed obsolete Gladstone BBQ Festival post. Current tickets: Adult $30, Family Pass $80 for 2 adults and 2 kids, High School $15, Kids 5-12 $5, Under 5s free.',
    qa_feedback_target = 'image',
    qa_feedback_reason = 'bad_image',
    qa_feedback_note = 'DELETE_PLATFORM:stale_ticket_facts:2026-06-17T00:00:00Z',
    reasoning = 'Queued for Facebook deletion because it promoted obsolete ticket pricing.',
    claim_id = NULL,
    claim_at = NULL
WHERE id IN (
  '323095b5-376b-4851-a23e-e5f1820ae53c',
  'c3427476-aeb9-42fb-94ce-3c8873e0f7f5',
  '60fac116-62b4-4f14-9fcd-b36151a13f1d',
  '6b5d567e-2d02-48cb-bad6-8e70b2e07705'
);

UPDATE posts
SET status = 'Deleted',
    content = 'Removed obsolete Gladstone BBQ Festival post. Current tickets: Adult $30, Family Pass $80 for 2 adults and 2 kids, High School $15, Kids 5-12 $5, Under 5s free.',
    reasoning = 'Removed obsolete missed/deleted post because it promoted obsolete ticket pricing.',
    claim_id = NULL,
    claim_at = NULL
WHERE id IN (
  '21788acd-b87b-4e0f-81b8-7cfda8a40898',
  'af3ebee7-3d7f-458b-8d26-ea6f22cc348a',
  '06a3a83c-5bf3-4dd3-ae4d-2c3efe9aced0',
  'd33874c5-10dd-4d77-b085-e0a2a89421b0'
);

