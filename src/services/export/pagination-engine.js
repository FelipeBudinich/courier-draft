import {
  buildContinuedCharacterText,
  countRemainingBodyLines,
  getDialogueKeepMinimum,
  MORE_MARKER_TEXT,
  takeDialogueBodyChunk
} from './continuation-service.js';
import {
  inchesToPixels,
  resolveBlockLayoutStyle,
  resolveLayoutProfile
} from './layout-profiles.js';

const DUAL_DIALOGUE_BLOCK_TYPE = 'dual_dialogue';

const createPageFrame = ({
  layoutProfile,
  pageNumber
}) => ({
  pageNumber,
  lineSlots: Array.from({ length: layoutProfile.contentLinesPerPage }, () => null),
  usedSlots: 0
});

const cloneLine = (line) => ({
  ...line,
  columns: line.columns
    ? Object.fromEntries(
        Object.entries(line.columns).map(([key, value]) => [
          key,
          value
            ? {
                ...value
              }
            : null
        ])
      )
    : null
});

const buildDocumentModel = ({
  layoutProfile,
  pages,
  blockPageMap,
  scenePageMap
}) => ({
  layout: layoutProfile,
  pages: pages.map((page) => ({
    ...page,
    lineSlots: page.lineSlots.map((line) => (line ? cloneLine(line) : null))
  })),
  blockPageMap,
  scenePageMap
});

const getPage = ({
  pages,
  layoutProfile
}) => {
  if (!pages.length) {
    pages.push(
      createPageFrame({
        layoutProfile,
        pageNumber: 1
      })
    );
  }

  return pages[pages.length - 1];
};

const appendPage = ({
  pages,
  layoutProfile
}) => {
  const page = createPageFrame({
    layoutProfile,
    pageNumber: pages.length + 1
  });
  pages.push(page);
  return page;
};

const getRemainingSlots = ({
  page,
  layoutProfile
}) => layoutProfile.contentLinesPerPage - page.usedSlots;

const updateProvenanceMaps = ({
  line,
  blockPageMap,
  scenePageMap,
  pageNumber
}) => {
  const blockKey = `${line.sceneId}:${line.blockId}`;
  const blockPages = blockPageMap.get(blockKey) ?? {
    firstPageNumber: pageNumber,
    lastPageNumber: pageNumber,
    blockId: line.blockId,
    sceneId: line.sceneId
  };
  blockPages.lastPageNumber = pageNumber;
  blockPageMap.set(blockKey, blockPages);

  const scenePages = scenePageMap.get(line.sceneId) ?? {
    firstPageNumber: pageNumber,
    lastPageNumber: pageNumber,
    sceneId: line.sceneId
  };
  scenePages.lastPageNumber = pageNumber;
  scenePageMap.set(line.sceneId, scenePages);
};

const pushLineToPage = ({
  page,
  layoutProfile,
  line,
  blockPageMap,
  scenePageMap
}) => {
  if (page.usedSlots >= layoutProfile.contentLinesPerPage) {
    throw new Error('Attempted to write past the canonical page limit.');
  }

  const lineWithPageData = {
    ...line,
    pageNumber: page.pageNumber,
    slotIndex: page.usedSlots
  };
  page.lineSlots[page.usedSlots] = lineWithPageData;
  page.usedSlots += 1;

  updateProvenanceMaps({
    line: lineWithPageData,
    blockPageMap,
    scenePageMap,
    pageNumber: page.pageNumber
  });

  return lineWithPageData;
};

const createBaseLine = ({
  block,
  blockType,
  text,
  align,
  marginLeftIn,
  marginRightIn,
  renderVariant = null,
  sceneNumber = null,
  standardPageRange = null
}) => ({
  sceneId: block.sceneId,
  sceneTitle: block.sceneTitle,
  sceneNumber: block.sceneNumber,
  outlineNodeId: block.outlineNodeId,
  actNodeId: block.actNodeId,
  beatNodeId: block.beatNodeId,
  sceneOrder: block.sceneOrder,
  actOrder: block.actOrder,
  beatOrder: block.beatOrder,
  blockId: block.blockId,
  blockType,
  text,
  align,
  marginLeftIn,
  marginRightIn,
  renderVariant,
  displaySceneNumber: sceneNumber,
  standardPageRange
});

