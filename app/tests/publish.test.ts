import { afterEach, describe, expect, it } from 'vitest'
import { getCanonDb, resetCanonDbForTest } from '../src/core/db/canon.ts'
import { saveP1Result } from '../src/core/db/repo.ts'
import { createNameResolver, publishCanon } from '../src/core/pipeline/publish.ts'
import type { EventLine, StoredCharacterSnapshot, StoredNode } from '../src/core/schema/index.ts'

afterEach(async () => {
  await resetCanonDbForTest()
})

function snap(id: string, chapterIndex: string, name: string, over: Partial<StoredCharacterSnapshot> = {}): StoredCharacterSnapshot {
  return { id, bookId: 'bk', chapterIndex, chapterName: `第${chapterIndex}章`, name, confidence: 0.9, ...over }
}

function node(id: string, chapterIndex: string, actors: string[], over: Partial<StoredNode> = {}): StoredNode {
  return {
    id, bookId: 'bk', chapterIndex, chapterName: `第${chapterIndex}章`, order: 0,
    name: `节点${id}`, summary: 's', actors, quote: 'q', confidence: 0.9, createdBy: 'P1', ...over,
  }
}

async function seed() {
  await saveP1Result('bk', {
    characterSnapshots: [
      snap('C3-P002', '3', '贾琏', { aliases: ['琏二爷'] }),
      snap('C7-P001', '7', '琪官'),
    ],
    locationSnapshots: [
      { id: 'C3-L001', bookId: 'bk', chapterIndex: '3', chapterName: '第三章', name: '荣国府', confidence: 0.9 },
    ],
    nodes: [
      node('C3-N001', '3', ['贾琏']),
      node('C5-N002', '5', ['琏二爷'], { targets: ['琪官'] }),
    ],
  })
  await getCanonDb('bk').eventLines.put({
    id: 'L01', bookId: 'bk', title: '走私案', nodeIds: ['C3-N001', 'C5-N002'],
    chapters: ['3', '5'], cause: '', process: '', result: '', lineStatus: 'open', characterIds: [], updatedAt: '',
  } satisfies EventLine)
}

describe('人名解析器', () => {
  it('精确匹配 + 别名匹配', () => {
    const resolve = createNameResolver([{ id: 'P001', names: ['贾琏', '琏二爷'] }])
    expect(resolve('贾琏')).toBe('P001')
    expect(resolve('琏二爷')).toBe('P001')
    expect(resolve('路人甲')).toBeUndefined()
  })

  it('⭐ 模糊命中多个候选时宁可不认（不猜错）', () => {
    const resolve = createNameResolver([
      { id: 'P001', names: ['贾琏大哥'] },
      { id: 'P002', names: ['贾琏大姐'] },
    ])
    expect(resolve('贾琏大')).toBeUndefined()
    expect(resolve('贾琏大哥')).toBe('P001')
  })
})

describe('入库：草稿层 → 固定资产', () => {
  it('重新编号为 P001 / L001', async () => {
    await seed()
    const r = await publishCanon('bk')
    expect(r.characters).toBe(2)
    expect(r.locations).toBe(1)

    const chars = await getCanonDb('bk').characters.toArray()
    expect(chars.map((c) => c.id).sort()).toEqual(['P001', 'P002'])
    // 最早出现的那个人拿到 P001
    expect(chars.find((c) => c.id === 'P001')?.name).toBe('贾琏')
    expect(await getCanonDb('bk').locations.get('L001')).toBeTruthy()
  })

  it('nodes.actors 保持人名，actorIds 是映射出的实体 id', async () => {
    await seed()
    await publishCanon('bk')
    const n = await getCanonDb('bk').nodes.get('C5-N002')
    expect(n?.actors).toEqual(['琏二爷'])
    // actors 里的「琏二爷」和 targets 里的「琪官」都会被映射
    expect(n?.actorIds?.sort()).toEqual(['P001', 'P002'])
  })

  it('⭐ eventLines.characterIds 跟 nodes.actors 在同一次入库里映射出来', async () => {
    await seed()
    await publishCanon('bk')
    const line = await getCanonDb('bk').eventLines.get('L01')
    expect(line?.characterIds.sort()).toEqual(['P001', 'P002'])
  })

  it('入库是整体重算 —— 再点一次不会翻倍，也不是叠加', async () => {
    await seed()
    await publishCanon('bk')
    await publishCanon('bk')
    expect(await getCanonDb('bk').characters.count()).toBe(2)
    expect(await getCanonDb('bk').locations.count()).toBe(1)
  })

  it('没匹配上的名字会被报出来（不静默吞掉）', async () => {
    await saveP1Result('bk', {
      characterSnapshots: [snap('C1-P001', '1', '贾琏')],
      locationSnapshots: [],
      nodes: [node('C1-N001', '1', ['神秘人'])],
    })
    const r = await publishCanon('bk')
    expect(r.unmappedNames).toContain('神秘人')
  })

  it('入库后草稿层还在（可以继续改，再入库一次）', async () => {
    await seed()
    await publishCanon('bk')
    expect(await getCanonDb('bk').characterSnapshots.count()).toBe(2)
  })
})