import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

const highlightPluginKey = new PluginKey('noteHighlights');

const resolveTextOffsetToRelativePos = (blockNode, targetOffset) => {
  let consumed = 0;
  let resolved = blockNode.content.size;

  blockNode.forEach((child, offset) => {
    if (resolved !== blockNode.content.size) {
      return;
    }

    if (child.isText) {
      const length = child.text?.length ?? 0;
      if (targetOffset <= consumed + length) {
        resolved = offset + (targetOffset - consumed);
        return;
      }

      consumed += length;
      return;
    }

    if (child.type.name === 'hard_break') {
      if (targetOffset === consumed) {
        resolved = offset;
        return;
      }

      consumed += 1;
      if (targetOffset <= consumed) {
        resolved = offset + child.nodeSize;
      }
    }
  });

  return resolved;
};

const buildBlockIndex = (doc) => {
  const blocks = new Map();

  doc.descendants((node, pos) => {
    if (node.type.name === 'screenplay_block' && node.attrs.blockId) {
      blocks.set(node.attrs.blockId, {
        node,
        pos
      });
    }
  });

  return blocks;
};

const normalizeAnchor = (note) => note.anchor ?? note.anchorSummary ?? null;

const buildDecorations = (doc, notes, activeNoteId) => {
  const blocks = buildBlockIndex(doc);
  const decorations = [];

  for (const note of notes ?? []) {
    const anchor = normalizeAnchor(note);
    if (!anchor || note.isDetached) {
      continue;
    }

    const block = blocks.get(anchor.blockId);
    if (!block) {
      continue;
    }

    const relativeStart = resolveTextOffsetToRelativePos(block.node, anchor.startOffset);
    const relativeEnd = resolveTextOffsetToRelativePos(block.node, anchor.endOffset);
    const from = block.pos + 1 + relativeStart;
    const to = block.pos + 1 + relativeEnd;

    if (to <= from) {
      continue;
    }

    decorations.push(
      Decoration.inline(from, to, {
        class:
          note.id === activeNoteId
            ? 'note-anchor-highlight note-anchor-highlight--active'
            : 'note-anchor-highlight',
        'data-note-highlight': 'true',
        'data-note-id': note.id
      })
    );
  }

  return DecorationSet.create(doc, decorations);
};

export const createNoteHighlightController = ({ onOpenNote }) => {
  const plugin = new Plugin({
    key: highlightPluginKey,
    state: {
      init: (_, state) => ({
        notes: [],
        activeNoteId: null,
        decorations: DecorationSet.empty
      }),
      apply(tr, value) {
        const meta = tr.getMeta(highlightPluginKey);
        if (!meta) {
          return {
            ...value,
            decorations: value.decorations.map(tr.mapping, tr.doc)
          };
        }

        return {
          notes: meta.notes,
          activeNoteId: meta.activeNoteId,
          decorations: buildDecorations(tr.doc, meta.notes, meta.activeNoteId)
        };
      }
    },
    props: {
      decorations(state) {
        return highlightPluginKey.getState(state)?.decorations ?? DecorationSet.empty;
      },
      handleClick(view, _pos, event) {
        const target = event.target.closest?.('[data-note-highlight]');
        if (!target?.dataset?.noteId) {
          return false;
        }

        onOpenNote?.(target.dataset.noteId);
        return true;
      }
    }
  });

  return {
    plugin,
    update(view, { notes = [], activeNoteId = null } = {}) {
      view.dispatch(
        view.state.tr.setMeta(highlightPluginKey, {
          notes,
          activeNoteId
        })
      );
    },
    focusNote(view, note) {
      const anchor = normalizeAnchor(note);
      if (!anchor || note.isDetached) {
        return;
      }

      const blocks = buildBlockIndex(view.state.doc);
      const block = blocks.get(anchor.blockId);
      if (!block) {
        return;
      }

      const relativeStart = resolveTextOffsetToRelativePos(block.node, anchor.startOffset);
      const relativeEnd = resolveTextOffsetToRelativePos(block.node, anchor.endOffset);
      const from = block.pos + 1 + relativeStart;
      const to = block.pos + 1 + relativeEnd;

      if (to <= from) {
        return;
      }

      view.dispatch(
        view.state.tr
          .setSelection(TextSelection.create(view.state.doc, from, to))
          .scrollIntoView()
      );
      view.focus();
    }
  };
};
