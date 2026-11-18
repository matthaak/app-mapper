/*
 * Widget gallery — a dev-only page (/widgets.html). The whole page is an NxDesktop laid out
 * like the reference OPENSTEP screenshot, sized to the browser window: the menu and windows
 * sit at the top-left, the dock and Mailboxes on the right, tiles along the bottom.
 * Everything is live: drag windows, menus and tiles; open submenus; click lists, browser
 * columns, the permission matrix, buttons and pop-ups. Actions are logged in the Console.
 * Icons are intentionally left blank (labelled placeholders). Not part of the production build.
 */
import '../../theme.css';
import {
  NxBox,
  NxBrowser,
  NxButton,
  NxCheckMatrix,
  NxClock,
  NxDesktop,
  NxDock,
  NxIconCell,
  NxLabel,
  NxList,
  NxMenu,
  NxPathView,
  NxPopover,
  NxPopUpButton,
  NxSeparator,
  NxShelf,
  NxSplitView,
  NxTable,
  NxTextField,
  NxTextView,
  NxTile,
  NxWindow,
  h,
  pin,
  place,
  type NxBrowserNode,
  type NxTableRow,
} from './index';

/** Where an icon would go: a faint dashed square, so layouts read correctly without art. */
function iconSlot(size = 48, text = ''): HTMLElement {
  const el = h('div', { textContent: text });
  Object.assign(el.style, {
    width: `${size}px`,
    height: `${size}px`,
    border: '1px dashed rgba(0,0,0,.35)',
    display: 'grid',
    placeItems: 'center',
    fontSize: '9px',
    color: 'rgba(0,0,0,.55)',
  });
  return el;
}

/** Tile placeholder: the app's name in small text. */
function tileText(text: string): HTMLElement {
  const el = h('span', { textContent: text });
  Object.assign(el.style, { fontSize: '10px', color: 'rgba(255,255,255,.8)', textShadow: '0 1px rgba(0,0,0,.5)' });
  return el;
}

/** Outline arrow standing in for the Mail up/down icons. */
function arrowLabel(dir: 'up' | 'down'): HTMLElement {
  const el = h('span');
  el.innerHTML = `<svg width="18" height="20" viewBox="0 0 18 20" style="transform:rotate(${dir === 'up' ? 0 : 180}deg)"><path d="M9 1L17 10h-4.5v9h-7v-9H1z" fill="#a0a0a0" stroke="#000"/></svg>`;
  return el;
}

const dir = (name: string, children: (NxBrowserNode | string)[] = []): NxBrowserNode => ({
  name,
  children: children.map((c) => (typeof c === 'string' ? { name: c } : c)),
});

const desk = new NxDesktop().mount(document.getElementById('app')!);
const W = desk.width;
const H = desk.height;
const TILE_ROW = 64; // bottom icon row
const DOCK_X = W - 67; // left edge of the dock column
/** Top-left position that keeps a w×h window inside the area left of the dock, above the tile row. */
const fit = (x: number, y: number, w: number, h: number): [number, number] => [
  Math.max(0, Math.min(x, DOCK_X - w - 4)),
  Math.max(0, Math.min(y, H - TILE_ROW - h - 4)),
];
/** A height that fits between `y` and the tile row, between `min` and `max`. */
const fitHeight = (y: number, max: number, min: number) => Math.max(min, Math.min(max, H - TILE_ROW - y - 6));

