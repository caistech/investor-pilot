-- Migration 025 — sender + deck metadata for the courtesy-contract rewrite
--
-- The new outreach structure (Time-ack → Who-am-I → Why-you →
-- What-I-offer → Ask-last) requires data we weren't collecting:
--
-- 1. Sender's LinkedIn URL — recipients ALWAYS look the sender up on
--    LinkedIn before responding. Including the URL in the message is
--    basic courtesy (saves them a search) AND it primes the trust
--    signal — they can verify you're real before clicking the deck.
--
-- 2. Pitch deck / one-pager URL — the value-offer "happy to send you
--    the deck" works much better when the link is RIGHT THERE rather
--    than "reply and I'll send it". Self-serve respects their time.
--
-- 3. Sender bio one-liner — for richer "who I am" framing on cold emails
--    where the operator wants context beyond name + title.
--
-- Idempotent. New columns on organisations + projects + products.

ALTER TABLE organisations ADD COLUMN IF NOT EXISTS sender_linkedin_url TEXT;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS sender_bio_one_liner TEXT;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS sender_calendar_url TEXT;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS pitch_deck_url TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS one_pager_url TEXT;

ALTER TABLE products ADD COLUMN IF NOT EXISTS pitch_deck_url TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS one_pager_url TEXT;

COMMENT ON COLUMN organisations.sender_linkedin_url IS
  'Sender''s LinkedIn URL — included in cold outreach messages so the recipient can verify the sender is a real person before clicking through. Basic courtesy + trust signal.';
COMMENT ON COLUMN organisations.sender_bio_one_liner IS
  'One-sentence sender bio for the WHO-AM-I element of cold messages — e.g. "Technical Director at LingoPure, ex-Founder Institute Country Director."';
COMMENT ON COLUMN organisations.sender_calendar_url IS
  'Sender''s calendar booking link (Cal.com / Calendly / etc) — substituted into the ASK-LAST element so recipients can self-book without an email volley.';
COMMENT ON COLUMN projects.pitch_deck_url IS
  'Public URL to the project''s pitch deck (Notion / Google Drive / DocSend). Surfaced as a value-offer attachment in cold outreach — "happy to send the deck" works much better when the link is right there.';
COMMENT ON COLUMN projects.one_pager_url IS
  'Public URL to the project''s one-pager. Cheaper alternative to the full deck; useful as the value-offer when the recipient is too cold for a full DD package.';
COMMENT ON COLUMN products.pitch_deck_url IS
  'Public URL to the product''s pitch deck / demo (Notion / Google Drive / DocSend / Loom). Surfaced as a value-offer attachment in cold outreach.';
COMMENT ON COLUMN products.one_pager_url IS
  'Public URL to the product''s one-pager. Cheaper than the full deck; useful for the value-offer when the recipient is too cold for the full DD package.';
