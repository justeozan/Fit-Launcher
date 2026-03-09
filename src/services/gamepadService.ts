import { MemoryHistoryWrapper } from '../types/router';

const ROUTES = ['/', '/discovery-page', '/library', '/downloads-page', '/settings'];

const DEADZONE = 0.25;
const REPEAT_DELAY = 400;
const REPEAT_INTERVAL = 150;
const SCROLL_SPEED = 15;
// Penalty multiplier applied to perpendicular distance when scoring candidate
// focus targets – a value > 1 biases navigation toward elements that are more
// directly in line with the chosen direction.
const PERPENDICULAR_WEIGHT = 1.5;

const BUTTONS = {
  A: 0,
  B: 1,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
  DPAD_UP: 12,
  L3: 10,
  LB: 4,
  LT: 6,
  R3: 11,
  RB: 5,
  RT: 7,
  SELECT: 8,
  START: 9,
  X: 2,
  Y: 3,
} as const;

type ButtonId = (typeof BUTTONS)[keyof typeof BUTTONS];

const NAV_BUTTONS: ButtonId[] = [
  BUTTONS.DPAD_UP,
  BUTTONS.DPAD_DOWN,
  BUTTONS.DPAD_LEFT,
  BUTTONS.DPAD_RIGHT,
];

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

type RepeatTimer = {
  delayTimer: ReturnType<typeof setTimeout>;
  intervalTimer: ReturnType<typeof setInterval> | null;
};

export class GamepadService {
  private history: MemoryHistoryWrapper | null = null;
  private animFrameId: number | null = null;
  private prevButtonStates = new Map<number, boolean>();
  private repeatTimers = new Map<number, RepeatTimer>();

  init(history: MemoryHistoryWrapper) {
    this.history = history;
    this.startPolling();
  }

  destroy() {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.clearAllRepeatTimers();
    this.prevButtonStates.clear();
    this.history = null;
  }

  private startPolling() {
    const poll = () => {
      const gamepads = navigator.getGamepads?.();
      if (gamepads) {
        for (const gp of gamepads) {
          if (gp) this.processGamepad(gp);
        }
      }
      this.animFrameId = requestAnimationFrame(poll);
    };
    this.animFrameId = requestAnimationFrame(poll);
  }

  private processGamepad(gp: Gamepad) {
    gp.buttons.forEach((btn, i) => {
      const pressed = btn.pressed;
      const wasPrev = this.prevButtonStates.get(i) ?? false;

      if (pressed && !wasPrev) {
        this.onButtonDown(i as ButtonId);
      } else if (!pressed && wasPrev) {
        this.onButtonUp(i as ButtonId);
      }

      this.prevButtonStates.set(i, pressed);
    });

    // Scroll the main content area using the analog sticks
    this.scrollWithAxes(gp.axes[0] ?? 0, gp.axes[1] ?? 0); // left stick
    this.scrollWithAxes(gp.axes[2] ?? 0, gp.axes[3] ?? 0); // right stick
  }

  private scrollWithAxes(axisX: number, axisY: number) {
    if (Math.abs(axisX) > DEADZONE || Math.abs(axisY) > DEADZONE) {
      const scrollEl = document.getElementById('scrollElement');
      if (scrollEl) {
        scrollEl.scrollBy(axisX * SCROLL_SPEED, axisY * SCROLL_SPEED);
      }
    }
  }

  private onButtonDown(button: ButtonId) {
    this.handleButton(button);

    if ((NAV_BUTTONS as number[]).includes(button)) {
      const delayTimer = setTimeout(() => {
        const intervalTimer = setInterval(() => {
          this.handleButton(button);
        }, REPEAT_INTERVAL);
        // Replace delay-only entry with one that has the active interval
        this.repeatTimers.set(button, { delayTimer, intervalTimer });
      }, REPEAT_DELAY);
      this.repeatTimers.set(button, { delayTimer, intervalTimer: null });
    }
  }

  private onButtonUp(button: ButtonId) {
    this.clearRepeatTimer(button);
  }

  private clearRepeatTimer(button: number) {
    const timer = this.repeatTimers.get(button);
    if (timer) {
      clearTimeout(timer.delayTimer);
      if (timer.intervalTimer !== null) clearInterval(timer.intervalTimer);
      this.repeatTimers.delete(button);
    }
  }

  private clearAllRepeatTimers() {
    this.repeatTimers.forEach((_, btn) => this.clearRepeatTimer(btn));
  }

  private handleButton(button: ButtonId) {
    switch (button) {
      case BUTTONS.A:
        this.confirm();
        break;
      case BUTTONS.B:
        this.goBack();
        break;
      case BUTTONS.LB:
        this.switchTab(-1);
        break;
      case BUTTONS.RB:
        this.switchTab(1);
        break;
      case BUTTONS.DPAD_UP:
        this.moveFocus('up');
        break;
      case BUTTONS.DPAD_DOWN:
        this.moveFocus('down');
        break;
      case BUTTONS.DPAD_LEFT:
        this.moveFocus('left');
        break;
      case BUTTONS.DPAD_RIGHT:
        this.moveFocus('right');
        break;
    }
  }

  private confirm() {
    const focused = document.activeElement as HTMLElement | null;
    if (focused && focused !== document.body) {
      focused.click();
    } else {
      const elements = this.getFocusableElements();
      elements[0]?.focus();
    }
  }

  private goBack() {
    this.history?.back();
  }

  private switchTab(direction: 1 | -1) {
    if (!this.history) return;
    const current = this.history.get();
    const currentIdx = ROUTES.indexOf(current);
    if (currentIdx === -1) return;
    const nextIdx = (currentIdx + direction + ROUTES.length) % ROUTES.length;
    this.history.set({ replace: false, scroll: true, value: ROUTES[nextIdx] });
  }

  private getFocusableElements(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
      if (el.closest('[aria-hidden="true"]')) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')
        return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  }

  private moveFocus(direction: 'down' | 'left' | 'right' | 'up') {
    const elements = this.getFocusableElements();
    if (elements.length === 0) return;

    const focused = document.activeElement as HTMLElement | null;

    if (!focused || !elements.includes(focused)) {
      elements[0]?.focus({ preventScroll: false });
      return;
    }

    const currentRect = focused.getBoundingClientRect();
    const cx = currentRect.left + currentRect.width / 2;
    const cy = currentRect.top + currentRect.height / 2;

    let best: HTMLElement | null = null;
    let bestScore = Infinity;

    for (const el of elements) {
      if (el === focused) continue;
      const rect = el.getBoundingClientRect();
      const ex = rect.left + rect.width / 2;
      const ey = rect.top + rect.height / 2;
      const dx = ex - cx;
      const dy = ey - cy;

      const inDirection =
        (direction === 'right' && dx > 5) ||
        (direction === 'left' && dx < -5) ||
        (direction === 'down' && dy > 5) ||
        (direction === 'up' && dy < -5);

      if (!inDirection) continue;

      const isVertical = direction === 'up' || direction === 'down';
      const primary = isVertical ? Math.abs(dy) : Math.abs(dx);
      const perp = isVertical ? Math.abs(dx) : Math.abs(dy);
      const score = primary + perp * PERPENDICULAR_WEIGHT;

      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }

    if (best) {
      best.focus({ preventScroll: false });
      best.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
}

export const gamepadService = new GamepadService();
