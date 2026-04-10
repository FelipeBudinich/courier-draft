import { z } from 'zod';

import {
  DUAL_DIALOGUE_BLOCK_TYPE,
  SCENE_DOCUMENT_SCHEMA_VERSION,
  SCENE_TEXT_BLOCK_TYPES
} from './document-constants.js';

const blockIdSchema = z.string().trim().min(1);

export const textBlockSchema = z
  .object({
    id: blockIdSchema,
    type: z.enum(SCENE_TEXT_BLOCK_TYPES),
    text: z.string()
  })
  .strict();

export const dualDialogueSchema = z
  .object({
    id: blockIdSchema,
    type: z.literal(DUAL_DIALOGUE_BLOCK_TYPE),
    left: z.array(textBlockSchema),
    right: z.array(textBlockSchema)
  })
  .strict();

export const sceneBlockSchema = z.union([textBlockSchema, dualDialogueSchema]);

const collectBlockIds = (
  blocks,
  ids = new Set(),
  duplicates = new Set()
) => {
  for (const block of blocks) {
    if (ids.has(block.id)) {
      duplicates.add(block.id);
    }

    ids.add(block.id);

    if (block.type === DUAL_DIALOGUE_BLOCK_TYPE) {
      collectBlockIds(block.left, ids, duplicates);
      collectBlockIds(block.right, ids, duplicates);
    }
  }

  return duplicates;
};

export const canonicalSceneDocumentSchema = z
  .object({
    schemaVersion: z.literal(SCENE_DOCUMENT_SCHEMA_VERSION),
    blocks: z.array(sceneBlockSchema)
  })
  .strict()
  .superRefine((document, ctx) => {
    const duplicates = [...collectBlockIds(document.blocks)];

    for (const duplicateId of duplicates) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate block id "${duplicateId}" found in scene document.`
      });
    }
  });

export const sceneHeadSaveRequestSchema = z
  .object({
    baseHeadRevision: z.number().int().min(0),
    document: z.unknown()
  })
  .strict();

export const parseCanonicalSceneDocument = (input) =>
  canonicalSceneDocumentSchema.parse(input);

export const parseSceneHeadSaveRequest = (input) =>
  sceneHeadSaveRequestSchema.parse(input);
