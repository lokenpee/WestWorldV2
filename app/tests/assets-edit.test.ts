import { afterEach, describe, expect, it } from 'vitest'
import {
  deleteCharacterSnapshot,
  deleteLocationSnapshot,
  mergeCharacterSnapshots,
  mergeLocationSnapshots,
  setCharacterRoleWeight,
  updateCharacterSnapshot,
  updateEventLine,
  updateLocationSnapshot,
  updateNode,
} from '../src/core/assets/edit.ts'
import { getCanonDb, resetCanonDbForTest } from '../src/core/db/canon.ts'
import type {
  EventLine,
  StoredCharacterSnapshot,
  StoredLocationSnapshot,
  StoredNode,
} from '../src/core/schema/index.ts'

afterEach(async () => {
  await resetCanonDbForTest()
})

function snap(id: string, chapterIndex: string, name: string, over: Partial<StoredCharacterSnapshot> = {}): StoredCharacterSnapshot {
  return { id, bookId: 'bk', chapterIndex, chapterName: `第${chapterIndex}章`, name, confidence: 0.9, ...over }
}

describe('编辑资产（全部在**快照层**上做）', () => {
  it('改人物快照字段', async () => {
    await getCanonDb('bk').characterSnapshots.put(snap('C1-P001', '1', '贾琏'))
    await updateCharacterSnapshot('bk', 'C1-P001', { personality: '好色；惧内', aliases: ['琏二爷'] })
    const got = await getCanonDb('bk').characterSnapshots.get('C1-P001')
    expect(got?.personality).toBe('好色；惧内')
    expect(got?.aliases).toEqual(['琏二爷'])
    expect(got?.updatedAt).toBeTruthy()
  })

  it('改人物层级', async () => {
    await getCanonDb('bk').characterSnapshots.put(snap('C1-P001', '1', '贾琏'))
    await setCharacterRoleWeight('bk', 'C1-P001', '主要人物')
    expect((await getCanonDb('bk').characterSnapshots.get('C1-P001'))?.roleWeight).toBe('主要人物')
  })

  it('改地点快照字段', async () => {
    const loc: StoredLocationSnapshot = {
      id: 'C1-L001', bookId: 'bk', chapterIndex: '1', chapterName: '第一章', name: '荣国府', confidence: 0.9,
    }
    await getCanonDb('bk').locationSnapshots.put(loc)
    await updateLocationSnapshot('bk', 'C1-L001', { description: '贾府主宅' })
    expect((await getCanonDb('bk').locationSnapshots.get('C1-L001'))?.description).toBe('贾府主宅')
  })

  it('改事件节点字段', async () => {
    const n: StoredNode = {
      id: 'C1-N001', bookId: 'bk', chapterIndex: '1', chapterName: '第一章', order: 0,
      name: '旧名', summary: 's', actors: [], quote: 'q', confidence: 0.9, createdBy: 'P1',
    }
    await getCanonDb('bk').nodes.put(n)
    await updateNode('bk', 'C1-N001', { name: '新名', actors: ['贾琏'] })
    const got = await getCanonDb('bk').nodes.get('C1-N001')
    expect(got?.name).toBe('新名')
    expect(got?.actors).toEqual(['贾琏'])
  })

  it('改事件线字段', async () => {
    const l: EventLine = {
      id: 'L01', bookId: 'bk', title: '旧', nodeIds: [], chapters: [],
      cause: '', process: '', result: '', lineStatus: 'open', characterIds: [], updatedAt: '',
    }
    await getCanonDb('bk').eventLines.put(l)
    await updateEventLine('bk', 'L01', { title: '新', lineStatus: 'closed' })
    const got = await getCanonDb('bk').eventLines.get('L01')
    expect(got?.title).toBe('新')
    expect(got?.lineStatus).toBe('closed')
  })

  it('删除快照', async () => {
    await getCanonDb('bk').characterSnapshots.put(snap('C1-P001', '1', '贾琏'))
    await deleteCharacterSnapshot('bk', 'C1-P001')
    expect(await getCanonDb('bk').characterSnapshots.count()).toBe(0)
  })
})

describe('手动合并（向前合并：保留最早的那条，其余删掉）', () => {
  async function setup() {
    await getCanonDb('bk').characterSnapshots.bulkPut([
      snap('C1-P001', '1', '贾琏', { aliases_mentioned: ['琏二爷'], identity: '荣府管家' }),
      snap('C9-P001', '9', '琏二哥哥', { aliases_mentioned: ['二爷'], personality: '机灵' }),
    ])
  }

  it('别名汇总到保留的那条，其余删除', async () => {
    await setup()
    await mergeCharacterSnapshots('bk', 'C1-P001', ['C9-P001'])
    const rows = await getCanonDb('bk').characterSnapshots.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe('C1-P001')
    expect(rows[0]?.aliases?.sort()).toEqual(['二爷', '琏二哥哥', '琏二爷'].sort())
  })

  it('保留的那条缺的字段从被合并的那条补上（不覆盖已有内容）', async () => {
    await setup()
    await mergeCharacterSnapshots('bk', 'C1-P001', ['C9-P001'])
    const keep = await getCanonDb('bk').characterSnapshots.get('C1-P001')
    expect(keep?.identity).toBe('荣府管家')
    expect(keep?.personality).toBe('机灵')
  })

  it('保留项不存在时明确报错', async () => {
    await setup()
    await expect(mergeCharacterSnapshots('bk', '不存在', ['C1-P001'])).rejects.toThrow(/不存在/)
  })

  it('地点同样支持手动合并', async () => {
    await getCanonDb('bk').locationSnapshots.bulkPut([
      { id: 'C1-L001', bookId: 'bk', chapterIndex: '1', chapterName: '第一章', name: '荣国府', confidence: 0.9 },
      { id: 'C9-L001', bookId: 'bk', chapterIndex: '9', chapterName: '第九章', name: '贾府', description: '主宅', confidence: 0.8 },
    ])
    await mergeLocationSnapshots('bk', 'C1-L001', ['C9-L001'])
    const rows = await getCanonDb('bk').locationSnapshots.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe('C1-L001')
    expect(rows[0]?.description).toBe('主宅')
  })

  it('删除地点快照', async () => {
    await getCanonDb('bk').locationSnapshots.put({
      id: 'C1-L001', bookId: 'bk', chapterIndex: '1', chapterName: '第一章', name: '荣国府', confidence: 0.9,
    })
    await deleteLocationSnapshot('bk', 'C1-L001')
    expect(await getCanonDb('bk').locationSnapshots.count()).toBe(0)
  })
})