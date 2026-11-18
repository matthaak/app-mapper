/*
 * Canvas demo — a dev-only page (/canvas.html): the bare diagram editor with a plain toolbar,
 * one permanent root and in-place labels. Not part of the production build.
 */
import '../../theme.css';
import { ARROW, CanvasView } from './index';

const host = document.getElementById('app')!;
host.style.position = 'relative';

const bar = document.createElement('div');
bar.className = 'toolbar';
const button = (text: string, title: string, action: () => void) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.title = title;
  b.addEventListener('click', action);
  bar.append(b);
  return b;
};
const sep = () => bar.append(Object.assign(document.createElement('span'), { className: 'sep' }));

let view: CanvasView;
const run = (f: () => void) => () => {
  view.commitEdit();
  f();
};
const btn = {
  addChild: button('Add Child', 'Add a child to the selected node (Tab)', run(() => view.addChild())),
  reparent: button('Set Parent', 'Pick a new parent for the selected node', run(() => view.toggleReparent())),
  dependency: (sep(), button('Dependency', 'Draw a dependency between two nodes', run(() => view.toggleDependency()))),
  direction: button('', 'Cycle the dependency direction', run(() => view.cycleDirection())),
  rename: (sep(), button('Rename', 'Edit the label (Enter)', run(() => view.rename()))),
  delete: button('Delete', 'Delete the selection (Del)', run(() => view.deleteSelection())),
};
sep();
button('Reset View', 'Fit the whole diagram in view', run(() => view.resetView()));

view = new CanvasView(host, {
  onState: (s) => {
    btn.addChild.disabled = !s.canAddChild;
    btn.reparent.disabled = !s.canReparent;
    btn.reparent.classList.toggle('active', s.mode === 'reparent');
    btn.dependency.classList.toggle('active', s.mode === 'dependency');
    btn.direction.hidden = !s.direction;
    if (s.direction) btn.direction.textContent = `Direction ${ARROW[s.direction]}`;
    btn.rename.disabled = !s.canRename;
    btn.delete.disabled = !s.canDelete;
  },
});
host.append(bar);
if (import.meta.env.DEV) Object.assign(window, { view });
