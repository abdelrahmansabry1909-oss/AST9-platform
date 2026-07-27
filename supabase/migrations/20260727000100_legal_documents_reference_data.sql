-- Restore the six version-registry rows omitted by a schema-only baseline.
-- Metadata only: no legal document text or user acceptance data is stored here.

insert into public.legal_documents (
  doc_type,
  version,
  title,
  body_ref,
  is_required,
  is_current
)
values
  ('terms',               '2026-06-27', 'Terms of Service',                     '/legal/terms.html',               true,  true),
  ('privacy',             '2026-06-27', 'Privacy Policy',                       '/legal/privacy.html',             true,  true),
  ('medical_disclaimer',  '2026-06-27', 'Medical Disclaimer',                   '/legal/medical-disclaimer.html',  true,  true),
  ('health_data_consent', '2026-06-27', 'Consent to Process Health/Rehab Data', '/legal/health-data-consent.html', true,  true),
  ('refund',              '2026-06-27', 'Refund Policy',                        '/legal/refund-policy.html',       false, true),
  ('cookie',              '2026-06-27', 'Cookie Policy',                        '/legal/cookie-policy.html',       false, true)
on conflict (doc_type, version) do nothing;
