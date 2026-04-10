export const SCENE_DOCUMENT_SCHEMA_VERSION = 1;

export const SCENE_TEXT_BLOCK_TYPES = [
  'slugline',
  'action',
  'character',
  'parenthetical',
  'dialogue',
  'transition',
  'shot',
  'centered'
];

export const DUAL_DIALOGUE_BLOCK_TYPE = 'dual_dialogue';

export const SCENE_BLOCK_TYPES = [
  ...SCENE_TEXT_BLOCK_TYPES,
  DUAL_DIALOGUE_BLOCK_TYPE
];

export const SCENE_BLOCK_TYPE_ORDER = [...SCENE_TEXT_BLOCK_TYPES];

export const DEFAULT_BLOCK_TYPE = 'action';

export const NEXT_BLOCK_TYPE_BY_CONTEXT = {
  slugline: 'action',
  action: 'action',
  character: 'dialogue',
  parenthetical: 'dialogue',
  dialogue: 'character',
  transition: 'slugline',
  shot: 'action',
  centered: 'action'
};

export const UPPERCASE_BLOCK_TYPES = new Set([
  'slugline',
  'character',
  'transition',
  'shot'
]);

export const emptySceneDocument = () => ({
  schemaVersion: SCENE_DOCUMENT_SCHEMA_VERSION,
  blocks: []
});
