import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach } from 'vitest';

describe('Planner two-finger trackpad swipe navigation', () => {
  let plannerCode;
  let plannerCss;
  let compute;

  beforeEach(() => {
    document.body.innerHTML = '';
    plannerCode = fs.readFileSync(path.resolve(__dirname, '../../js/app-planner.js'), 'utf8');
    plannerCss = fs.readFileSync(path.resolve(__dirname, '../../css/app-planner.css'), 'utf8');
    compute = new Function(`
      window.t = function(k) { return k; };
      ${plannerCode}
      return computePlannerWheelSwipe;
    `)();
  });

  const fresh = () => ({ accum: 0, lastEventAt: 0, locked: false });
  // Grid fits the viewport: no native horizontal scrolling available
  const fit = { scrollLeft: 0, scrollWidth: 800, clientWidth: 800 };

  it('ignores vertical-dominant scrolling so native vertical scroll keeps working', () => {
    const s = fresh();
    const r = compute(s, { deltaX: 5, deltaY: 40, now: 1000, ...fit });
    expect(r).toEqual({ direction: 0, handled: false });
  });

  it('navigates forward on a leftward two-finger swipe (positive deltaX)', () => {
    const s = fresh();
    let r = compute(s, { deltaX: 40, deltaY: 2, now: 1000, ...fit });
    expect(r).toEqual({ direction: 0, handled: true });
    r = compute(s, { deltaX: 50, deltaY: 1, now: 1016, ...fit });
    expect(r).toEqual({ direction: 1, handled: true });
  });

  it('navigates backward on a rightward swipe (negative deltaX)', () => {
    const s = fresh();
    compute(s, { deltaX: -50, deltaY: 0, now: 1000, ...fit });
    const r = compute(s, { deltaX: -50, deltaY: 0, now: 1010, ...fit });
    expect(r.direction).toBe(-1);
  });

  it('triggers only one navigation per gesture, including macOS momentum events', () => {
    const s = fresh();
    let navs = 0;
    let now = 1000;
    for (let i = 0; i < 40; i++) {
      now += 16;
      const r = compute(s, { deltaX: 60 - i, deltaY: 0, now, ...fit });
      if (r.direction) navs++;
      expect(r.handled).toBe(true);
    }
    expect(navs).toBe(1);

    // After a pause, a new swipe navigates again
    now += 400;
    compute(s, { deltaX: 50, deltaY: 0, now, ...fit });
    const r = compute(s, { deltaX: 50, deltaY: 0, now: now + 16, ...fit });
    expect(r.direction).toBe(1);
  });

  it('lets native horizontal scroll run while the grid can still scroll, without flipping the date afterwards', () => {
    const s = fresh();
    const scrollable = { scrollLeft: 100, scrollWidth: 1200, clientWidth: 800 };
    const r = compute(s, { deltaX: 90, deltaY: 0, now: 1000, ...scrollable });
    expect(r).toEqual({ direction: 0, handled: false });
    // Edge reached mid-gesture: trailing momentum must not navigate
    const edge = { scrollLeft: 400, scrollWidth: 1200, clientWidth: 800 };
    const r2 = compute(s, { deltaX: 200, deltaY: 0, now: 1016, ...edge });
    expect(r2.direction).toBe(0);
  });

  it('supports Shift + mouse wheel as horizontal navigation and ignores pinch-zoom', () => {
    const s = fresh();
    const r = compute(s, { deltaX: 0, deltaY: 120, shiftKey: true, now: 1000, ...fit });
    expect(r.direction).toBe(1);
    const z = compute(fresh(), { deltaX: 200, deltaY: 0, ctrlKey: true, now: 1000, ...fit });
    expect(z).toEqual({ direction: 0, handled: false });
  });

  it('binds a non-passive wheel listener in renderPlanner and contains overscroll in CSS', () => {
    expect(plannerCode).toMatch(/addEventListener\('wheel', _onPlannerWheelSwipe, \{ passive: false \}\)/);
    expect(plannerCss).toMatch(/\.planner-calendar-scroll\s*\{[^}]*overscroll-behavior-x:\s*contain/);
  });
});
