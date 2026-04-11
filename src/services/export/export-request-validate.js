import { ZodError, z } from 'zod';

import { badRequest } from '../../config/errors.js';
import { EXPORT_FORMATS } from './layout-profiles.js';

const partialSelectionSchema = z
  .object({
    kind: z.literal('partial'),
    actNodeIds: z.array(z.string().startsWith('out_')).optional().default([]),
    sceneIds: z.array(z.string().startsWith('scn_')).optional().default([])
  })
  .superRefine((value, ctx) => {
    if (!value.actNodeIds.length && !value.sceneIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Partial exports must include at least one act or scene.'
      });
    }
  });

const fullSelectionSchema = z.object({
  kind: z.literal('full')
});

const exportRequestSchema = z
  .object({
    format: z.enum(EXPORT_FORMATS),
    selection: z.union([fullSelectionSchema, partialSelectionSchema])
  })
  .superRefine((value, ctx) => {
    if (
      value.selection.kind === 'partial' &&
      !value.selection.actNodeIds.length &&
      !value.selection.sceneIds.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Partial exports must include at least one act or scene.',
        path: ['selection']
      });
    }
  });

export const parseExportRequest = (input) => {
  try {
    return exportRequestSchema.parse(input);
  } catch (error) {
    if (error instanceof ZodError) {
      throw badRequest(error.issues[0]?.message ?? 'Export request validation failed.', {
        issues: error.issues
      });
    }

    throw error;
  }
};
