import { init, type EChartsCoreOption, type EChartsType } from 'echarts/core';
import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { registerModules, type EChartsModule } from '../core/modules';

export type EChartEventHandler = (params: unknown, chart: EChartsType) => void;

export interface EChartProps {
  option: EChartsCoreOption;
  /** ECharts modules this option needs (charts, components, renderers). */
  modules: EChartsModule[] | (() => EChartsModule[]);
  height?: number | string;
  renderer?: 'canvas' | 'svg';
  className?: string;
  style?: CSSProperties;
  /** Accessible description; replaces ECharts' auto-generated one. */
  ariaLabel?: string;
  /** ECharts events, e.g. `{ click: (params) => … }`. */
  onEvents?: Record<string, EChartEventHandler>;
  onChartReady?: (chart: EChartsType) => void;
}

/**
 * Low-level ECharts host: lazy init once the element has a size (hidden tabs,
 * collapsed panels), resize via ResizeObserver, full option replacement on
 * change (no stale series), safe disposal, SSR-safe.
 */
export function EChart({
  option,
  modules,
  height = 320,
  renderer = 'canvas',
  className,
  style,
  ariaLabel,
  onEvents,
  onChartReady,
}: EChartProps) {
  const elRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsType | null>(null);

  const finalOption = useMemo<EChartsCoreOption>(() => {
    if (!ariaLabel) return option;
    const aria = (option.aria as Record<string, unknown> | undefined) ?? { enabled: true };
    return { ...option, aria: { ...aria, enabled: true, label: { description: ariaLabel } } };
  }, [option, ariaLabel]);

  const optionRef = useRef(finalOption);
  optionRef.current = finalOption;
  const modulesRef = useRef(modules);
  modulesRef.current = modules;
  const eventsRef = useRef(onEvents);
  eventsRef.current = onEvents;
  const readyRef = useRef(onChartReady);
  readyRef.current = onChartReady;
  const eventNames = Object.keys(onEvents ?? {}).sort().join(',');

  // Binds one dispatcher per event name; handlers are read from a ref so they can change freely.
  const bound = useRef(new Map<string, (params: unknown) => void>());
  const syncEventsRef = useRef(() => {});
  syncEventsRef.current = () => {
    const chart = chartRef.current;
    if (!chart || chart.isDisposed()) return;
    const wanted = new Set(Object.keys(eventsRef.current ?? {}));
    for (const [name, handler] of bound.current) {
      if (!wanted.has(name)) {
        chart.off(name, handler);
        bound.current.delete(name);
      }
    }
    for (const name of wanted) {
      if (bound.current.has(name)) continue;
      const handler = (params: unknown) => eventsRef.current?.[name]?.(params, chart);
      chart.on(name, handler);
      bound.current.set(name, handler);
    }
  };

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const mods = modulesRef.current;
    registerModules(typeof mods === 'function' ? mods() : mods);

    let chart: EChartsType | null = null;
    let frame = 0;
    const create = () => {
      if (chart || el.clientWidth === 0 || el.clientHeight === 0) return;
      chart = init(el, null, { renderer });
      chartRef.current = chart;
      chart.setOption(optionRef.current, { notMerge: true });
      bound.current.clear();
      syncEventsRef.current();
      readyRef.current?.(chart);
    };
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!chart) create();
        else if (!chart.isDisposed()) chart.resize();
      });
    };

    create();
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(onResize);
      observer.observe(el);
    } else {
      window.addEventListener('resize', onResize);
    }
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(frame);
      chart?.dispose();
      chart = null;
      chartRef.current = null;
    };
  }, [renderer]);

  useEffect(() => {
    const chart = chartRef.current;
    if (chart && !chart.isDisposed()) chart.setOption(finalOption, { notMerge: true, lazyUpdate: true });
  }, [finalOption]);

  useEffect(() => {
    syncEventsRef.current();
  }, [eventNames]);

  return (
    <div
      ref={elRef}
      className={className ? `rd-echart ${className}` : 'rd-echart'}
      style={{ width: '100%', height, ...style }}
    />
  );
}
