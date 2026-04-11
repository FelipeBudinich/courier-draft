import { pointsToPixels } from './layout-profiles.js';

const wrapTextInBrowser = async ({
  page,
  text,
  widthPx,
  fontFamily,
  fontSizePx
}) =>
  page.evaluate(
    ({ inputText, maxWidth, fontFamilyValue, fontSizeValue }) => {
      const canvas =
        globalThis.__courierExportMeasureCanvas ??
        document.createElement('canvas');
      globalThis.__courierExportMeasureCanvas = canvas;
      const context = canvas.getContext('2d');
      context.font = `${fontSizeValue}px ${fontFamilyValue}`;

      const measure = (value) => context.measureText(value).width;
      const graphemeSegmenter =
        globalThis.__courierExportGraphemeSegmenter ??
        new Intl.Segmenter(undefined, {
          granularity: 'grapheme'
        });

      globalThis.__courierExportGraphemeSegmenter = graphemeSegmenter;

      const splitLongToken = (token) => {
        const segments = [];
        let current = '';

        for (const entry of graphemeSegmenter.segment(token)) {
          const grapheme = entry.segment;
          const candidate = current + grapheme;

          if (!current || measure(candidate) <= maxWidth) {
            current = candidate;
            continue;
          }

          segments.push(current);
          current = grapheme;
        }

        if (current) {
          segments.push(current);
        }

        return segments;
      };

      const wrapParagraph = (paragraph) => {
        if (paragraph.length === 0) {
          return [''];
        }

        const tokens = paragraph.match(/(\s+|[^\s]+)/g) ?? [paragraph];
        const lines = [];
        let currentLine = '';

        const pushLine = () => {
          lines.push(currentLine.trimEnd());
          currentLine = '';
        };

        const appendToken = (token) => {
          const normalizedToken = currentLine ? token : token.trimStart();

          if (!normalizedToken) {
            return;
          }

          const candidate = currentLine + normalizedToken;

          if (!currentLine || measure(candidate) <= maxWidth) {
            currentLine = candidate;
            return;
          }

          pushLine();
          currentLine = normalizedToken.trimStart();
        };

        for (const token of tokens) {
          const normalizedToken = currentLine ? token : token.trimStart();

          if (!normalizedToken) {
            continue;
          }

          if (measure(normalizedToken) <= maxWidth) {
            appendToken(token);
            continue;
          }

          const segments = splitLongToken(normalizedToken);

          segments.forEach((segment) => {
            appendToken(segment);
          });
        }

        if (currentLine || !lines.length) {
          pushLine();
        }

        return lines;
      };

      return String(inputText ?? '')
        .split('\n')
        .flatMap((paragraph) => wrapParagraph(paragraph));
    },
    {
      inputText: text,
      maxWidth: widthPx,
      fontFamilyValue: fontFamily,
      fontSizeValue: fontSizePx
    }
  );

export const createPlaywrightTextMeasure = async ({
  context,
  layoutProfile
}) => {
  const page = await context.newPage();
  const cache = new Map();
  await page.setContent('<!doctype html><html><body></body></html>');

  return {
    async wrapText({
      text,
      widthPx
    }) {
      const cacheKey = [
        layoutProfile.key,
        widthPx,
        layoutProfile.fontFamily,
        layoutProfile.fontSizePt,
        text
      ].join('::');

      if (cache.has(cacheKey)) {
        return cache.get(cacheKey);
      }

      const lines = await wrapTextInBrowser({
        page,
        text,
        widthPx,
        fontFamily: layoutProfile.fontFamily,
        fontSizePx: pointsToPixels(layoutProfile.fontSizePt)
      });

      cache.set(cacheKey, lines);
      return lines;
    },
    async close() {
      await page.close();
    }
  };
};