const createColumnsLine = ({
  block,
  columns,
  standardPageRange = null
}) => ({
  sceneId: block.sceneId,
  sceneTitle: block.sceneTitle,
  sceneNumber: block.sceneNumber,
  outlineNodeId: block.outlineNodeId,
  actNodeId: block.actNodeId,
  beatNodeId: block.beatNodeId,
  sceneOrder: block.sceneOrder,
  actOrder: block.actOrder,
  beatOrder: block.beatOrder,
  blockId: block.blockId,
  blockType: block.type,
  text: '',
  align: 'left',
  marginLeftIn: 0,
  marginRightIn: 0,
  renderVariant: 'dual_dialogue',
  columns,
  standardPageRange
});

const getWidthForBlock = ({
  layoutProfile,
  blockType,
  overrideMargins = null
}) => {
  const style = overrideMargins ?? resolveBlockLayoutStyle({
    format: layoutProfile.key,
    blockType
  });

  return inchesToPixels(
    layoutProfile.pageWidthIn - style.marginLeftIn - style.marginRightIn
  );
};

const wrapBlockText = async ({
  textMeasure,
  layoutProfile,
  blockType,
  text,
  overrideMargins = null
}) =>
  textMeasure.wrapText({
    text,
    widthPx: getWidthForBlock({
      layoutProfile,
      blockType,
      overrideMargins
    })
  });

const renderSimpleBlockLines = async ({
  block,
  textMeasure,
  layoutProfile,
  standardBlockPageMap = null,
  overrideStyle = null,
  renderVariant = null
}) => {
  const style =
    overrideStyle ??
    resolveBlockLayoutStyle({
      format: layoutProfile.key,
      blockType: block.type
    });
  const lines = await wrapBlockText({
    textMeasure,
    layoutProfile,
    blockType: block.type,
    text: block.text,
    overrideMargins: style
  });
  const standardPageRange =
    block.standardPageRange ??
    standardBlockPageMap?.get(`${block.sceneId}:${block.blockId}`) ??
    null;

  return lines.map((lineText, index) =>
    createBaseLine({
      block,
      blockType: block.type,
      text: lineText,
      align: style.align,
      marginLeftIn: style.marginLeftIn,
      marginRightIn: style.marginRightIn,
      renderVariant: renderVariant ?? block.renderVariant ?? null,
      sceneNumber:
        layoutProfile.key === 'standard' &&
        block.type === 'slugline' &&
        index === 0
          ? block.sceneNumber
          : null,
      standardPageRange
    })
  );
};

const placeKeptBlock = ({
  lines,
  pages,
  layoutProfile,
  blockPageMap,
  scenePageMap
}) => {
  let page = getPage({
    pages,
    layoutProfile
  });

  if (getRemainingSlots({
    page,
    layoutProfile
  }) < lines.length) {
    page = appendPage({
      pages,
      layoutProfile
    });
  }

  lines.forEach((line) => {
    pushLineToPage({
      page,
      layoutProfile,
      line,
      blockPageMap,
      scenePageMap
    });
  });
};

const placeSplittableBlock = ({
  lines,
  pages,
  layoutProfile,
  blockPageMap,
  scenePageMap
}) => {
  let index = 0;

  while (index < lines.length) {
    let page = getPage({
      pages,
      layoutProfile
    });
    let remaining = getRemainingSlots({
      page,
      layoutProfile
    });

    if (!remaining) {
      page = appendPage({
        pages,
        layoutProfile
      });
      remaining = getRemainingSlots({
        page,
        layoutProfile
      });
    }

    const chunk = lines.slice(index, index + remaining);
    chunk.forEach((line) => {
      pushLineToPage({
        page,
        layoutProfile,
        line,
        blockPageMap,
        scenePageMap
      });
    });
    index += chunk.length;
  }
};

const buildDialogueBodyItems = async ({
  blocks,
  textMeasure,
  layoutProfile,
  standardBlockPageMap = null
}) =>
  Promise.all(
    blocks.map(async (block) => ({
      blockId: block.blockId,
      blockType: block.type,
      lines: (
        await renderSimpleBlockLines({
          block,
          textMeasure,
          layoutProfile,
          standardBlockPageMap
        })
      ).map((line) => ({
        ...line
      }))
    }))
  );

