import { h } from '../widget';
import { NxWidget, svg } from './base';

// Seven-segment digit, 7×12 units: segments a–g as line segments.
const SEG: Record<string, [number, number, number, number]> = {
  a: [1.6, 0.8, 5.4, 0.8],
  b: [6.2, 1.6, 6.2, 5.4],
  c: [6.2, 6.6, 6.2, 10.4],
  d: [1.6, 11.2, 5.4, 11.2],
  e: [0.8, 6.6, 0.8, 10.4],
  f: [0.8, 1.6, 0.8, 5.4],
  g: [1.6, 6, 5.4, 6],
};
const DIGITS = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'];
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Green italic LCD time, e.g. " 8:16" (blank tens digit). */
function lcdTime(hours12: number, minutes: number): SVGSVGElement {
  const chars = [hours12 >= 10 ? '1' : ' ', String(hours12 % 10), ':', String(Math.floor(minutes / 10)), String(minutes % 10)];
  let x = 1;
  let body = '';
  for (const ch of chars) {
    if (ch === ':') {
      body += `<rect x="${x}" y="3" width="1.4" height="1.4"/><rect x="${x - 0.8}" y="7.6" width="1.4" height="1.4"/>`;
      x += 3;
      continue;
    }
    if (ch !== ' ') {
      const segs = DIGITS[+ch].split('').map((s) => {
        const [x1, y1, x2, y2] = SEG[s];
        return `<line x1="${x + x1}" y1="${y1}" x2="${x + x2}" y2="${y2}"/>`;
      });
      body += segs.join('');
    }
    x += 8.5;
  }
  return svg(
    `<svg width="${Math.ceil(x)}" height="12" viewBox="0 0 ${Math.ceil(x)} 12" overflow="visible">` +
      `<g transform="translate(1.5 0) skewX(-10)" stroke="#4fc163" fill="#4fc163" stroke-width="1.5" stroke-linecap="round">${body}</g></svg>`,
  );
}

export interface NxClockOptions {
  date?: Date;
  /** Follows the current time, updating every few seconds. */
  live?: boolean;
  /** Serif numerals (Dock clock) or bold sans (Inspector "Changed" clock). */
  numerals?: 'serif' | 'sans';
  /** Shows the year under the calendar page. */
  showYear?: boolean;
}

/** The NeXT clock: green LCD time over a calendar page (day, date, month). */
export class NxClock extends NxWidget<HTMLDivElement> {
  private _date: Date;
  private timer = 0;
  private readonly lcd: HTMLDivElement;
  private readonly dow: HTMLSpanElement;
  private readonly day: HTMLSpanElement;
  private readonly mon: HTMLSpanElement;
  private readonly year?: HTMLSpanElement;

  constructor(o: NxClockOptions = {}) {
    super(h('div', { role: 'img' }), 'nx-clock');
    if (o.numerals === 'sans') this.el.classList.add('sans');
    this.lcd = h('div', { className: 'nx-lcd' });
    const cal = h('div', { className: 'nx-cal' });
    this.dow = h('span', { className: 'nx-cal-dow' });
    this.day = h('span', { className: 'nx-cal-day' });
    this.mon = h('span', { className: 'nx-cal-mon' });
    cal.append(this.dow, this.day, this.mon);
    this.el.append(this.lcd, cal);
    if (o.showYear) {
      this.year = h('span', { className: 'nx-clock-year' });
      this.el.append(this.year);
    }
    this._date = o.date ?? new Date();
    this.draw();
    if (o.live) this.timer = window.setInterval(() => (this.date = new Date()), 5000);
  }

  get date(): Date {
    return this._date;
  }
  set date(d: Date) {
    const changed = d.getMinutes() !== this._date.getMinutes() || d.getDate() !== this._date.getDate();
    this._date = d;
    if (changed) this.draw();
  }

  override destroy(): void {
    clearInterval(this.timer);
    super.destroy();
  }

  private draw(): void {
    const d = this._date;
    const hrs = d.getHours() % 12 || 12;
    const ampm = h('span', { className: 'nx-lcd-ampm', textContent: d.getHours() < 12 ? 'AM' : 'PM' });
    this.lcd.replaceChildren(lcdTime(hrs, d.getMinutes()), ampm);
    this.dow.textContent = DAYS[d.getDay()];
    this.day.textContent = String(d.getDate());
    this.mon.textContent = MONTHS[d.getMonth()];
    if (this.year) this.year.textContent = String(d.getFullYear());
    this.el.setAttribute('aria-label', d.toLocaleString());
  }
}
