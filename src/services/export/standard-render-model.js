import { resolveLayoutProfile } from './layout-profiles.js';

const pageHasSelectedContent = ({
  page,
  selectedSceneIdSet
}) =>
  page.lineSlots.some(
    (line) => line && selectedSceneIdSet.has(line.sceneId)
  );

const filterPageToSelectedScenes = ({
  page,
  selectedSceneIdSet
}) => ({
  ...page,
  lineSlots: page.lineSlots.map((line) =>
    line && selectedSceneIdSet.has(line.sceneId) ? line : null
  )
});

export const buildStandardRenderModel = ({
  locale,
  project,
  script,
  titlePage,
  selection,
  standardDocumentModel
}) => {
  const layout = resolveLayoutProfile('standard');
  const selectedPages =
    selection.kind === 'full'
      ? standardDocumentModel.pages
      : standardDocumentModel.pages
          .filter((page) =>
            pageHasSelectedContent({
              page,
              selectedSceneIdSet: selection.selectedSceneIdSet
            })
          )
          .map((page) =>
            filterPageToSelectedScenes({
              page,
              selectedSceneIdSet: selection.selectedSceneIdSet
            })
          );

  return {
    locale,
    project,
    script,
    titlePage,
    selection,
    layout,
    pages: selectedPages
  };
};

