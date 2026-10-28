import { categoricalColor, inkOn, mix } from '../colors';
import { toLabel, toNumber, toRows } from '../data';
import { createFormatter, humanize, richSafe } from '../format';
import { MAX_CATEGORICAL } from '../tokens';
import type { BuildContext, ChartModel, Datum, TableColumn, ValueFormat } from '../types';
import { baseOption, tooltipBase, tooltipHeader, tooltipRow } from './common';

export interface TreemapConfig {
  data: unknown;
  /** Fields forming the hierarchy, outermost first, e.g. `['region', 'country']`. */
  path: string[];
  value: string;
  format?: ValueFormat;
}

interface TreeNode {
  name: string;
  value: number;
  children?: TreeNode[];
  itemStyle?: Record<string, unknown>;
  label?: Record<string, unknown>;
  upperLabel?: Record<string, unknown>;
}

export function buildTreemap(config: TreemapConfig, ctx: BuildContext): ChartModel {
  const t = ctx.tokens;
  const warnings: string[] = [];
  const fmt = createFormatter(config.format, { locale: ctx.locale, currency: ctx.currency });
  const path = config.path.length > 0 ? config.path : [];

  const root: TreeNode = { name: 'root', value: 0, children: [] };
  const flat: Datum[] = [];
  for (const row of toRows(config.data)) {
    const v = toNumber(row[config.value]);
    if (v === null || v <= 0) continue;
    let node = root;
    const names = path.map((key) => toLabel(row[key], ctx.locale));
    for (const name of names) {
      node.children ??= [];
      let child = node.children.find((c) => c.name === name);
      if (!child) {
        child = { name, value: 0 };
        node.children.push(child);
      }
      child.value += v;
      node = child;
    }
    root.value += v;
    const flatRow: Datum = {};
    path.forEach((key, i) => (flatRow[key] = names[i]));
    flatRow[config.value] = v;
    flat.push(flatRow);
  }

  // Merge duplicate leaf rows (already summed); sort each level largest-first.
  const sortTree = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => b.value - a.value);
    for (const n of nodes) if (n.children) sortTree(n.children);
  };
  const top = root.children ?? [];
  sortTree(top);

  if (top.length > MAX_CATEGORICAL) {
    warnings.push(`${top.length} top-level groups exceed the palette; groups past ${MAX_CATEGORICAL} are neutral gray.`);
  }

  // Color the top level; descendants inherit a slightly lighter step of the same hue.
  const depth = path.length;
  const paint = (node: TreeNode, color: string, level: number) => {
    const fill = level === 0 ? color : mix(color, t.surface, Math.min(0.35, level * 0.15));
    node.itemStyle = { color: fill };
    node.label = { color: inkOn(fill) };
    for (const c of node.children ?? []) paint(c, color, level + 1);
  };
  top.forEach((node, i) => paint(node, categoricalColor(t, i), 0));

  const option = {
    ...baseOption(ctx),
    tooltip: {
      ...tooltipBase(ctx, 'item'),
      formatter: (p: { treePathInfo: { name: string }[]; value: number; color: string }) => {
        const trail = p.treePathInfo
          .slice(1)
          .map((n) => n.name)
          .join(' › ');
        const share = root.value > 0 ? ` · ${((p.value / root.value) * 100).toFixed(1)}%` : '';
        return tooltipHeader(ctx, trail) + tooltipRow(ctx, p.color, `${humanize(config.value)}${share}`, fmt(p.value), 'rect');
      },
    },
    series: [
      {
        type: 'treemap',
        id: 'treemap',
        // Treemap fades labels with its own update duration; honor reduced motion.
        animationDurationUpdate: ctx.animation ? 600 : 0,
        name: humanize(config.value),
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        squareRatio: 0.5 * (1 + Math.sqrt(5)),
        visibleMin: 1,
        label: {
          show: true,
          fontSize: 12,
          fontFamily: ctx.fontFamily,
          overflow: 'truncate',
          ellipsis: '…',
          formatter: (p: { name: string; value: number }) => `${richSafe(p.name)}\n${fmt(p.value)}`,
        },
        itemStyle: { borderColor: t.surface, borderWidth: 0, gapWidth: 2 },
        // levels[0] is the (hidden) root; levels[1] the top groups; levels[2+] their children.
        levels: [
          { itemStyle: { borderWidth: 0, gapWidth: 4, borderColor: t.surface }, upperLabel: { show: false } },
          {
            itemStyle: { borderWidth: depth > 1 ? 2 : 0, gapWidth: 2, borderColor: t.surface },
            upperLabel: {
              show: depth > 1,
              height: 22,
              color: t.ink,
              fontSize: 11,
              fontWeight: 600,
              fontFamily: ctx.fontFamily,
              overflow: 'truncate',
              formatter: (p: { name: string; value: number }) => `${richSafe(p.name)}  ·  ${fmt(p.value)}`,
            },
          },
          { itemStyle: { borderWidth: 1, gapWidth: 1, borderColor: t.surface }, upperLabel: { show: false } },
        ],
        data: top,
      },
    ],
  };

  const columns: TableColumn[] = [
    ...path.map<TableColumn>((key) => ({ key, header: humanize(key), type: 'string' })),
    { key: config.value, header: humanize(config.value), type: 'number', format: config.format, align: 'right' },
  ];

  return { option, isEmpty: top.length === 0, warnings, table: { columns, rows: flat } };
}
