# Performance notes

The configured import maximum is 1,000 records, 100 fields per record, and 12,000 bytes per field. The browser keeps lightweight structured rows in IndexedDB/working memory, paginates the record table, does not load retained artifact Blobs at startup, bounds generation/research concurrency, and debounces catalog filtering. Split resizing updates CSS ratios in animation frames and avoids rebuilding pane content.

Research-specific ceilings are lower than general import ceilings: website research defaults to 8s per request, 20s per job, 3 redirects, 3 contact pages, 1 concurrent page, 1.5 MiB per page, 500 KiB per response, and 3 MiB per job. Google Sheets CSV imports reuse the same bounded network path and the same byte limits, so a large spreadsheet cannot bypass the research fetch policy or fan out into unbounded requests.

Provider, discovery, and Resend HTTP reads now share explicit response-deadline and idle-timeout guards, while browser archive streaming is chunked and backpressured through the worker queue so long exports cannot flood the UI thread with unbounded in-flight chunks.

The automated performance test creates 1,000 records with 38 flattened fields, unions dynamic/prompt-priority columns, filters, and sorts the full set. Its release budget is 1,500 ms in the Node/Vitest environment; the final verification result is recorded with the release test output. Responsive Playwright coverage exercises 20 viewports in each of Chromium, Firefox, and WebKit.

ZIP compression and OPFS writes remain async browser operations. Archives above 20 MiB use OPFS when available, reducing duplicated long-lived in-memory storage; smaller archives stay in memory because worker/OPFS overhead would outweigh the benefit. Provider/research work is never unbounded and each record renders progressively into the result table.
