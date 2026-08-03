# Security Policy

## Supported versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |

## Reporting a vulnerability

Please do **not** open a public issue for security problems. Report privately
by opening a [private vulnerability report](https://github.com/Adam-ZS/tarteel-studio/security/advisories/new)
or by contacting the maintainer directly through GitHub.

You should receive a response within a few days. If the issue is confirmed, a
fix will be released and, where appropriate, the vulnerability disclosed after
users have had a chance to update.

## Known considerations

- The app is designed to run **locally** at `127.0.0.1`. Do not expose the
  local server publicly without adding authentication, HTTPS, rate limiting,
  and secure file isolation — the audio render endpoints accept arbitrary
  uploads and consume CPU.
- The Vercel deployment processes audio in an ephemeral `/tmp` and deletes it
  after the download completes, but it is a public endpoint. Abuse is bounded
  by Vercel's platform limits (4.5 MB request bodies, 300 s function duration).
- Audio effects and presets are original; the project deliberately does not
  clone or impersonate named reciters, and does not certify tajwīd or
  recitation correctness.
