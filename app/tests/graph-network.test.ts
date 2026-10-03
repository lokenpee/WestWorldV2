import { describe, expect, it } from 'vitest'
import {
  buildLineLevelGraph,
  buildNodeLevelGraph,
  topByDegree,
} from '../src/core/graph/build-network.ts'
import { layoutGraph } from '../src/core/graph/layout.ts'
import type { EventLine, StoredNode } from '../src/core/schema/index.ts'

function line(id: string, over: Partial<EventLine> = {}): EventLine {
  return {
    id,
    bookId: 'bk',
    title: `线${id}`,
    nodeIds: [],
    chapters: [],
    cause: '',
    process: '',
    result: '',
    lineStatus: 'open',
    characterIds: [],
    updatedAt: '',
    ...over,
  }
}

function node(id: string, chapterIndex: string, order = 0): StoredNode {
  return {
    id,
    bookId: 'bk',
    chapterIndex,
    chapterName: `第${chapterIndex}章`,
    order,
    name: `节点${id}`,
    summary: 's',
    actors: [],
    quote: 'q',
    confidence: 0.9,
    createdBy: 'P1',
  }
}

describe('事件线级图：边由代码推导（PRD 1.5）', () => {
  it('共享节点 → shares_node', () => {
    const g = buildLineLevelGraph(
      [
        line('L01', { nodeIds: ['n1', 'n2'], chapters: ['1'] }),
        line('L02', { nodeIds: ['n2', 'n3'], chapters: ['1'] }),
      ],
      [],
    )
    expect(g.edges).toHaveLength(1)
    expect(g.edges[0]?.kind).toBe('shares_node')
  })

  it('共享人物 → shares_character', () => {
    const g = buildLineLevelGraph(
      [
        line('L01', { nodeIds: ['a'], characterIds: ['P001'], chapters: ['1'] }),
        line('L02', { nodeIds: ['b'], characterIds: ['P001'], chapters: ['1'] }),
      ],
      [],
    )
    expect(g.edges[0]?.kind).toBe('shares_character')
  })

  it('章节区间重叠 → temporal_overlap', () => {
    const g = buildLineLevelGraph(
      [
        line('L01', { nodeIds: ['a'], characterIds: ['P001'], chapters: ['1', '10'] }),
        line('L02', { nodeIds: ['b'], characterIds: ['P002'], chapters: ['5', '20'] }),
      ],
      [],
    )
    expect(g.edges[0]?.kind).toBe('temporal_overlap')
  })

  it('优先级：有共享节点就不再加共享人物边（避免一堆平行边）', () => {
    const g = buildLineLevelGraph(
      [
        line('L01', { nodeIds: ['n1'], characterIds: ['P001'], chapters: ['1'] }),
        line('L02', { nodeIds: ['n1'], characterIds: ['P001'], chapters: ['1'] }),
      ],
      [],
    )
    expect(g.edges).toHaveLength(1)
    expect(g.edges[0]?.kind).toBe('shares_node')
  })

  it('毫无关系的两条线不连边', () => {
    const g = buildLineLevelGraph(
      [
        line('L01', { nodeIds: ['a'], characterIds: ['P001'], chapters: ['1'] }),
        line('L02', { nodeIds: ['b'], characterIds: ['P002'], chapters: ['50'] }),
      ],
      [],
    )
    expect(g.edges).toEqual([])
  })

  it('节点带上节点数与状态，供 UI 显示', () => {
    const g = buildLineLevelGraph([line('L01', { nodeIds: ['a', 'b'], lineStatus: 'closed' })], [])
    expect(g.nodes[0]?.nodeCount).toBe(2)
    expect(g.nodes[0]?.lineStatus).toBe('closed')
  })
})

describe('节点级图（下钻）', () => {
  const nodes = [node('n2', '5', 1), node('n1', '5', 0), node('n3', '9', 0)]

  it('节点按章节序 + 章内 order 排列', () => {
    const g = buildNodeLevelGraph(line('L01', { nodeIds: ['n2', 'n1', 'n3'] }), nodes, [])
    expect(g.nodes.map((n) => n.id)).toEqual(['n1', 'n2', 'n3'])
  })

  it('相邻节点之间顺序连边', () => {
    const g = buildNodeLevelGraph(line('L01', { nodeIds: ['n1', 'n2', 'n3'] }), nodes, [])
    expect(g.edges).toHaveLength(2)
    expect(g.edges.map((e) => e.kind)).toEqual(['contains', 'contains'])
  })

  it('跨线引用会画出连接到另一条线的边（多对多可见）', () => {
    const other = line('L02', { title: '另一条线', nodeIds: ['n2'] })
    const g = buildNodeLevelGraph(line('L01', { nodeIds: ['n1', 'n2'] }), nodes, [other])
    expect(g.nodes.some((n) => n.id === 'L02')).toBe(true)
    expect(g.edges.some((e) => e.kind === 'shares_node' && e.target === 'L02')).toBe(true)
  })

  it('节点不存在时安全跳过', () => {
    const g = buildNodeLevelGraph(line('L01', { nodeIds: ['不存在'] }), nodes, [])
    expect(g.nodes).toEqual([])
  })
})

describe('度数（找主干）', () => {
  it('返回度数最高的若干个', () => {
    const g = buildLineLevelGraph(
      [
        line('L01', { nodeIds: ['x'], chapters: ['1'] }),
        line('L02', { nodeIds: ['x'], chapters: ['1'] }),
        line('L03', { nodeIds: ['x'], chapters: ['1'] }),
      ],
      [],
    )
    expect(topByDegree(g, 1)).toEqual(['L01'])
  })
})

describe('dagre 布局（从左到右）', () => {
  it('有边相连的节点，target 的 x 大于 source', () => {
    const g = buildLineLevelGraph(
      [
        line('L01', { nodeIds: ['n1'], chapters: ['1'] }),
        line('L02', { nodeIds: ['n1'], chapters: ['1'] }),
      ],
      [],
    )
    const pos = layoutGraph(g, { direction: 'LR' })
    const a = pos.find((p) => p.id === 'L01')!
    const b = pos.find((p) => p.id === 'L02')!
    expect(a.x).not.toBe(b.x)
  })

  it('空图返回空数组', () => {
    expect(layoutGraph({ nodes: [], edges: [] })).toEqual([])
  })

  it('孤立节点也能拿到坐标', () => {
    const pos = layoutGraph({ nodes: [{ id: 'x', kind: 'line', label: 'x', chapters: [] }], edges: [] })
    expect(pos).toHaveLength(1)
    expect(Number.isFinite(pos[0]!.x)).toBe(true)
  })
})
