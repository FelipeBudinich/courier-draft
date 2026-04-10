import { Fragment, Slice } from 'prosemirror-model';

import { generateBlockId } from '../../../src/services/scenes/block-ids.js';
import { createTextBlockNode } from './schema.js';

const isInternalClipboardHtml = (html) =>
  html.includes('data-screenplay-block') ||
  html.includes('data-screenplay-dual-dialogue');

const cloneNodeWithFreshIds = (node) => {
  if (node.isText) {
    return node;
  }

  const mappedContent = node.content
    ? Fragment.fromArray(node.content.content.map(cloneNodeWithFreshIds))
    : null;
  const nextAttrs =
    node.type.name === 'screenplay_block' || node.type.name === 'dual_dialogue'
      ? {
          ...node.attrs,
          blockId: generateBlockId()
        }
      : node.attrs;

  return node.type.create(nextAttrs, mappedContent, node.marks);
};

export const createClipboardHandlers = () => ({
  handlePaste(view, event) {
    const html = event.clipboardData?.getData('text/html') ?? '';

    if (html && isInternalClipboardHtml(html)) {
      return false;
    }

    const plainText = event.clipboardData?.getData('text/plain');

    if (typeof plainText !== 'string') {
      return false;
    }

    event.preventDefault();

    const normalizedText = plainText.replace(/\r\n?/g, '\n');
    const lines = normalizedText.split('\n');
    const nodes = lines.map((line) =>
      createTextBlockNode({
        blockType: 'action',
        text: line
      })
    );
    const transaction = view.state.tr.replaceSelection(
      new Slice(Fragment.fromArray(nodes), 0, 0)
    );

    view.dispatch(transaction.scrollIntoView());
    return true;
  },
  transformPasted(slice) {
    return new Slice(
      Fragment.fromArray(slice.content.content.map(cloneNodeWithFreshIds)),
      slice.openStart,
      slice.openEnd
    );
  }
});
