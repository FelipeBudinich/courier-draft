import { describe, expect, it } from 'vitest';

import { paginateCanonicalBlockStream } from '../../src/services/export/pagination-engine.js';
import { buildStandardRenderModel } from '../../src/services/export/standard-render-model.js';

const createMockTextMeasure = () => ({
  async wrapText({ text }) {
    return String(text ?? '').split('\n');
  }
});

let blockSequence = 0;

const createBlock = ({
  sceneId = 'scn_1',
  sceneTitle = 'Scene',
  sceneNumber = '1',
  outlineNodeId = 'out_scene_1',
  actNodeId = 'out_act_1',
  beatNodeId = null,
  sceneOrder = 1,
  actOrder = 1,
  beatOrder = 0,
  type,
  text,
  blockId = `blk_${blockSequence += 1}`
}) => ({
  id: `${sceneId}:${blockId}`,
  sceneId,
  sceneTitle,
  sceneNumber,
  outlineNodeId,
  actNodeId,
  beatNodeId,
  sceneOrder,
  actOrder,
  beatOrder,
  blockId,
  blockOrder: blockSequence,
  type,
  text
});

const repeatedLines = (count, label) =>
  Array.from({ length: count }, (_, index) => `${label} ${index + 1}`).join('\n');

describe('canonical pagination engine', () => {
  it('keeps standard pages within the canonical line budget', async () => {
    const result = await paginateCanonicalBlockStream({
      format: 'standard',
      blockStream: [
        createBlock({
          type: 'action',
          text: repeatedLines(120, 'Action')
        })
      ],
      textMeasure: createMockTextMeasure()
    });

    expect(result.pages).toHaveLength(3);
    expect(result.pages.every((page) => page.usedSlots <= 55)).toBe(true);
    expect(result.pages[0].pageNumber).toBe(1);
  });

  it('moves a character block to the next page instead of orphaning it', async () => {
    const result = await paginateCanonicalBlockStream({
      format: 'standard',
      blockStream: [
        createBlock({
          type: 'action',
          text: repeatedLines(54, 'Action')
        }),
        createBlock({
          type: 'character',
          text: 'MAYA'
        }),
        createBlock({
          type: 'dialogue',
          text: 'One line of dialogue.'
        })
      ],
      textMeasure: createMockTextMeasure()
    });

    expect(result.pages[0].lineSlots[53]?.blockType).toBe('action');
    expect(result.pages[1].lineSlots[0]?.text).toBe('MAYA');
  });

  it("adds (MORE) and CHARACTER (CONT'D) for dialogue that spans pages", async () => {
    const result = await paginateCanonicalBlockStream({
      format: 'standard',
      blockStream: [
        createBlock({
          type: 'action',
          text: repeatedLines(10, 'Action')
        }),
        createBlock({
          type: 'character',
          text: 'MARIA'
        }),
        createBlock({
          type: 'dialogue',
          text: repeatedLines(60, 'Dialogue')
        })
      ],
      textMeasure: createMockTextMeasure()
    });

    expect(result.pages[0].lineSlots[54]?.text).toBe('(MORE)');
    expect(result.pages[1].lineSlots[0]?.text).toBe("MARIA (CONT'D)");
  });

  it('keeps scene headings together when they would otherwise split', async () => {
    const result = await paginateCanonicalBlockStream({
      format: 'standard',
      blockStream: [
        createBlock({
          type: 'action',
          text: repeatedLines(54, 'Action')
        }),
        createBlock({
          type: 'slugline',
          text: 'INT. WRITERS ROOM - DAY\nSECOND HEADING LINE'
        })
      ],
      textMeasure: createMockTextMeasure()
    });

    expect(result.pages[0].lineSlots.some((line) => line?.blockType === 'slugline')).toBe(false);
    expect(result.pages[1].lineSlots[0]?.blockType).toBe('slugline');
  });

  it('preserves original page numbers and in-page placement for partial standard exports', async () => {
    const standardDocumentModel = await paginateCanonicalBlockStream({
      format: 'standard',
      blockStream: [
        createBlock({
          sceneId: 'scn_1',
          sceneNumber: '1',
          type: 'action',
          text: repeatedLines(52, 'Scene One')
        }),
        createBlock({
          sceneId: 'scn_2',
          sceneNumber: '2',
          outlineNodeId: 'out_scene_2',
          sceneOrder: 2,
          type: 'action',
          text: repeatedLines(4, 'Scene Two')
        })
      ],
      textMeasure: createMockTextMeasure()
    });
    const renderModel = buildStandardRenderModel({
      locale: 'en',
      project: {
        id: 'prj_1',
        name: 'Project'
      },
      script: {
        id: 'scr_1',
        title: 'Script'
      },
      titlePage: {
        projectTitle: 'Project',
        scriptTitle: 'Script',
        authors: [],
        exportDateLabel: 'April 10, 2026',
        versionLabel: 'Draft',
        selectionLabel: 'Selected scenes'
      },
      selection: {
        kind: 'partial',
        selectedSceneIdSet: new Set(['scn_2'])
      },
      standardDocumentModel
    });

    expect(renderModel.pages).toHaveLength(2);
    expect(renderModel.pages[0].pageNumber).toBe(1);
    expect(renderModel.pages[0].lineSlots.slice(0, 52).every((line) => line === null)).toBe(true);
    expect(renderModel.pages[0].lineSlots[52]?.sceneId).toBe('scn_2');
    expect(renderModel.pages[1].pageNumber).toBe(2);
  });

  it('carries visible scene numbers onto standard sluglines', async () => {
    const result = await paginateCanonicalBlockStream({
      format: 'standard',
      blockStream: [
        createBlock({
          type: 'slugline',
          sceneNumber: '12A',
          text: 'INT. HALLWAY - NIGHT'
        })
      ],
      textMeasure: createMockTextMeasure()
    });

    expect(result.pages[0].lineSlots[0]?.displaySceneNumber).toBe('12A');
  });
});
