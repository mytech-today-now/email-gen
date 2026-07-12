import { renderPlainText } from "./emailRenderer.js";

export function clipboardPayload(result, config) {
  return {
    subject: result.subject,
    html: result.emailHtml,
    plainText: renderPlainText({
      subject: result.subject,
      bodyHtml: result.bodyHtml,
      addendumHtml: "",
      config
    })
  };
}
