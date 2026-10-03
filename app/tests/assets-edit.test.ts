import { afterEach, describe, expect, it } from 'vitest'
import {
  mergeCharacters,
  unmergeCharacter,
  updateCharacter,
  updateEventLine,
  updateLocation,
  updateNode,
} from '../src/core/assets/edit.ts'
import { getCanonDb, resetCanonDbForTest } from '../src/core/db/canon.ts'
import type { Character, EventLine, StoredLocation, StoredNode } from '../src/core/schema/index.ts'

afterEach(async () => {
  await resetCanonDbForTest()
})

function char(id: string, name: string, over: Partial<Character> = {}): Character {
  return {
    id,
    bookId: 'bk',
    name,
    aliases: [],
    roleWeight: 'NPC',
    relations: [],
    sourceSnapshotIds: [],
    updatedAt: '',
    ...over,
  }
}

describe('编辑资产', () => {
  it('改人物字段', async () => {
    await getCanonDb().characters.put(char('P001', '贾琏'))
    await updateCharacter('P001', { personality: '好色；惧内', aliases: ['琏二爷'] })
    const got = await getCanonDb().characters.get('P001')
    expect(got?.personality).toBe('好色；惧内')
    expect(got?.aliases).toEqual(['琏二爷'])
  })

  it('改地点字段', async () => {
    const loc: StoredLocation = { id: 'L001', bookId: 'bk', chapterIndex: '1', name: '荣国府' }
    await getCanonDb().locations.put(loc)
    await updateLocation('L001', { description: '贾府主宅' })
    expect((await getCanonDb().locations.get('L001'))?.description).toBe('贾府主宅')
  })

  it('改事件节点字段', async () => {
    const n: StoredNode = {
      id: 'C1-N001', bookId: 'bk', chapterIndex: '1', chapterName: '第一章', order: 0,
      name: '旧名', summary: 's', actors: [], quote: 'q', confidence: 0.9, createdBy: 'P1',
    }
    await getCanonDb().nodes.put(n)
    await updateNode('C1-N001', { name: '新名', actors: ['贾琏'] })
    const got = await getCanonDb().nodes.get('C1-N001')
    expect(got?.name).toBe('新名')
    expect(got?.actors).toEqual(['贾琏'])
  })

  it('改事件线字段', async () => {
    const l: EventLine = {
      id: 'L01', bookId: 'bk', title: '旧', nodeIds: [], chapters: [],
      cause: '', process: '', result: '', lineStatus: 'open', characterIds: [], updatedAt: '',
    }
    await getCanonDb().eventLines.put(l)
    await updateEventLine('L01', { title: '新', lineStatus: 'closed' })
    const got = await getCanonDb().eventLines.get('L01')
    expect(got?.title).toBe('新')
    expect(got?.lineStatus).toBe('closed')
  })
})

describe('手动归并人物（ADR：不删除、可撤销、回填引用）', () => {
  async function setup() {
    const db = getCanonDb()
    await db.characters.bulkPut([
      char('P001', '贾琏', { aliases: ['琏二爷'], sourceSnapshotIds: ['C1-P001'] }),
      char('P002', '琏二哥哥', { aliases: ['二爷'], sourceSnapshotIds: ['C9-P001'] }),
    ])
    await db.eventLines.put({
      id: 'L01', bookId: 'bk', title: '线', nodeIds: [], chapters: [],
      cause: '', process: '', result: '', lineStatus: 'open',
      characterIds: ['P002'], updatedAt: '',
    })
  }

  it('保留 keepId：别名与来源快照汇总过去', async () => {
    await setup()
    await mergeCharacters('P001', 'P002')
    const keep = await getCanonDb().characters.get('P001')
    expect(keep?.aliases.sort()).toEqual(['二爷', '琏二爷', '琏二哥哥'].sort())
    expect(keep?.sourceSnapshotIds.sort()).toEqual(['C1-P001', 'C9-P001'])
  })

  it('⭐ 被合并的实体**不删除**，只标记 mergedInto', async () => {
    await setup()
    await mergeCharacters('P001', 'P002')
    const drop = await getCanonDb().characters.get('P002')
    expect(drop).toBeTruthy()
    expect(drop?.mergedInto).toBe('P001')
  })

  it('⭐ 回填引用：事件线里的 characterIds 被改成 keepId', async () => {
    await setup()
    await mergeCharacters('P001', 'P002')
    const line = await getCanonDb().eventLines.get('L01')
    expect(line?.characterIds).toEqual(['P001'])
  })

  it('可以撤销归并', async () => {
    await setup()
    await mergeCharacters('P001', 'P002')
    await unmergeCharacter('P002')
    expect((await getCanonDb().characters.get('P002'))?.mergedInto).toBeUndefined()
  })

  it('不能把自己合并到自己', async () => {
    await setup()
    await expect(mergeCharacters('P001', 'P001')).rejects.toThrow(/不能把自己/)
  })

  it('实体不存在时明确报错', async () => {
    await setup()
    await expect(mergeCharacters('P001', '不存在')).rejects.toThrow(/不存在/)
  })
})
