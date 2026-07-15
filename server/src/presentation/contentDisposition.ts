function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

// Node's HTTP implementation rejects non-Latin-1 characters in a header value. Keep the legacy
// filename= parameter strictly printable ASCII and put the real Unicode name into RFC 5987's
// filename*= parameter. Browsers prefer filename*, while old clients still receive a safe fallback.
export function contentDisposition(filename: string, inline: boolean): string {
  const unicodeName = filename.replace(/[\u0000-\u001f\u007f]/g, '_');
  const asciiName =
    unicodeName
      .normalize('NFKD')
      .replace(/[^\x20-\x7e]/g, '_')
      .replace(/["\\/]/g, '_')
      .slice(0, 255) || 'attachment';
  return `${inline ? 'inline' : 'attachment'}; filename="${asciiName}"; filename*=UTF-8''${encodeRfc5987(unicodeName)}`;
}
