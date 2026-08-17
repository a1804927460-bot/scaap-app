-- One-time 666-point redemption codes. Only SHA-256 digests are persisted;
-- plaintext codes are delivered out of band and never enter the repository.
insert into public.ai_redemption_codes
  (code_id, code_hash, credit_amount, unlocks_overseas, max_redemptions, pricing_tier, active)
values
  ('grant-666-20260818-01', '98ab6a6fd1f902ef1b1b1163c3dfe48906f509f38b04d5a942a8092cd445f770', 666, false, 1, null, true),
  ('grant-666-20260818-02', 'ea4effa251db246ff566b152d31433a66274a77207d4447c41675dd96248643b', 666, false, 1, null, true),
  ('grant-666-20260818-03', '1fb1454acd7999ec1c608d846f00e7e8873c54f1d1acfd70765e595d961a89d2', 666, false, 1, null, true)
on conflict (code_id) do update set
  code_hash = excluded.code_hash,
  credit_amount = excluded.credit_amount,
  unlocks_overseas = excluded.unlocks_overseas,
  max_redemptions = excluded.max_redemptions,
  pricing_tier = null,
  active = true;