const findDialogueSequenceBlocks = ({
  blockStream,
  startIndex
}) => {
  const blocks = [blockStream[startIndex]];
  let index = startIndex + 1;

  while (index < blockStream.length) {
    const nextBlock = blockStream[index];

    if (
      nextBlock.sceneId !== blockStream[startIndex].sceneId ||
      !['parenthetical', 'dialogue'].includes(nextBlock.type)
    ) {
      break;
    }

    blocks.push(nextBlock);
    index += 1;
  }

  return {
    blocks,
    nextIndex: index
  };
};

const placeDialogueSequence = async ({
  sequenceBlocks,
  pages,
  layoutProfile,
  textMeasure,
  blockPageMap,
  scenePageMap,
  standardBlockPageMap = null
}) => {
  const [characterBlock, ...bodyBlocks] = sequenceBlocks;
  const bodyItems = await buildDialogueBodyItems({
    blocks: bodyBlocks,
    textMeasure,
    layoutProfile,
    standardBlockPageMap
  });
  let cursor = {
    itemIndex: 0,
    lineIndex: 0
  };
  let isContinuation = false;

  if (!bodyItems.length) {
    const characterLines = await renderSimpleBlockLines({
      block: characterBlock,
      textMeasure,
      layoutProfile,
      standardBlockPageMap
    });
    placeKeptBlock({
      lines: characterLines,
      pages,
      layoutProfile,
      blockPageMap,
      scenePageMap
    });
    return;
  }

  while (true) {
    let page = getPage({
      pages,
      layoutProfile
    });
    const characterText = isContinuation
      ? buildContinuedCharacterText(characterBlock.text)
      : characterBlock.text;
    const characterLines = await renderSimpleBlockLines({
      block: {
        ...characterBlock,
        text: characterText
      },
      textMeasure,
      layoutProfile,
      standardBlockPageMap
    });
    const totalBodyLines = countRemainingBodyLines({
      items: bodyItems,
      cursor
    });
    const remaining = getRemainingSlots({
      page,
      layoutProfile
    });
    const willContinue = characterLines.length + totalBodyLines > remaining;
    const minimumNeeded =
      characterLines.length +
      getDialogueKeepMinimum({
        items: bodyItems,
        cursor
      }) +
      (willContinue ? 1 : 0);

    if (remaining < minimumNeeded) {
      page = appendPage({
        pages,
        layoutProfile
      });
      continue;
    }

    characterLines.forEach((line) => {
      pushLineToPage({
        page,
        layoutProfile,
        line,
        blockPageMap,
        scenePageMap
      });
    });

    const availableBodySlots =
      getRemainingSlots({
        page,
        layoutProfile
      }) - (willContinue ? 1 : 0);
    const { chunk, cursor: nextCursor } = takeDialogueBodyChunk({
      items: bodyItems,
      cursor,
      capacity: availableBodySlots
    });

    chunk.forEach((line) => {
      pushLineToPage({
        page,
        layoutProfile,
        line,
        blockPageMap,
        scenePageMap
      });
    });

    cursor = nextCursor;

    if (
      countRemainingBodyLines({
        items: bodyItems,
        cursor
      }) > 0
    ) {
      const moreStyle = resolveBlockLayoutStyle({
        format: layoutProfile.key,
        blockType: 'parenthetical'
      });

      pushLineToPage({
        page,
        layoutProfile,
        line: createBaseLine({
          block: characterBlock,
          blockType: 'parenthetical',
          text: MORE_MARKER_TEXT,
          align: moreStyle.align,
          marginLeftIn: moreStyle.marginLeftIn,
          marginRightIn: moreStyle.marginRightIn,
          renderVariant: 'more'
        }),
        blockPageMap,
        scenePageMap
      });

      appendPage({
        pages,
        layoutProfile
      });
      isContinuation = true;
      continue;
    }

    break;
  }
};

