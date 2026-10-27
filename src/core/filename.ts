const RESERVED_WINDOWS = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/**
 * Makes a string safe as a file name on Windows, macOS and Linux: strips path
 * separators, reserved and control characters, trailing dots/spaces, and
 * Windows device names; caps the length; never returns an empty string.
 */
export function sanitizeFilename(name: string | undefined | null, fallback = 'report'): string {
  let s = String(name ?? '')
    .normalize('NFKC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  if (RESERVED_WINDOWS.test(s)) s = `${s}_`;
  if (s.length > 120) s = s.slice(0, 120).trim();
  return s || fallback;
}

/** `sanitizeFilename` + extension, without doubling an extension that's already there. */
export function withExtension(name: string | undefined | null, ext: string, fallback?: string): string {
  const clean = sanitizeFilename(name, fallback);
  const dotExt = `.${ext.replace(/^\./, '')}`;
  return clean.toLowerCase().endsWith(dotExt.toLowerCase()) ? clean : `${clean}${dotExt}`;
}
