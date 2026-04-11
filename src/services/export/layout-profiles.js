const INCHES_TO_PX = 96;
const POINTS_TO_PX = INCHES_TO_PX / 72;

export const EXPORT_FORMATS = ['standard', 'mobile_9_16'];

export const EXPORT_FONT_STACK = [
  '"Courier New"',
  'Courier',
  '"Noto Sans JP"',
  '"Noto Sans CJK JP"',
  '"Hiragino Sans"',
  '"Yu Gothic"',
  'monospace'
].join(', ');

const buildProfile = ({
  key,
  label,
  filenameLabel,
  pageWidthIn,
  pageHeightIn,
  contentLinesPerPage,
  fontSizePt,
  lineHeightPt,
  pageNumberLeftIn = null,
  pageNumberTopIn = null,
  contentTopIn,
  blockStyles
}) => ({
  key,
  label,
  filenameLabel,
  pageWidthIn,
  pageHeightIn,
  contentLinesPerPage,
  fontSizePt,
  lineHeightPt,
  fontSizePx: fontSizePt * POINTS_TO_PX,
  lineHeightPx: lineHeightPt * POINTS_TO_PX,
  pageNumberLeftIn,
  pageNumberTopIn,
  contentTopIn,
  fontFamily: EXPORT_FONT_STACK,
  fontCssValue: EXPORT_FONT_STACK,
  blockStyles
});

export const EXPORT_LAYOUT_PROFILES = {
  standard: buildProfile({
    key: 'standard',
    label: 'Standard PDF',
    filenameLabel: 'standard',
    pageWidthIn: 8.5,
    pageHeightIn: 11,
    contentLinesPerPage: 55,
    fontSizePt: 12,
    lineHeightPt: 12,
    pageNumberLeftIn: 7.2,
    pageNumberTopIn: 0.5,
    contentTopIn: 1,
    blockStyles: {
      slugline: {
        marginLeftIn: 1.7,
        marginRightIn: 1.1,
        align: 'left',
        transform: 'uppercase',
        pageBreak: 'keep'
      },
      action: {
        marginLeftIn: 1.7,
        marginRightIn: 1.1,
        align: 'left',
        transform: 'preserve',
        pageBreak: 'split'
      },
      dialogue: {
        marginLeftIn: 2.7,
        marginRightIn: 2.4,
        align: 'left',
        transform: 'preserve',
        pageBreak: 'split'
      },
      character: {
        marginLeftIn: 4.1,
        marginRightIn: 1.8,
        align: 'left',
        transform: 'uppercase',
        pageBreak: 'keep'
      },
      parenthetical: {
        marginLeftIn: 3.4,
        marginRightIn: 3.1,
        align: 'left',
        transform: 'preserve',
        pageBreak: 'split'
      },
      transition: {
        marginLeftIn: 6,
        marginRightIn: 1,
        align: 'right',
        transform: 'uppercase',
        pageBreak: 'keep'
      },
      shot: {
        marginLeftIn: 1.7,
        marginRightIn: 1.1,
        align: 'left',
        transform: 'uppercase',
        pageBreak: 'split'
      },
      centered: {
        marginLeftIn: 1.7,
        marginRightIn: 1.1,
        align: 'center',
        transform: 'preserve',
        pageBreak: 'keep'
      }
    }
  }),
  mobile_9_16: buildProfile({
    key: 'mobile_9_16',
    label: '9:16 Mobile PDF',
    filenameLabel: 'mobile',
    pageWidthIn: 6.1875,
    pageHeightIn: 11,
    contentLinesPerPage: 42,
    fontSizePt: 11,
    lineHeightPt: 16,
    contentTopIn: 0.75,
    blockStyles: {
      slugline: {
        marginLeftIn: 0.2,
        marginRightIn: 0.2,
        align: 'left',
        transform: 'uppercase',
        pageBreak: 'keep'
      },
      action: {
        marginLeftIn: 0.2,
        marginRightIn: 0.2,
        align: 'left',
        transform: 'preserve',
        pageBreak: 'split'
      },
      dialogue: {
        marginLeftIn: 0.55,
        marginRightIn: 0.35,
        align: 'left',
        transform: 'preserve',
        pageBreak: 'split'
      },
      character: {
        marginLeftIn: 0.9,
        marginRightIn: 0.35,
        align: 'left',
        transform: 'uppercase',
        pageBreak: 'keep'
      },
      parenthetical: {
        marginLeftIn: 0.72,
        marginRightIn: 0.6,
        align: 'left',
        transform: 'preserve',
        pageBreak: 'split'
      },
      transition: {
        marginLeftIn: 0.2,
        marginRightIn: 0.2,
        align: 'right',
        transform: 'uppercase',
        pageBreak: 'keep'
      },
      shot: {
        marginLeftIn: 0.2,
        marginRightIn: 0.2,
        align: 'left',
        transform: 'uppercase',
        pageBreak: 'split'
      },
      centered: {
        marginLeftIn: 0.4,
        marginRightIn: 0.4,
        align: 'center',
        transform: 'preserve',
        pageBreak: 'keep'
      }
    }
  })
};

export const inchesToPixels = (value) => value * INCHES_TO_PX;

export const pointsToPixels = (value) => value * POINTS_TO_PX;

export const resolveLayoutProfile = (format) => EXPORT_LAYOUT_PROFILES[format] ?? null;

export const resolveBlockLayoutStyle = ({ format, blockType }) => {
  const profile = resolveLayoutProfile(format);

  return profile?.blockStyles?.[blockType] ?? profile?.blockStyles?.action ?? null;
};

