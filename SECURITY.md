# Security Policy

## Secret handling

Never commit or package any of the following:

- Supabase secret/service-role keys
- Railway tokens
- AI provider API keys
- code-signing certificates or passwords
- GitHub personal access tokens

The Supabase project URL and publishable key are public client configuration.
Their safety depends on correct Row Level Security policies. The desktop build
contains those public values, but all privileged keys remain in sealed Railway
variables.

## Reporting

Before public release, replace this section with a monitored security email and
publish a responsible-disclosure policy. A report should include the affected
version, reproduction steps, and whether credentials or user content may have
been exposed. Do not ask reporters to include real secrets or private files.

## Incident response

1. Disable the affected Railway provider or suspend the exposed user quota.
2. Rotate the upstream provider key, Supabase secret key, and Railway token as applicable.
3. Revoke active Supabase refresh tokens when account sessions may be exposed.
4. Review metadata-only gateway logs and Supabase usage records by request ID.
5. Patch, code sign, publish a new GitHub release, and notify affected users.
6. Document root cause and add a regression test before restoring the provider.
