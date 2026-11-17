import { Extension } from '@tiptap/core';
import { defaultSelectionBuilder, yCursorPlugin } from '@tiptap/y-tiptap';

export interface CollaborationCursorOptions {
  /** A y-protocols Awareness provider (e.g. HocuspocusProvider). */
  provider: { awareness?: any } | null;
  user: Record<string, any>;
  render: (user: Record<string, any>) => HTMLElement;
  selectionRender: (user: Record<string, any>) => Record<string, any>;
}

export interface CollaborationCursorStorage {
  users: Array<{ clientId: number; [key: string]: any }>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    collaborationCursor: {
      updateUser: (attributes: Record<string, any>) => ReturnType;
    };
  }
}

const awarenessStatesToArray = (states: Map<number, Record<string, any>>) =>
  Array.from(states.entries()).map(([clientId, value]) => ({ clientId, ...value.user }));

/**
 * Tiptap v3 collaboration cursors.
 *
 * The upstream `@tiptap/extension-collaboration-cursor` still depends on
 * `y-prosemirror`, while `@tiptap/extension-collaboration` v3 moved to
 * `@tiptap/y-tiptap`. Mixing the two means `yCursorPlugin` can never find the
 * `ySyncPluginKey` state and crashes ("Cannot read properties of undefined").
 * This 1:1 replacement is built directly on `@tiptap/y-tiptap` so the sync and
 * cursor plugins share one implementation.
 */
export const CollaborationCursor = Extension.create<CollaborationCursorOptions, CollaborationCursorStorage>({
  name: 'collaborationCursor',

  addOptions() {
    return {
      provider: null,
      user: { name: null, color: null },
      render: (user) => {
        const cursor = document.createElement('span');
        cursor.classList.add('collaboration-cursor__caret');
        cursor.setAttribute('style', `border-color: ${user.color}`);

        const label = document.createElement('div');
        label.classList.add('collaboration-cursor__label');
        label.setAttribute('style', `background-color: ${user.color}`);
        label.insertBefore(document.createTextNode(user.name), null);

        cursor.insertBefore(label, null);
        return cursor;
      },
      selectionRender: defaultSelectionBuilder,
    };
  },

  addStorage() {
    return { users: [] };
  },

  addCommands() {
    return {
      updateUser: (attributes) => () => {
        this.options.user = attributes;
        this.options.provider?.awareness?.setLocalStateField('user', this.options.user);
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    const { provider, user, render, selectionRender } = this.options;
    const awareness = provider?.awareness;
    if (!awareness) return [];

    awareness.setLocalStateField('user', user);
    this.storage.users = awarenessStatesToArray(awareness.states as Map<number, Record<string, any>>);
    awareness.on('update', () => {
      this.storage.users = awarenessStatesToArray(awareness.states as Map<number, Record<string, any>>);
    });

    return [
      yCursorPlugin(awareness, {
        cursorBuilder: render,
        selectionBuilder: selectionRender,
      }),
    ];
  },
});
