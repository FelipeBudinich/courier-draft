import { emptySceneDocument } from './document-constants.js';
import { parseCanonicalSceneDocument } from './document-schema.js';

const buildTextContentNodes = (text) => {
  if (!text) {
    return [];
  }

  const segments = text.split('\n');
  const content = [];

  segments.forEach((segment, index) => {
    if (segment) {
      content.push({
        type: 'text',
        text: segment
      });
    }

    if (index < segments.length - 1) {
      content.push({ type: 'hard_break' });
    }
  });

  return content;
};

const readTextContent = (content = []) =>
  content
    .map((node) => {
      if (node.type === 'text') {
        return node.text ?? '';
      }

      if (node.type === 'hard_break') {
        return '\n';
      }

      throw new Error(
        `Unsupported editor inline node type "${node.type}".`
      );
    })
    .join('');

const toEditorTextBlockNode = (block) => {
  const content = buildTextContentNodes(block.text);

  return {
    type: 'screenplay_block',
    attrs: {
      blockId: block.id,
      blockType: block.type
    },
    ...(content.length ? { content } : {})
  };
};

const toEditorNode = (block) => {
  if (block.type !== 'dual_dialogue') {
    return toEditorTextBlockNode(block);
  }

  return {
    type: 'dual_dialogue',
    attrs: {
      blockId: block.id
    },
    content: [
      {
        type: 'dual_dialogue_side',
        attrs: { side: 'left' },
        content: block.left.map(toEditorTextBlockNode)
      },
      {
        type: 'dual_dialogue_side',
        attrs: { side: 'right' },
        content: block.right.map(toEditorTextBlockNode)
      }
    ]
  };
};

const fromEditorTextBlockNode = (node) => ({
  id: node.attrs?.blockId,
  type: node.attrs?.blockType,
  text: readTextContent(node.content)
});

const fromEditorNode = (node) => {
  if (node.type === 'screenplay_block') {
    return fromEditorTextBlockNode(node);
  }

  if (node.type === 'dual_dialogue') {
    const [left, right] = node.content ?? [];

    return {
      id: node.attrs?.blockId,
      type: 'dual_dialogue',
      left: (left?.content ?? []).map(fromEditorTextBlockNode),
      right: (right?.content ?? []).map(fromEditorTextBlockNode)
    };
  }

  throw new Error(`Unsupported editor node type "${node.type}".`);
};

const flattenCanonicalBlocksToLines = (blocks, lines = []) => {
  for (const block of blocks) {
    if (block.type === 'dual_dialogue') {
      flattenCanonicalBlocksToLines(block.left, lines);
      flattenCanonicalBlocksToLines(block.right, lines);
      continue;
    }

    lines.push(block.text);
  }

  return lines;
};

export const canonicalToEditorDocument = (canonicalDocument) => {
  const parsedDocument = parseCanonicalSceneDocument(canonicalDocument);

  return {
    type: 'doc',
    content: parsedDocument.blocks.map(toEditorNode)
  };
};

export const editorToCanonicalDocument = (editorDocument) => {
  if (!editorDocument || editorDocument.type !== 'doc') {
    throw new Error('Editor document must be a ProseMirror doc node.');
  }

  const blocks = (editorDocument.content ?? []).map(fromEditorNode);

  return parseCanonicalSceneDocument({
    ...emptySceneDocument(),
    blocks
  });
};

export const canonicalDocumentToPlainText = (document) =>
  flattenCanonicalBlocksToLines(parseCanonicalSceneDocument(document).blocks)
    .join('\n')
    .trimEnd();
