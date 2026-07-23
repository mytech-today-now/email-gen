# Versions and compatibility

| Component        | Version   | Compatibility rule                                                          |
| ---------------- | --------- | --------------------------------------------------------------------------- |
| Application      | 2.0.0     | Browser-first persistence release with verified provider-batch capabilities |
| Browser schema   | 4         | Upgraded atomically by IndexedDB; newer unknown schemas are not downgraded  |
| Backup archive   | 1         | Newer archive versions are rejected until an explicit migrator exists       |
| Legacy migration | 1         | SQLite snapshot checksum makes import idempotent                            |
| Walkthrough      | 2         | Completion is offered again only after a major workflow version change      |
| Node.js          | >=22.12.0 | Enforced in `package.json`                                                  |
| npm              | >=10      | npm 11 lockfile is supported                                                |

Supported browsers are current stable Chromium, Firefox, and WebKit/Safari equivalents with IndexedDB, Web Crypto, `AbortController`, and ES modules. Clipboard rich HTML, storage persistence, and OPFS are progressive enhancements with explicit fallback. JavaScript-disabled and obsolete browsers are unsupported.

Application, schema, backup, and migration versions are written to browser/bootstrap metadata and portable manifests. They are deliberately independent so a UI release does not imply a storage rewrite. The current application contract rejects malformed JSON with exact diagnostics, supports legacy subject/body AI responses, preserves browser-owned provider-batch jobs across refresh, and requires complete rendered output before standalone export.
