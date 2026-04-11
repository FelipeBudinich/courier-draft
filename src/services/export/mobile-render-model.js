import { resolveLayoutProfile } from './layout-profiles.js';

const buildStandardPageReferenceLabel = (pageReferences = []) => {
  if (!pageReferences.length) {
    return null;
  }

  if (pageReferences.length === 1) {
    return `Script p. ${pageReferences[0]}`;
  }

  return `Script pp. ${pageReferences[0]}-${pageReferences[pageReferences.length - 1]}`;
};

export const buildMobileRenderModel = ({
  locale,
  project,
  script,
  titlePage,
  selection,
  mobileDocumentModel
}) => ({
  locale,
  project,
  script,
  titlePage,
  selection,
  layout: resolveLayoutProfile('mobile_9_16'),
  pages: mobileDocumentModel.pages.map((page) => {
    const pageReferences = [
      ...new Set(
        page.lineSlots
          .map((line) =>
            line?.standardPageRange?.firstPageNumber ?? null
          )
          .filter(Boolean)
      )
    ];

    return {
      ...page,
      standardPageReferenceLabel: buildStandardPageReferenceLabel(pageReferences)
    };
  })
});

