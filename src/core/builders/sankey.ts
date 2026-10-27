import { categoricalColor } from '../colors';
import { toLabel, toNumber, toRows } from '../data';
import { createFormatter, humanize } from '../format';
import { MAX_CATEGORICAL } from '../tokens';
import type { BuildContext, ChartModel, Datum, ValueFormat } from '../types';
import { baseOption, tooltipBase, tooltipHeader, tooltipRow, warnOnce } from './common';

export interface SankeyConfig {
  data: unknown;
  source: string;
  target: string;
  value: string;
  format?: ValueFormat;
  nodeAlign?: 'justify' | 'left' | 'right';
}

interface Link {
  source: string;
  target: string;
  value: number;
}

/**
 * Cleans flow data so ECharts never throws: drops self-loops and non-positive
 * flows, sums duplicate links, and removes any link that would close a cycle
 * (a sankey must be a DAG).
 */
export function cleanSankeyLinks(links: Link[], warnings: string[]): Link[] {
  const merged = new Map<string, Link>();
  for (const l of links) {
    if (l.source === l.target) {
      warnOnce(warnings, 'Self-referencing flows were skipped.');
      continue;
    }
    if (!(l.value > 0)) continue;
    const key = `${l.source}\u0000${l.target}`;
    const existing = merged.get(key);
    if (existing) existing.value += l.value;
    else merged.set(key, { ...l });
  }

  const accepted = new Set<Link>();
  const adjacency = new Map<string, Set<string>>();
  const reaches = (from: string, to: string): boolean => {
    const stack = [from];
    const seen = new Set<string>();
    while (stack.length) {
      const node = stack.pop()!;
      if (node === to) return true;
      if (seen.has(node)) continue;
      seen.add(node);
      for (const next of adjacency.get(node) ?? []) stack.push(next);
    }
    return false;
  };
  // Larger flows win when a cycle must be broken.
  for (const l of [...merged.values()].sort((a, b) => b.value - a.value)) {
    if (reaches(l.target, l.source)) {
      warnOnce(warnings, 'Circular flows were detected; the smaller link in each cycle was dropped.');
      continue;
    }
    if (!adjacency.has(l.source)) adjacency.set(l.source, new Set());
    adjacency.get(l.source)!.add(l.target);
    accepted.add(l);
  }
  // Keep the caller's original order for tables and exports.
  return [...merged.values()].filter((l) => accepted.has(l));
}

export function buildSankey(config: SankeyConfig, ctx: BuildContext): ChartModel {
  const t = ctx.tokens;
  const warnings: string[] = [];
  const fmt = createFormatter(config.format, { locale: ctx.locale, currency: ctx.currency });

  const raw: Link[] = [];
  for (const row of toRows(config.data)) {
    const s = row[config.source];
    const g = row[config.target];
    const v = toNumber(row[config.value]);
    if (s === null || s === undefined || g === null || g === undefined || v === null) continue;
    raw.push({ source: toLabel(s, ctx.locale), target: toLabel(g, ctx.locale), value: v });
  }
  const links = cleanSankeyLinks(raw, warnings);

  const nodes: string[] = [];
  for (const l of links) {
    if (!nodes.includes(l.source)) nodes.push(l.source);
    if (!nodes.includes(l.target)) nodes.push(l.target);
  }
  const categorical = nodes.length <= MAX_CATEGORICAL;
  const nodeColor = (i: number) => (categorical ? categoricalColor(t, i) : t.series[0]!);
  const throughput = new Map<string, number>();
  for (const l of links) {
    throughput.set(l.source, (throughput.get(l.source) ?? 0) + l.value);
  }
  for (const l of links) {
    const inbound = links.filter((x) => x.target === l.target).reduce((s, x) => s + x.value, 0);
    throughput.set(l.target, Math.max(throughput.get(l.target) ?? 0, inbound));
  }

  const option = {
    ...baseOption(ctx),
    tooltip: {
      ...tooltipBase(ctx, 'item'),
      formatter: (p: { dataType: 'node' | 'edge'; name: string; data: Link; color: string; value: number }) => {
        if (p.dataType === 'edge') {
          return tooltipHeader(ctx, `${p.data.source} → ${p.data.target}`) + tooltipRow(ctx, p.color, humanize(config.value), fmt(p.data.value), 'rect');
        }
        return tooltipHeader(ctx, p.name) + tooltipRow(ctx, p.color, 'Total flow', fmt(throughput.get(p.name) ?? p.value), 'rect');
      },
    },
    series: [
      {
        type: 'sankey',
        id: 'sankey',
        left: 4,
        right: 120,
        top: 8,
        bottom: 8,
        nodeWidth: 12,
        nodeGap: 10,
        nodeAlign: config.nodeAlign ?? 'justify',
        draggable: false,
        emphasis: { focus: 'adjacency' },
        label: {
          color: t.inkSecondary,
          fontSize: 11,
          fontFamily: ctx.fontFamily,
          width: 112,
          overflow: 'truncate',
        },
        itemStyle: { borderWidth: 0, borderRadius: 2 },
        lineStyle: {
          color: categorical ? 'gradient' : t.axis,
          curveness: 0.5,
          opacity: categorical ? 0.3 : 0.45,
        },
        data: nodes.map((name, i) => ({ name, itemStyle: { color: nodeColor(i) } })),
        links,
      },
    ],
  };

  const rows: Datum[] = links.map((l) => ({
    [config.source]: l.source,
    [config.target]: l.target,
    [config.value]: l.value,
  }));

  return {
    option,
    isEmpty: links.length === 0,
    warnings,
    table: {
      columns: [
        { key: config.source, header: humanize(config.source), type: 'string' },
        { key: config.target, header: humanize(config.target), type: 'string' },
        { key: config.value, header: humanize(config.value), type: 'number', format: config.format, align: 'right' },
      ],
      rows,
    },
  };
}