const renderDualDialogueSideLines = async ({
  block,
  sideBlocks,
  side,
  textMeasure,
  layoutProfile,
  standardBlockPageMap = null
}) => {
  const columnMarginLeftIn = side === 'left' ? 2.15 : 4.925;
  const baseStyleByType = {
    slugline: {
      marginLeftIn: columnMarginLeftIn,
      marginRightIn: 1.15,
      align: 'left'
    },
    action: {
      marginLeftIn: columnMarginLeftIn,
      marginRightIn: 1.15,
      align: 'left'
    },
    character: {
      marginLeftIn: columnMarginLeftIn + 0.35,
      marginRightIn: 1.15,
      align: 'left'
    },
    parenthetical: {
      marginLeftIn: columnMarginLeftIn + 0.15,
      marginRightIn: 1.35,
      align: 'left'
    },
    dialogue: {
      marginLeftIn: columnMarginLeftIn,
      marginRightIn: 1.15,
      align: 'left'
    }
  };
  const lines = [];

  for (const sideBlock of sideBlocks) {
    const overrideStyle =
      baseStyleByType[sideBlock.type] ?? baseStyleByType.action;
    const standardPageRange =
      standardBlockPageMap?.get(`${block.sceneId}:${sideBlock.id}`) ?? null;
    const wrappedLines = await wrapBlockText({
      textMeasure,
      layoutProfile,
      blockType: sideBlock.type,
      text: sideBlock.text,
      overrideMargins: overrideStyle
    });

    wrappedLines.forEach((lineText) => {
      lines.push({
        sceneId: block.sceneId,
        blockId: block.blockId,
        blockType: sideBlock.type,
        text: lineText,
        align: overrideStyle.align,
        marginLeftIn: overrideStyle.marginLeftIn,
        marginRightIn: overrideStyle.marginRightIn,
        renderVariant: `dual_${side}`,
        standardPageRange
      });
    });
  }

  return lines;
};

const placeDualDialogueBlock = async ({
  block,
  pages,
  layoutProfile,
  textMeasure,
  blockPageMap,
  scenePageMap,
  standardBlockPageMap = null
}) => {
  const [leftLines, rightLines] = await Promise.all([
    renderDualDialogueSideLines({
      block,
      sideBlocks: block.left,
      side: 'left',
      textMeasure,
      layoutProfile,
      standardBlockPageMap
    }),
    renderDualDialogueSideLines({
      block,
      sideBlocks: block.right,
      side: 'right',
      textMeasure,
      layoutProfile,
      standardBlockPageMap
    })
  ]);
  const rowCount = Math.max(leftLines.length, rightLines.length);
  const rows = Array.from({ length: rowCount }, (_, index) =>
    createColumnsLine({
      block,
      columns: {
        left: leftLines[index] ?? null,
        right: rightLines[index] ?? null
      },
      standardPageRange:
        leftLines[index]?.standardPageRange ??
        rightLines[index]?.standardPageRange ??
        null
    })
  );

  placeSplittableBlock({
    lines: rows,
    pages,
    layoutProfile,
    blockPageMap,
    scenePageMap
  });
};

export const paginateCanonicalBlockStream = async ({
  format,
  blockStream,
  textMeasure,
  standardBlockPageMap = null
}) => {
  const layoutProfile = resolveLayoutProfile(format);

  if (!layoutProfile) {
    throw new Error(`Unknown export format "${format}".`);
  }

  const pages = [];
  const blockPageMap = new Map();
  const scenePageMap = new Map();

  for (let index = 0; index < blockStream.length; index += 1) {
    const block = blockStream[index];

    if (block.type === 'character') {
      const sequence = findDialogueSequenceBlocks({
        blockStream,
        startIndex: index
      });

      await placeDialogueSequence({
        sequenceBlocks: sequence.blocks,
        pages,
        layoutProfile,
        textMeasure,
        blockPageMap,
        scenePageMap,
        standardBlockPageMap
      });
      index = sequence.nextIndex - 1;
      continue;
    }

    if (block.type === DUAL_DIALOGUE_BLOCK_TYPE) {
      await placeDualDialogueBlock({
        block,
        pages,
        layoutProfile,
        textMeasure,
        blockPageMap,
        scenePageMap,
        standardBlockPageMap
      });
      continue;
    }

    const lines = await renderSimpleBlockLines({
      block,
      textMeasure,
      layoutProfile,
      standardBlockPageMap
    });
    const style = resolveBlockLayoutStyle({
      format: layoutProfile.key,
      blockType: block.type
    });

    if (style.pageBreak === 'keep') {
      placeKeptBlock({
        lines,
        pages,
        layoutProfile,
        blockPageMap,
        scenePageMap
      });
      continue;
    }

    placeSplittableBlock({
      lines,
      pages,
      layoutProfile,
      blockPageMap,
      scenePageMap
    });
  }

  return buildDocumentModel({
    layoutProfile,
    pages,
    blockPageMap,
    scenePageMap
  });
};
