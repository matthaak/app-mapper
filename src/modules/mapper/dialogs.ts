import { NxButton, NxLabel, NxTextField, NxWindow, place, type NxDesktop } from '../widgets';
import { showRemembered } from './frames';

/**
 * Shows `win` roughly centered (a little above the middle, as NeXT panels open) — or, given a
 * `name`, where the user last left it.
 */
export function showCentered(desk: NxDesktop, win: NxWindow, w: number, h: number, name?: string): void {
  const x = Math.max(0, (desk.width - w) / 2);
  const y = Math.max(24, (desk.height - h) / 3);
  if (name) showRemembered(desk, win, name, { x, y, width: w, height: h });
  else desk.addWindow(win, x, y);
}

/** A small alert panel with a message and OK. */
export function alertPanel(desk: NxDesktop, title: string, message: string): void {
  const win = new NxWindow({ title, kind: 'panel', width: 360, height: 136 });
  const text = new NxLabel(message);
  text.el.classList.add('mapper-wrap');
  const ok = new NxButton({ label: 'OK', returnKey: true, onClick: () => win.close() });
  win.content.append(place(text.el, 14, 14, 330), place(ok.el, 262, 78, 84));
  showCentered(desk, win, 360, 136);
  ok.el.focus();
}

/**
 * An alert panel with a message and a row of buttons, the last one the default (Return).
 * Resolves with the index of the button pressed, or -1 if the panel was closed. `shown` gets
 * the panel's window (to close it from elsewhere).
 */
export function choicePanel(desk: NxDesktop, title: string, message: string, buttons: string[], shown?: (win: NxWindow) => void): Promise<number> {
  return new Promise((resolve) => {
    const W = 420;
    let answered = false;
    const answer = (i: number) => {
      if (answered) return;
      answered = true;
      win.close();
      resolve(i);
    };
    const win = new NxWindow({ title, kind: 'panel', width: W, height: 140, onClose: () => answer(-1) });
    const text = new NxLabel(message);
    text.el.classList.add('mapper-wrap');
    win.content.append(place(text.el, 14, 14, W - 28));
    showCentered(desk, win, W, 140);
    shown?.(win);
    const textH = Math.max(32, text.el.offsetHeight);
    const top = 14 + textH + 18;
    const btns = buttons.map((label, i) => new NxButton({ label, returnKey: i === buttons.length - 1, onClick: () => answer(i) }));
    win.content.append(...btns.map((b) => b.el));
    // Right to left from the right edge, the default rightmost.
    let x = W - 14;
    for (const b of [...btns].reverse()) {
      const w = Math.max(84, b.el.offsetWidth + 12);
      x -= w;
      place(b.el, x, top, w);
      x -= 8;
    }
    win.resize(W, top + 24 + 14 + (win.el.offsetHeight - win.content.offsetHeight));
    btns[btns.length - 1]?.el.focus();
  });
}

/**
 * A small panel asking for a name (a field, Cancel and the default button `ok`). Resolves with
 * the name typed (trimmed), or null if cancelled or closed.
 */
export function namePanel(desk: NxDesktop, title: string, label: string, ok: string): Promise<string | null> {
  return new Promise((resolve) => {
    let answered = false;
    const answer = (v: string | null) => {
      if (answered) return;
      answered = true;
      win.close();
      resolve(v);
    };
    const win = new NxWindow({ title, kind: 'panel', width: 340, height: 112, onClose: () => answer(null) });
    const commit = () => {
      const v = field.value.trim();
      if (v) answer(v);
    };
    const field = new NxTextField({ label, onCommit: commit });
    win.content.append(
      place(field.el, 14, 14, 312),
      place(new NxButton({ label: 'Cancel', onClick: () => answer(null) }).el, 148, 52, 84),
      place(new NxButton({ label: ok, returnKey: true, onClick: commit }).el, 240, 52, 86),
    );
    showCentered(desk, win, 340, 112);
    field.focus();
  });
}
