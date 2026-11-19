/**
 * The three views of the document: Editor (`visual`: rendered, editable in place, with its
 * review column), Preview (`preview`: rendered, read-only, with no review markup) and Source
 * (`raw`: the markdown itself).
 */
export type MdMode = 'visual' | 'preview' | 'raw';
