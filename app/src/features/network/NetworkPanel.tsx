import { useCallback, useMemo, useState } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  buildLineLevelGraph,
  buildNodeLevelGraph,
  type NetworkGraph,
} from '@/core/graph/build-network.ts'
import { layoutGraph } from '@/core/graph/layout.ts'
import type { EventLine, StoredNode } from '@/core/schema/index.ts'

const NODE_W = 220
const NODE_H = 80

/** 边按类型用不同颜色，一眼看出两条线是怎么关联的。 */
const EDGE_COLORS: Record<string, string> = {
  shares_node: '#2563eb',
  shares_character: '#16a34a',
  temporal_overlap: '#a855f7',
  contains: '#94a3b8',
}

function toFlow(graph: NetworkGraph): { nodes: Node[]; edges: Edge[] } {
  const positions = new Map(layoutGraph(graph).map((p) => [p.id, p]))

  const nodes: Node[] = graph.nodes.map((n) => {
    const pos = positions.get(n.id) ?? { x: 0, y: 0 }
    const isLine = n.kind === 'line'
    return {
      id: n.id,
      position: { x: pos.x, y: pos.y },
      data: {
        label: (
          <div className="text-left">
            <div className="truncate text-[12px] font-medium leading-tight">{n.label}</div>
            {n.sublabel && (
              <div className="mt-0.5 line-clamp-2 text-[10px] leading-tight text-neutral-500">
                {n.sublabel}
              </div>
            )}
            <div className="mt-1 flex items-center gap-2 text-[10px] text-neutral-400">
              {isLine && n.nodeCount !== undefined && <span>{n.nodeCount} 个节点</span>}
              {n.chapters.length > 0 && (
                <span>
                  第 {n.chapters[0]}
                  {n.chapters.length > 1 ? `–${n.chapters[n.chapters.length - 1]}` : ''} 章
                </span>
              )}
            </div>
          </div>
        ),
      },
      style: {
        width: NODE_W,
        height: NODE_H,
        borderRadius: 8,
        border: isLine
          ? n.lineStatus === 'closed'
            ? '1.5px solid #cbd5e1'
            : '1.5px solid #2563eb'
          : '1px solid #e2e8f0',
        background: isLine ? '#ffffff' : '#f8fafc',
        padding: '8px 10px',
        fontSize: 12,
      },
    }
  })

  const edges: Edge[] = graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: 'smoothstep',
    animated: e.kind !== 'contains',
    style: { stroke: EDGE_COLORS[e.kind] ?? '#94a3b8', strokeWidth: e.kind === 'contains' ? 1.5 : 1 },
  }))

  return { nodes, edges }
}

export interface NetworkPanelProps {
  lines: EventLine[]
  nodes: StoredNode[]
}

/**
 * 事件网络可视化（ADR-015）。
 *
 * 两级：
 *   **事件线级**（默认）—— 一条线 = 一个节点，像《底特律》那张脉络图
 *   **节点级**（双击某条线进入）—— 该线的节点按时序展开
 */
export function NetworkPanel({ lines, nodes }: NetworkPanelProps) {
  const [drillLineId, setDrillLineId] = useState<string | null>(null)

  const graph = useMemo(() => {
    if (drillLineId) {
      const line = lines.find((l) => l.id === drillLineId)
      if (line) return buildNodeLevelGraph(line, nodes, lines)
    }
    return buildLineLevelGraph(lines, nodes)
  }, [drillLineId, lines, nodes])

  const flow = useMemo(() => toFlow(graph), [graph])

  const onNodeDoubleClick: NodeMouseHandler = useCallback(
    (_evt, node) => {
      // 双击事件线 → 下钻到它的节点
      if (!drillLineId && lines.some((l) => l.id === node.id)) {
        setDrillLineId(node.id)
      }
    },
    [drillLineId, lines],
  )

  if (lines.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-neutral-400">
        还没有事件线。跑完 P3 串联后，这里会显示事件网络。
      </div>
    )
  }

  return (
    <div className="relative h-full">
      {drillLineId && (
        <button
          type="button"
          onClick={() => setDrillLineId(null)}
          className="absolute left-3 top-3 z-10 rounded border border-neutral-300 bg-white px-3 py-1 text-xs shadow-sm hover:bg-neutral-50"
        >
          ← 返回事件线视图
        </button>
      )}

      <div className="pointer-events-none absolute right-3 top-3 z-10 rounded bg-white/90 px-3 py-2 text-[11px] leading-5 text-neutral-600 shadow-sm">
        {drillLineId ? (
          <div>节点级视图 · 双击空白处无操作</div>
        ) : (
          <div>
            事件线级视图 · <strong>双击一条线</strong>可下钻到节点
          </div>
        )}
        <div className="mt-1 flex gap-3">
          <span>
            <i className="mr-1 inline-block h-0.5 w-3 align-middle" style={{ background: EDGE_COLORS.shares_node }} />
            共享节点
          </span>
          <span>
            <i className="mr-1 inline-block h-0.5 w-3 align-middle" style={{ background: EDGE_COLORS.shares_character }} />
            共享人物
          </span>
          <span>
            <i className="mr-1 inline-block h-0.5 w-3 align-middle" style={{ background: EDGE_COLORS.temporal_overlap }} />
            时间重叠
          </span>
        </div>
      </div>

      <ReactFlow
        nodes={flow.nodes}
        edges={flow.edges}
        onNodeDoubleClick={onNodeDoubleClick}
        fitView
        minZoom={0.05}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  )
}
