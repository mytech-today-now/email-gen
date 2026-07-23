# Legacy SQLite migration

The 2.0 browser-first application does not delete or silently adopt the legacy database.

1. Open Configuration → Storage and Backups.
2. Export a browser backup.
3. Choose **Import legacy SQLite data**.
4. Review project/record/result counts and confirm.
5. The browser imports namespaced legacy IDs and records the source checksum.
6. Repeating the same checksum is a no-op. A changed snapshot can be reviewed again.

The server exposes a read-only snapshot with counts and checksum. The browser downloads a pre-migration `.emailgen` backup before its confirmation. Imports use a multi-store transaction and set `migratedAt`; result body, text, research, contacts, and project relationships are retained where available.

The original `storage/email-gen.sqlite` and sidecar files are never removed automatically. Keep them until counts and representative results have been verified and a portable browser backup has been tested.

If migration fails, preserve the error code/request ID, export diagnostics, verify the database is readable by the same OS account, and retry after restarting the loopback server. Browser data written before a failed transaction is rolled back.
