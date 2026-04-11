import mongoose from 'mongoose';

import { AppError, badRequest } from '../../config/errors.js';
import { logger } from '../../config/logger.js';
import { createActivityEvent } from '../activity/service.js';
import { createAuditLog } from '../audit/service.js';
import { emitScriptActivity } from '../scripts/helpers.js';
import { assembleCanonicalScriptBlocks, loadCanonicalScriptExportContext } from './script-content-assemble.js';
import { buildContentDisposition, buildExportFilename } from './export-filename-service.js';
import { parseExportRequest } from './export-request-validate.js';
import { resolveExportSelection } from './export-selection-service.js';
import { buildMobileRenderModel } from './mobile-render-model.js';
import { paginateCanonicalBlockStream } from './pagination-engine.js';
import { resolveLayoutProfile } from './layout-profiles.js';
import { renderPdfFromHtml, withPdfBrowserContext } from './pdf-render-service.js';
import { buildStandardRenderModel } from './standard-render-model.js';
import { renderExportTemplate } from './template-render-service.js';
import { createPlaywrightTextMeasure } from './text-measure.js';
import { buildTitlePageModel } from './title-page-service.js';

const EXPORT_TIMEOUT_MS = 60_000;

const withTimeout = async (promise, timeoutMs, timeoutMessage) => {
  let timeoutHandle = null;

  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(
            new AppError({
              statusCode: 503,
              code: 'EXPORT_TIMEOUT',
              message: timeoutMessage
            })
          );
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};

const classifyExportError = (error) => {
  if (error instanceof AppError) {
    return error;
  }

  const message = String(error?.message ?? '');

  if (/Executable doesn't exist|browserType\.launch|Failed to launch/i.test(message)) {
    return new AppError({
      statusCode: 503,
      code: 'EXPORT_RUNTIME_UNAVAILABLE',
      message: 'PDF export is unavailable because the browser runtime is not ready.'
    });
  }

  return new AppError({
    statusCode: 500,
    code: 'EXPORT_FAILED',
    message: 'PDF export failed. Please try again in a moment.'
  });
};

const buildMobileBlockStream = ({
  blockStream,
  selection,
  standardBlockPageMap
}) =>
  blockStream
    .filter((block) =>
      selection.kind === 'full' ? true : selection.selectedSceneIdSet.has(block.sceneId)
    )
    .flatMap((block) => {
      const standardPageRange =
        standardBlockPageMap.get(`${block.sceneId}:${block.blockId}`) ?? null;

      if (block.type !== 'dual_dialogue') {
        return [
          {
            ...block,
            standardPageRange
          }
        ];
      }

      const leftBlocks = block.left.map((sideBlock) => ({
        ...block,
        blockId: `${block.blockId}:${sideBlock.id}:left`,
        type: sideBlock.type,
        text: sideBlock.text,
        renderVariant: 'dual_left',
        standardPageRange
      }));
      const rightBlocks = block.right.map((sideBlock) => ({
        ...block,
        blockId: `${block.blockId}:${sideBlock.id}:right`,
        type: sideBlock.type,
        text: sideBlock.text,
        renderVariant: 'dual_right',
        standardPageRange
      }));

      return [...leftBlocks, ...rightBlocks];
    });

const createExportActivityAndAudit = async ({
  project,
  script,
  actor,
  exportRequest,
  selection
}) => {
  let activityEvent = null;

  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      activityEvent = await createActivityEvent({
        projectId: project._id,
        actorId: actor._id,
        type: 'script.exported',
        message: `${actor.displayName} exported ${script.title} as ${exportRequest.format === 'mobile_9_16' ? 'a 9:16 mobile PDF' : 'a standard PDF'}.`,
        payload: {
          targetType: 'script',
          targetId: script.publicId,
          scriptId: script.publicId,
          format: exportRequest.format,
          selectionKind: selection.kind,
          selectedActCount: selection.selectedActCount,
          selectedSceneCount: selection.selectedSceneCount,
          versionLabel: script.currentVersionLabel ?? 'Draft'
        },
        session
      });

      await createAuditLog({
        scope: 'project',
        projectId: project._id,
        actorId: actor._id,
        action: 'script.exported',
        targetType: 'script',
        targetId: script.publicId,
        metadata: {
          title: script.title,
          format: exportRequest.format,
          selectionKind: selection.kind,
          selectedActCount: selection.selectedActCount,
          selectedSceneCount: selection.selectedSceneCount,
          versionLabel: script.currentVersionLabel ?? 'Draft'
        },
        session
      });
    });
  } finally {
    await session.endSession();
  }

  emitScriptActivity({
    projectPublicId: project.publicId,
    scriptPublicId: script.publicId,
    activityEvent,
    actor
  });
};