// ---- Console panel (where actions are logged) -------------------------------------------
const consoleWin = new NxWindow({ title: 'Console', kind: 'panel', width: 380, height: 132 });
const consoleText = new NxTextView({ text: 'Drag windows by their title bars, menus by their titles, tiles anywhere. Double-click tiles.' });
Object.assign(consoleText.el.style, { position: 'absolute', inset: '6px' });
consoleWin.content.append(consoleText.el);
function log(msg: string): void {
  const t = new Date().toTimeString().slice(0, 8);
  consoleText.text = `${consoleText.text}\n${t}  ${msg}`;
  const v = consoleText.scrollView.viewport;
  v.scrollTop = v.scrollHeight;
  consoleText.scrollView.refresh();
}
{

  // ---- Workspace menu (with a torn-off Disk submenu) -----------------------------------
  let inspector: NxWindow;
  let viewer: NxWindow;
  let buttons: NxWindow;
  const say = (msg: string) => () => log(msg);
  const menu = new NxMenu({
    title: 'Workspace',
    items: [
      { label: 'Info', submenu: [{ label: 'Info Panel...', action: say('Info Panel...') }, { label: 'Preferences...', action: say('Preferences...') }, { label: 'Help...', key: '?', action: say('Help...') }] },
      {
        label: 'File',
        submenu: [
          { label: 'Open', key: 'o', action: say('File ▸ Open') },
          { label: 'New Folder', key: 'n', action: say('File ▸ New Folder') },
          { label: 'Duplicate', key: 'd', action: say('File ▸ Duplicate') },
          { label: 'Compress', action: say('File ▸ Compress') },
          { label: 'Destroy', key: 'r', disabled: true },
        ],
      },
      { label: 'Edit', submenu: [{ label: 'Cut', key: 'x' }, { label: 'Copy', key: 'c', action: say('Edit ▸ Copy') }, { label: 'Paste', key: 'v' }, { label: 'Select All', key: 'a' }] },
      { label: 'Disk', submenu: [{ label: 'Eject', key: 'e', disabled: true }, { label: 'Initialize...', disabled: true }, { label: 'Check for Disks', action: say('Checked for disks: none found') }] },
      { label: 'View', submenu: [{ label: 'Browser', action: say('View ▸ Browser') }, { label: 'Icon', action: say('View ▸ Icon') }, { label: 'Listing', action: say('View ▸ Listing') }] },
      {
        label: 'Tools',
        submenu: [
          { label: 'Inspector...', key: '3', action: () => desk.addWindow(inspector) },
          { label: 'Buttons...', action: () => desk.addWindow(buttons) },
          { label: 'Finder', key: 'f', action: say('Tools ▸ Finder') },
          { label: 'Processes', action: say('Tools ▸ Processes') },
        ],
      },
      {
        label: 'Windows',
        submenu: [
          { label: 'File Viewer', action: () => desk.addWindow(viewer) },
          { label: 'Miniaturize Window', key: 'm', action: () => desk.keyWindow?.miniaturize() },
          { label: 'Close Window', key: 'w', action: () => desk.keyWindow?.close() },
        ],
      },
      {
        label: 'Services',
        submenu: [
          { label: 'Mail', submenu: [{ label: 'Send Selection', action: say('Services ▸ Mail ▸ Send Selection') }, { label: 'Send File', action: say('Services ▸ Mail ▸ Send File') }] },
          { label: 'Grab', submenu: [{ label: 'Screen', action: say('Grab ▸ Screen') }, { label: 'Selection', action: say('Grab ▸ Selection') }] },
        ],
      },
      { label: 'Hide', key: 'h', action: () => (desk.hideAll(), log('Hidden — double-click the NeXT tile to unhide')) },
      { label: 'Log Out', key: 'q', action: say('Log Out (not really)') },
    ],
  });
  desk.place(menu, 0, 0);
  menu.tearOff('Disk', 243, 63);

  // ---- Mail viewer window (behind) ------------------------------------------------------
  const mail = new NxWindow({ title: 'paul — Active.mbox', width: 557, height: 531, minWidth: 260, minHeight: 220 });
  {
    const c = mail.content;
    c.append(
      place(new NxButton({ icon: arrowLabel('up'), iconPosition: 'only', onClick: say('Previous message') }).el, 28, 8, 64, 30),
      place(new NxButton({ icon: arrowLabel('down'), iconPosition: 'only', onClick: say('Next message') }).el, 28, 40, 64, 30),
      place(new NxButton({ label: 'Delete', icon: iconSlot(36), iconPosition: 'above', onClick: say('Deleted message') }).el, 101, 8, 64, 62),
      place(new NxLabel('4435 messages (60.2MB) — 31 deleted', { disabled: true }).el, 10, 78),
    );
    const senders = ['To: list', 'Eliza Doe', 'Eliza Doe', 'Eliza Doe', 'To: Andrew', 'To: Andrew', 'Sam Ruiz', 'Kim Park', 'To: next-prog', 'Lee Wong'];
    const subjects = ['Re: browser columns', 'Lunch Friday?', 'Re: Lunch Friday?', 'Disk quota', 'Re: Rhapsody notes', 'Re: Rhapsody notes', 'NetInfo domains', 'Printer queue', 'IB palettes', 'Weekend backup'];
    const rows: NxTableRow[] = Array.from({ length: 40 }, (_, i) => ({
      cells: [String(4399 + i), i < 4 ? 'Jan 18' : 'Jan 19', senders[i % senders.length], subjects[i % subjects.length]],
      flag: i === 0 ? '△' : '',
      marked: i === 0 || i === 3 || i === 5,
    }));
    const table = new NxTable({
      columns: [{ width: '46px', align: 'right' }, { width: '62px' }, { width: '120px' }, {}],
      rows,
      selected: 4,
      onSelect: (_i, r) => {
        body.text = `Message ${r.cells[0]} from ${r.cells[2]}\nSubject: ${r.cells[3]}\n\n${filler}`;
        log(`Selected message ${r.cells[0]} (Shift-click to add to the lavender selection)`);
      },
    });
    const filler =
      'This is placeholder message text for the widget gallery. The text view is a white, ' +
      'selectable area scrolled by a NeXT scroller on its left edge.\n\nDrag the dimple above ' +
      'this text to give the message list more room, or use the arrow buttons at the bottom ' +
      'of the scroller. Holding an arrow repeats.\n\n' +
      Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 2}. Windows move by their title bars, menus by theirs, and tiles anywhere you grab them.`).join('\n\n');
    const body = new NxTextView({ text: `Message 4403 from To: Andrew\nSubject: Re: Rhapsody notes\n\n${filler}`, editable: true });
    const split = new NxSplitView({ panes: [table, body], sizes: [120] });
    // Pinned to all four sides so the list and text grow and shrink with the window.
    c.append(place(split.el, 10, 94));
    Object.assign(split.el.style, { right: '8px', bottom: '8px' });
  }
  mail.resize(557, fitHeight(153, 531, 260));
  desk.addWindow(mail, ...fit(208, 153, 557, 260), { key: false });

  // ---- File Viewer (key window) ---------------------------------------------------------
  viewer = new NxWindow({ title: 'File Viewer', width: 459, height: 452, minWidth: 300, minHeight: 280 });
  {
    const shelf = new NxShelf();
    for (const [label, x, y] of [['paul', 10, 8], ['tmp', 112, 8], ['LocalApps', 336, 8], ['ibmsaa.art', 336, 74]] as const) {
      shelf.add(new NxIconCell({ label, icon: iconSlot(40), onOpen: () => log(`Opened ${label} from the shelf`) }), x, y);
    }
    const free = new NxLabel('68.6MB available on remote disk', { disabled: true });
    const shelfPane = h('div');
    Object.assign(shelfPane.style, { position: 'relative', display: 'flex', flexDirection: 'column' });
    shelf.el.style.flex = '1';
    free.el.style.padding = '0 0 1px 4px';
    shelfPane.append(shelf.el, free.el);

    const home = dir('home', [
      dir('david', ['notes.txt', 'thesis.rtf']),
      'hard_disk.hdf',
      dir('liz', ['photos', 'todo']),
      dir('mailtest', ['test.mbox']),
      dir('news-archive', ['comp.sys.next', 'comp.lang.objective-c']),
      dir('orders', ['1995-01', '1995-02']),
      dir('paul', [
        'Adv.NetInfo.rtf',
        'AppMan.diagram2',
        dir('Apps', ['Clock.app', 'Edit.app', 'Mail.app']),
        'A.SoftPC.local....',
        dir('Barclays', ['statement.rtf']),
        'Bargains.Propos...',
        'calendar',
        dir('CISMail', ['inbox']),
        dir('CISnews', ['feeds']),
        'cmos.ram',
        dir('Desktop', []),
        dir('Library', ['Fonts', 'Images', 'Sounds']),
        dir('Mailboxes', ['Active.mbox', 'OmniWeb.mbox']),
        'notes.txt',
        'resume.rtf',
        'todo.wn',
      ]),
    ]);
    const path = new NxPathView();
    const showPath = (sel: NxBrowserNode[]) =>
      path.setPath([{ label: 'home', icon: iconSlot(40) }, ...sel.map((n) => ({ label: n.name, icon: iconSlot(40) }))]);
    const browser = new NxBrowser({
      root: home,
      columns: 3,
      path: ['paul', 'Adv.NetInfo.rtf'],
      onSelect: (sel) => {
        showPath(sel);
        const last = sel[sel.length - 1];
        inspectorName.text = last.name;
        inspectorPath.text = `Path:  /${['home', ...sel.slice(0, -1).map((n) => n.name)].join('/')}`;
        log(`Browser: /${['home', ...sel.map((n) => n.name)].join('/')}`);
      },
      onOpen: (sel) => log(`Opened ${sel[sel.length - 1].name}`),
    });
    showPath(browser.selection);
    path.el.style.borderBottom = '1px solid #000';
    const lower = h('div');
    Object.assign(lower.style, { display: 'flex', flexDirection: 'column', border: '1px solid #000', margin: '0 8px 8px' });
    browser.el.style.border = 'none';
    browser.el.style.flex = '1';
    lower.append(path.el, browser.el);

    const split = new NxSplitView({ panes: [shelfPane, lower], sizes: [158] });
    Object.assign(split.el.style, { position: 'absolute', inset: '0' });
    viewer.content.append(split.el);
    viewer.resize(459, fitHeight(70, 452, 300));
  }

  // ---- Attributes Inspector panel -------------------------------------------------------
  inspector = new NxWindow({ title: 'Attributes Inspector', kind: 'panel', width: 274, height: 442 });
  const inspectorName = new NxLabel('Adv.NetInfo.rtf', { size: 'large' });
  const inspectorPath = new NxLabel('Path:  /home/paul');
  {
    const c = inspector.content;
    const mode = new NxPopUpButton({ items: ['Attributes', 'Contents', 'Tools', 'Access Control'], onChange: (v) => (inspector.title = `${v} Inspector`) });
    const group = new NxPopUpButton({ items: ['wheel', 'staff', 'operator', 'other'], onChange: (v) => (dirty(), log(`Group → ${v}`)) });
    const revert = new NxButton({ label: 'Revert', disabled: true, onClick: () => reset() });
    const ok = new NxButton({ label: 'OK', returnKey: true, disabled: true, onClick: () => (commit(), log('Attributes saved')) });
    let saved = [[true, true, true], [true, false, false]];
    const matrix = new NxCheckMatrix({ rows: ['Read', 'Write'], columns: ['Owner', 'Group', 'Other'], values: saved, onChange: () => dirty() });
    const dirty = () => (revert.disabled = ok.disabled = false);
    const clean = () => (revert.disabled = ok.disabled = true);
    const reset = () => {
      saved.forEach((r, ri) => r.forEach((v, ci) => matrix.set(ri, ci, v)));
      group.value = 'wheel';
      clean();
      log('Reverted');
    };
    const commit = () => {
      saved = matrix.values.map((r) => [...r]);
      changed.date = new Date();
      clean();
    };
    const perms = new NxBox('Permissions');
    place(matrix.el, 10, 16);
    perms.body.append(matrix.el);
    const changedBox = new NxBox('Changed');
    const changed = new NxClock({ date: new Date(1995, 3, 22, 18, 30), numerals: 'sans', showYear: true });
    place(changed.el, 6, 10);
    changedBox.body.append(changed.el);

    const sep1 = new NxSeparator();
    const sep2 = new NxSeparator();
    const compute = new NxButton({ label: 'Compute\nSize', icon: iconSlot(24), iconPosition: 'above', disabled: true });
    compute.el.style.whiteSpace = 'pre';
    c.append(
      place(mode.el, 79, 6, 113),
      place(sep1.el, 0, 36, 272),
      place(iconSlot(44), 10, 44),
      place(inspectorName.el, 64, 56),
      place(inspectorPath.el, 8, 98),
      place(sep2.el, 0, 120, 272),
      place(new NxLabel('Link To:', { disabled: true }).el, 6, 146),
      place(new NxLabel('Size:').el, 23, 198),
      place(new NxLabel('30.2KB').el, 60, 198),
      place(new NxLabel('Owner:').el, 13, 223),
      place(new NxLabel('paul').el, 60, 223),
      place(new NxLabel('Group:').el, 13, 249),
      place(group.el, 53, 243, 133),
      place(compute.el, 198, 180, 64, 64),
      place(perms.el, 9, 277, 176, 92),
      place(changedBox.el, 193, 277, 71, 92),
      place(revert.el, 16, 384, 115),
      place(ok.el, 139, 384, 116),
    );
  }

  // ---- Mailboxes panel ------------------------------------------------------------------
  const boxes = new NxWindow({ title: 'Mailboxes', kind: 'panel', width: 186, height: fitHeight(30, 661, 260), resizable: true, minWidth: 186, minHeight: 200 });
  {
    const names = (
      'bbs_post Create Dataphile eof MagicCap MagicDev netinfo-talk nextdoom next-admin:5 next-classroom next-icon next-jobs ' +
      'next-managers NeXT-PPP next-prog nsfip-homebrew nugi nuukvic OmniWeb pdo ph7 procmail PRsite quickbase Radium ' +
      'r-thompson:432 SafetyNet SarNet uk-next-announce uk-next-users:3 uk-riders uk-sun WebObjects WWDC-notes xmas-party zz-archive'
    ).split(' ');
    const items = names.map((n) => {
      const [label, count] = n.split(':');
      return count ? { label, detail: count, dot: true } : { label };
    });
    const name = new NxTextField({ label: 'Name:', value: 'OmniWeb.mbox' });
    const list = new NxList({
      items,
      selected: items.findIndex((i) => i.label === 'OmniWeb'),
      scroll: { horizontal: true },
      onSelect: (_i, it) => (name.value = `${it.label}.mbox`),
      onOpen: (_i, it) => log(`Opened mailbox ${it.label}`),
    });
    // Pinned to the panel's edges, so the list and field widen with it (it is resizable) and the
    // buttons share its width in two columns.
    const left = { left: '8px', width: 'calc(50% - 13px)' };
    const right = { right: '9px', width: 'calc(50% - 13px)' };
    boxes.content.append(
      pin(list.el, { left: '11px', right: '8px', top: '9px', bottom: '109px' }),
      pin(name.el, { left: '8px', right: '8px', bottom: '79px' }),
      pin(new NxButton({ label: 'Delete', onClick: () => log(`Delete ${name.value}?`) }).el, { ...left, bottom: '46px' }),
      pin(new NxButton({ label: 'New', disabled: true }).el, { ...right, bottom: '46px' }),
      pin(new NxButton({ label: 'Open', onClick: () => log(`Opened ${name.value}`) }).el, { ...left, bottom: '14px' }),
      pin(new NxButton({ label: 'Transfer', returnKey: true, onClick: () => log(`Transferred to ${name.value}`) }).el, { ...right, bottom: '14px' }),
    );
  }

  // ---- Buttons panel: push, default, toggle (pushed in when on), disabled, popover ------
  buttons = new NxWindow({ title: 'Buttons', kind: 'panel', width: 262, height: 188 });
  {
    const c = buttons.content;
    const glyph = (body: string) => {
      const t = document.createElement('template');
      t.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">${body}</svg>`;
      return t.content.firstElementChild as SVGSVGElement;
    };
    const letter = (s: string, style: string) => {
      const el = h('span', { textContent: s });
      el.style.font = `${style} 14px/1 Helvetica, Arial, sans-serif`;
      return el;
    };
    const toggle = (o: { label?: string; icon?: Node; on?: boolean; disabled?: boolean; name: string }) => {
      const b = new NxButton({ label: o.label, icon: o.icon, iconPosition: o.icon ? 'only' : undefined, toggle: true, disabled: o.disabled, title: o.name, onClick: (b) => log(`${o.name} ${b.on ? 'on' : 'off'}`) });
      b.on = !!o.on;
      return b.el;
    };
    const tool = (el: HTMLElement, x: number, y: number) => place(el, x, y, 28, 24);
    const pencil = '<path d="M10.5 2.5l3 3-7 7H3.5v-3z" fill="none" stroke="#000" stroke-width="1.3"/><path d="M9 4l3 3" stroke="#000" stroke-width="1.3"/>';
    const tick = '<path d="M2.5 8.5l3.5 4L13.5 3" fill="none" stroke="#000" stroke-width="1.8"/>';
    const cross = '<path d="M3.5 3.5l9 9M12.5 3.5l-9 9" fill="none" stroke="#000" stroke-width="1.8"/>';

    const note = new NxTextField({ placeholder: 'Comment (optional)' });
    const pop = new NxPopover({ title: 'Popover', onDismiss: () => log('Popover dismissed') });
    const popButton = new NxButton({
      label: 'Popover…',
      onClick: () => {
        note.value = '';
        pop.showAt(popButton.el.getBoundingClientRect());
        note.focus();
      },
    });
    const done = (ok: boolean) => {
      pop.close();
      if (ok) log(`Popover OK: “${note.value}”`);
    };
    const row = h('div');
    Object.assign(row.style, { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' });
    new NxButton({ label: 'Cancel', onClick: () => done(false) }).mount(row);
    new NxButton({ label: 'OK', returnKey: true, onClick: () => done(true) }).mount(row);
    const field = note.el;
    field.style.width = '220px';
    pop.setContent(field, row);
    (note.input as HTMLElement).addEventListener('keydown', (e) => e.key === 'Enter' && done(true));
    const hover = new NxPopover({ title: 'Hover card', passive: true, content: 'Passive popovers let the mouse through.' });
    const hoverTarget = new NxButton({ label: 'Hover me' });
    hoverTarget.el.addEventListener('mouseenter', () => hover.showAt(hoverTarget.el.getBoundingClientRect()));
    hoverTarget.el.addEventListener('mouseleave', () => hover.close());

    c.append(
      place(new NxButton({ label: 'Push', onClick: say('Push') }).el, 8, 10, 74),
      place(new NxButton({ label: 'Default', returnKey: true, onClick: say('Default') }).el, 90, 10, 82),
      place(new NxButton({ label: 'Disabled', disabled: true }).el, 180, 10, 74),
      place(toggle({ label: 'Toggle', name: 'Toggle' }), 8, 42, 74),
      place(toggle({ label: 'On', on: true, name: 'Toggle' }), 90, 42, 82),
      place(toggle({ label: 'On', on: true, disabled: true, name: 'Disabled toggle' }), 180, 42, 74),
      place(new NxSeparator().el, 0, 76, 260),
      tool(toggle({ icon: letter('B', 'bold'), name: 'Bold' }), 8, 86),
      tool(toggle({ icon: letter('I', 'italic'), on: true, name: 'Italic' }), 37, 86),
      tool(toggle({ icon: glyph(pencil), on: true, name: 'Track changes' }), 78, 86),
      tool(new NxButton({ icon: glyph(tick), iconPosition: 'only', disabled: true, title: 'Accept (disabled)' }).el, 107, 86),
      tool(new NxButton({ icon: glyph(cross), iconPosition: 'only', disabled: true, title: 'Reject (disabled)' }).el, 136, 86),
      tool(new NxButton({ icon: glyph(tick), iconPosition: 'only', title: 'Accept', onClick: say('Accept') }).el, 177, 86),
      tool(new NxButton({ icon: glyph(cross), iconPosition: 'only', title: 'Reject', onClick: say('Reject') }).el, 206, 86),
      place(new NxSeparator().el, 0, 120, 260),
      place(popButton.el, 8, 132, 110),
      place(hoverTarget.el, 126, 132, 110),
    );
  }

  desk.addWindow(inspector, ...fit(40, 332, 274, 442), { key: false });
  desk.addWindow(boxes, Math.max(0, DOCK_X - 186 - 18), 30, { key: false });
  desk.addWindow(consoleWin, ...fit(330, H, 380, 132), { key: false });
  desk.addWindow(viewer, ...fit(374, 70, 459, 300));
  desk.addWindow(buttons, ...fit(DOCK_X - 186 - 18 - 262 - 8, 30, 262, 188), { key: false });

  // ---- Dock, free tiles, bottom icon row ------------------------------------------------
  const launch = (t: NxTile, name: string) => {
    if (!t.running) {
      t.running = true;
      log(`Launched ${name}`);
    } else log(`${name} is already running`);
  };
  const dockTile = (name: string, running = false, badge = '') => {
    const t = new NxTile({ content: tileText(name), running, badge, title: name, onOpen: () => launch(t, name) });
    return t;
  };
  const nextTile = new NxTile({
    content: tileText('NeXT'),
    title: 'Workspace',
    onOpen: () => (desk.unhideAll(), log('Workspace unhidden')),
  });
  const clockTile = new NxTile({ content: new NxClock({ live: true }), title: 'Clock' });
  const dock = new NxDock([
    nextTile,
    clockTile,
    dockTile('Mail', true, '6'),
    dockTile('Librarian'),
    dockTile('Edit', true),
    dockTile('Mailboxes'),
    dockTile('Terminal', true),
    dockTile('Preferences', true),
    dockTile('OmniWeb', true),
    dockTile('NewsGrazer', true),
  ]);
  desk.place(dock, 3, 0, 'top-right');

  const lamp = new NxTile({ content: tileText('Lamp'), running: false, title: 'Lamp' });
  // Its spot under the dock exists only on tall windows; otherwise it joins the bottom row.
  if (H - 131 - 64 >= dock.tiles.length * 64 + 4) desk.place(lamp, 3, 131, 'bottom-right').draggable();
  else desk.addToBottomRow(lamp);
  desk.place(new NxTile({ content: tileText('Recycler'), title: 'Recycler', onOpen: say('Recycler is empty') }), 3, 4, 'bottom-right').draggable();
  for (const name of ['CPU', 'Spy', 'Agents', 'Mesa', 'Sketch']) {
    desk.addToBottomRow(new NxTile({ content: tileText(name), title: name, onOpen: say(`${name} activated`) }));
  }

  desk.onKeyChange = (w) => w && log(`Key window: ${w.title}`);
}
