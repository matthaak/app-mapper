/**
 * NeXTSTEP-style widgets: windows, menus, controls, scrollers, browser, tabs, popovers, dock
 * tiles, clock.
 * Re-exported from the widgets module's index; import from `modules/widgets`.
 */
import './nx.css';
import './modern.css';

export { nxTheme, setNxTheme, type NxTheme } from './theme';
export { NxWidget, startDrag, momentary, place, pin, type Content, type DragHandlers } from './base';
export { NxDesktop, type Corner } from './desktop';
export { NxWindow, type NxFrame, type NxWindowOptions, type NxWindowState } from './window';
export { NxMenu, type NxMenuItem, type NxMenuOptions } from './menu';
export {
  NxButton,
  NxPopUpButton,
  NxSwitch,
  NxTextField,
  NxLabel,
  NxSeparator,
  NxBox,
  type NxButtonOptions,
  type NxPopUpOptions,
  type NxSwitchOptions,
  type NxTextFieldOptions,
  type NxLabelOptions,
} from './controls';
export { NxScroller, NxScrollView, type NxScrollerOptions, type NxScrollViewOptions } from './scroll';
export {
  NxList,
  NxBrowser,
  NxTable,
  NxTextView,
  type NxListItem,
  type NxListOptions,
  type NxBrowserNode,
  type NxBrowserOptions,
  type NxTableColumn,
  type NxTableRow,
  type NxTableOptions,
  type NxTextViewOptions,
} from './lists';
export { NxSplitView, type NxSplitViewOptions } from './split';
export { NxTabs, type NxTabsOptions } from './tabs';
export { NxPopover, type NxPopoverOptions, type NxRect } from './popover';
export { NxCheckMatrix, type NxCheckMatrixOptions } from './matrix';
export { NxClock, type NxClockOptions } from './clock';
export { NxTile, NxDock, type NxTileOptions } from './tile';
export { NxIconCell, NxShelf, NxPathView, type NxIconCellOptions, type NxPathItem } from './icons';