export const exportScriptPdf = async ({
  project,
  script,
  actor,
  locale,
  input,
  requestId = null
}) => {
  try {
    const exportRequest = parseExportRequest(input);
    const exportDate = new Date();
    const exportContext = await loadCanonicalScriptExportContext({
      project,
      script
    });

    if (!exportContext.canonicalSceneEntries.length) {
      throw badRequest('This script has no scenes to export.');
    }

    const selection = resolveExportSelection({
      selection: exportRequest.selection,
      outlineNodes: exportContext.outlineNodes,
      canonicalSceneEntries: exportContext.canonicalSceneEntries
    });
    const assembly = await assembleCanonicalScriptBlocks({
      canonicalSceneEntries: exportContext.canonicalSceneEntries
    });
    const titlePage = buildTitlePageModel({
      project,
      script,
      locale,
      exportDate,
      selection
    });
    const filenames = buildExportFilename({
      scriptTitle: script.title,
      versionLabel: script.currentVersionLabel ?? 'Draft',
      format: exportRequest.format
    });

    const pdfBuffer = await withTimeout(
      withPdfBrowserContext(async ({ context }) => {
        const standardTextMeasure = await createPlaywrightTextMeasure({
          context,
          layoutProfile: resolveLayoutProfile('standard')
        });
        let mobileTextMeasure = null;

        try {
          const standardDocumentModel = await paginateCanonicalBlockStream({
            format: 'standard',
            blockStream: assembly.blockStream,
            textMeasure: standardTextMeasure
          });

          if (exportRequest.format === 'standard') {
            const renderModel = buildStandardRenderModel({
              locale,
              project,
              script,
              titlePage,
              selection,
              standardDocumentModel
            });
            const html = await renderExportTemplate({
              templateName: 'export/standard-pdf.njk',
              templateContext: renderModel,
              cssFiles: ['public/css/export-screenplay.css']
            });

            return renderPdfFromHtml({
              context,
              html,
              layoutProfile: standardDocumentModel.layout
            });
          }

          mobileTextMeasure = await createPlaywrightTextMeasure({
            context,
            layoutProfile: resolveLayoutProfile('mobile_9_16')
          });

          const mobileDocumentModel = await paginateCanonicalBlockStream({
            format: 'mobile_9_16',
            blockStream: buildMobileBlockStream({
              blockStream: assembly.blockStream,
              selection,
              standardBlockPageMap: standardDocumentModel.blockPageMap
            }),
            textMeasure: mobileTextMeasure,
            standardBlockPageMap: standardDocumentModel.blockPageMap
          });
          const renderModel = buildMobileRenderModel({
            locale,
            project,
            script,
            titlePage,
            selection,
            mobileDocumentModel
          });
          const html = await renderExportTemplate({
            templateName: 'export/mobile-pdf.njk',
            templateContext: renderModel,
            cssFiles: ['public/css/export-mobile.css']
          });

          return renderPdfFromHtml({
            context,
            html,
            layoutProfile: mobileDocumentModel.layout
          });
        } finally {
          await standardTextMeasure.close();

          if (mobileTextMeasure) {
            await mobileTextMeasure.close();
          }
        }
      }),
      EXPORT_TIMEOUT_MS,
      'PDF export timed out. Please try again.'
    );

    await createExportActivityAndAudit({
      project,
      script,
      actor,
      exportRequest,
      selection
    });

    return {
      format: exportRequest.format,
      pdfBuffer,
      contentDisposition: buildContentDisposition(filenames),
      filename: filenames.unicodeFilename
    };
  } catch (error) {
    if (error?.statusCode && error.statusCode < 500) {
      throw error;
    }

    const classifiedError = classifyExportError(error);

    logger.error(
      {
        err: error,
        requestId,
        userId: actor.publicId,
        projectId: project.publicId,
        scriptId: script.publicId,
        exportErrorCode: classifiedError.code
      },
      'Script PDF export failed'
    );

    throw classifiedError;
  }
};
