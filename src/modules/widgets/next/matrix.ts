import { h } from '../widget';
import { NxWidget, glyph, momentary } from './base';

export interface NxCheckMatrixOptions {
  rows: string[];
  columns: string[];
  /** values[row][column] */
  values: boolean[][];
  disabled?: boolean;
  onChange?: (row: number, column: number, value: boolean) => void;
}

/** A grid of ✓ / ✕ toggle cells with row labels at the left and column labels below. */
export class NxCheckMatrix extends NxWidget<HTMLDivElement> {
  readonly values: boolean[][];
  private readonly cellEls: HTMLButtonElement[][] = [];

  constructor(o: NxCheckMatrixOptions) {
    super(h('div', { role: 'grid' }), 'nx-matrix');
    this.values = o.values.map((r) => [...r]);
    const n = o.columns.length;

    const rowLabels = h('div', { className: 'nx-matrix-rowlabels' });
    for (const r of o.rows) rowLabels.append(h('span', { textContent: r }));

    const cells = h('div', { className: 'nx-matrix-cells' });
    cells.style.gridTemplateColumns = `repeat(${n}, 41px)`;
    o.rows.forEach((_r, ri) => {
      this.cellEls.push([]);
      o.columns.forEach((_c, ci) => {
        const b = h('button', { type: 'button', className: 'nx-matrix-cell', disabled: !!o.disabled });
        b.setAttribute('aria-label', `${o.rows[ri]} ${o.columns[ci]}`);
        momentary(b, () => {
          this.set(ri, ci, !this.values[ri][ci]);
          o.onChange?.(ri, ci, this.values[ri][ci]);
        });
        this.cellEls[ri].push(b);
        cells.append(b);
        this.draw(ri, ci);
      });
    });

    const colLabels = h('div', { className: 'nx-matrix-collabels' });
    colLabels.style.gridTemplateColumns = `repeat(${n}, 41px)`;
    for (const c of o.columns) colLabels.append(h('span', { textContent: c }));

    this.el.append(rowLabels, cells, h('span'), colLabels);
  }

  set(row: number, column: number, value: boolean): void {
    this.values[row][column] = value;
    this.draw(row, column);
  }

  private draw(r: number, c: number): void {
    const b = this.cellEls[r][c];
    b.replaceChildren(this.values[r][c] ? glyph.check() : glyph.cross());
    b.setAttribute('aria-checked', String(this.values[r][c]));
  }
}
