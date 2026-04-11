const sanitizeAsciiFilenamePart = (value, fallback) => {
  const normalized = String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  return normalized || fallback;
};

export const buildExportFilename = ({
  scriptTitle,
  versionLabel,
  format
}) => {
  const safeUnicodeScriptTitle = String(scriptTitle ?? '')
    .replace(/[\\/:"*?<>|]+/g, '-')
    .trim();
  const safeUnicodeVersionLabel = String(versionLabel ?? '')
    .replace(/[\\/:"*?<>|]+/g, '-')
    .trim();
  const resolvedVersionLabel = String(versionLabel ?? '').trim() || 'draft';
  const resolvedFormatLabel = format === 'mobile_9_16' ? 'mobile' : 'standard';
  const unicodeFilename = `${
    safeUnicodeScriptTitle || 'script'
  }--${
    safeUnicodeVersionLabel || resolvedVersionLabel
  }--${resolvedFormatLabel}.pdf`;
  const asciiFilename = [
    sanitizeAsciiFilenamePart(scriptTitle, 'script'),
    sanitizeAsciiFilenamePart(resolvedVersionLabel, 'draft'),
    resolvedFormatLabel
  ].join('--') + '.pdf';

  return {
    unicodeFilename,
    asciiFilename
  };
};

export const buildContentDisposition = (filenames) =>
  `attachment; filename="${filenames.asciiFilename}"; filename*=UTF-8''${encodeURIComponent(
    filenames.unicodeFilename
  )}`;
