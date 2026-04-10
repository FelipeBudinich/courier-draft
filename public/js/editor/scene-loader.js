const createApiError = (payload, fallbackMessage) => {
  const error = new Error(payload?.error?.message ?? fallbackMessage);
  error.code = payload?.error?.code ?? 'SERVER_ERROR';
  error.details = payload?.error?.details ?? null;
  return error;
};

export const createSceneLoader = ({
  projectId,
  scriptId,
  onBeforeLoad,
  onAfterLoad
}) => {
  const buildApiUrl = (sceneId) =>
    `/api/v1/projects/${projectId}/scripts/${scriptId}/scenes/${sceneId}`;
  const buildEditorUrl = (sceneId) =>
    `/projects/${projectId}/scripts/${scriptId}/editor?sceneId=${sceneId}`;

  const fetchBootstrap = async (sceneId) => {
    const response = await fetch(buildApiUrl(sceneId), {
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json'
      }
    });
    const payload = await response.json();

    if (!response.ok) {
      throw createApiError(payload, 'Failed to load scene bootstrap.');
    }

    return payload.data;
  };

  const loadScene = async (
    sceneId,
    { historyMode = 'push', skipBeforeLoad = false } = {}
  ) => {
    if (!skipBeforeLoad) {
      await onBeforeLoad?.(sceneId);
    }

    const bootstrap = await fetchBootstrap(sceneId);
    onAfterLoad?.(bootstrap);

    const nextUrl = buildEditorUrl(sceneId);

    if (historyMode === 'replace') {
      window.history.replaceState({ sceneId }, '', nextUrl);
    } else {
      window.history.pushState({ sceneId }, '', nextUrl);
    }

    return bootstrap;
  };

  return {
    buildEditorUrl,
    loadScene
  };
};
