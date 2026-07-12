import { escapeHtml } from "../utils/helpers.js";

export function renderHtmlDocument({ subject, emailHtml, config }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(subject || "Generated email")}</title>
  <style>
    body{margin:0;background:#f5f4ef;color:#1d252c;font-family:Arial,Helvetica,sans-serif;}
    .app-shell{max-width:760px;margin:0 auto;padding:24px;}
    .subject{font-size:18px;font-weight:700;margin:0 0 18px 0;color:#1d252c;}
    .email-canvas{background:#fff;border:1px solid #d8dedc;padding:24px;}
    .print-footer{font-size:11px;color:#66736f;margin-top:16px;}
    @media print{
      body{background:#fff;}
      .app-shell{padding:0;max-width:none;}
      .email-canvas{border:0;padding:0;}
      .no-print{display:none!important;}
    }
  </style>
</head>
<body>
  <main class="app-shell">
    <p class="subject">Subject: ${escapeHtml(subject)}</p>
    <section class="email-canvas">${emailHtml}</section>
    <p class="print-footer">${escapeHtml(config.business.printFooter)}</p>
  </main>
</body>
</html>`;
}
