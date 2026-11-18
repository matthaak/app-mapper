/**
 * Markdown editor module — a two-view (Visual / Raw) markdown editor whose toolbar and tabs
 * come from the widgets module. Demo at `/md-editor.html`.
 *
 * Other modules import from here only, never from files inside this folder.
 */
import './md-editor.css';

export { MarkdownEditor, type MarkdownEditorOptions } from './editor';
export { hasRevisions } from './track';
export type { ActionId } from './actions';
export type { MdMode } from './types';
