/**
 * 人物合并 —— 第一步：**纯代码规则**（工程约定第 8 节，参考 lokenpee/WestWorld）。
 *
 * 五步：
 *   ① 名称归一化（去掉版本 / 卷 / 章后缀）
 *   ② 比较用归一化（转小写 + 去标点空白）
 *   ③ 判同（归一化后相等，或**互相包含**）
 *   ④ 并查集聚组
 *   ⑤ 挑主名（按质量打分）
 *
 * 第二步（AI 字段级融合）在 run-merge 里，本文件不调模型。
 */
import type { StoredCharacterSnapshot } from '@/core/schema/index.ts'

const SUFFIX_PATTERNS: Array<[RegExp, string]> = [
  [/[_\-\s]*第?[零一二三四五六七八九十百千万\d]+[卷章回部篇节]$/giu, ''],
  [/[_\-\s]*卷[零一二三四五六七八九十百千万\d]+$/giu, ''],
  [/[(_\-\s]*[Vv][Ee]?[Rr]?[\s._-]*\d+$/g, ''],
  [/[(_\-\s]*(新版|旧版|重做版|重制版|修订版|临时版|备份|草稿|重复|改)$/giu, ''],
  [/[（(]\s*第?[零一二三四五六七八九十百千万\d]+[卷章回部篇节]\s*[）)]$/giu, ''],
  [/[（(]\s*(新版|旧版|重做版|重制版|修订版|临时版|备份|草稿|重复|改)\s*[）)]$/giu, ''],
]

/** ① 去掉版本 / 卷 / 章之类的后缀。例：「贾琏（修订版）」→「贾琏」 */
export function normalizeEntryName(name: string): string {
  const original = name
  let v = (name ?? '').replace(/\s+/g, ' ').trim()
  for (const [re, rep] of SUFFIX_PATTERNS) v = v.replace(re, rep)
  v = v.trim()
  return v || original.trim()
}

/** ② 比较用归一化：转小写 + 去掉所有标点与空白。 */
export function normalizeNameForComparison(name: string): string {
  return normalizeEntryName(name)
    .toLowerCase()
    .replace(/[\s`~!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?！￥…（）【】、；：‘’“”，。？《》·]/g, '')
}

/**
 * ③ 判同。
 *
 * ⚠️ 比参考实现多一条**长度守卫**：只有当较短的那个名字长度 ≥ 2 时才允许「包含」判同。
 * 否则「贾」会被吸进「贾琏」——这类单字名在中文小说里很常见。
 */
export function areNamesObviouslySame(a: string, b: string): boolean {
  const x = normalizeNameForComparison(a)
  const y = normalizeNameForComparison(b)
  if (!x || !y) return false
  if (x === y) return true
  const shorter = x.length <= y.length ? x : y
  const longer = x.length <= y.length ? y : x
  if (shorter.length < 2) return false
  return longer.includes(shorter)
}

/** ④ 并查集 */
class UnionFind {
  private parent = new Map<string, string>()

  add(x: string): void {
    if (!this.parent.has(x)) this.parent.set(x, x)
  }

  find(x: string): string {
    const p = this.parent.get(x)
    if (p === undefined) {
      this.add(x)
      return x
    }
    if (p === x) return x
    const root = this.find(p)
    this.parent.set(x, root)
    return root
  }

  union(a: string, b: string): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(rb, ra)
  }

  groups(): Map<string, string[]> {
    const out = new Map<string, string[]>()
    for (const key of this.parent.keys()) {
      const root = this.find(key)
      const list = out.get(root) ?? []
      list.push(key)
      out.set(root, list)
    }
    return out
  }
}

/**
 * ⑤ 挑主名：内容越多、关键词越多、越「干净」的越优先。
 * 分数 = 内容长度 + 关键词数×20 − 50（带后缀惩罚）+ 5（可读性）
 */
export function pickMainByQuality(snapshots: StoredCharacterSnapshot[]): StoredCharacterSnapshot {
  let best = snapshots[0]!
  let bestScore = -Infinity

  for (const s of snapshots) {
    const canonical = normalizeEntryName(s.name)
    const contentLength =
      (s.personality?.length ?? 0) +
      (s.background?.length ?? 0) +
      (s.identity?.length ?? 0) +
      (s.appearance?.length ?? 0)
    const relationCount = s.relations?.length ?? 0
    const suffixPenalty = canonical !== s.name ? -50 : 0
    const readabilityBonus = /[\u4e00-\u9fa5a-zA-Z0-9]{2,}/.test(s.name) ? 5 : 0
    const score = contentLength + relationCount * 20 + suffixPenalty + readabilityBonus
    if (score > bestScore) {
      bestScore = score
      best = s
    }
  }
  return best
}

export interface MergeGroup {
  /** 主快照（保留它的名字作为实体主名） */
  main: StoredCharacterSnapshot
  /** 同组的其余快照 */
  others: StoredCharacterSnapshot[]
  /** 组内所有称呼 */
  aliases: string[]
}

/**
 * 把快照聚成合并组。
 *
 * 注意：**只处理同一本书、同一批快照**；跨窗口的全局合并由 P3 再跑一次。
 */
export function groupSnapshots(snapshots: StoredCharacterSnapshot[]): MergeGroup[] {
  const uf = new UnionFind()
  for (const s of snapshots) uf.add(s.id)

  for (let i = 0; i < snapshots.length; i += 1) {
    for (let j = i + 1; j < snapshots.length; j += 1) {
      const a = snapshots[i]!
      const b = snapshots[j]!
      if (areNamesObviouslySame(a.name, b.name)) uf.union(a.id, b.id)
    }
  }

  const byId = new Map(snapshots.map((s) => [s.id, s]))
  const groups: MergeGroup[] = []

  for (const ids of uf.groups().values()) {
    if (ids.length < 2) continue
    const members = ids.map((id) => byId.get(id)!).filter(Boolean)
    if (members.length < 2) continue

    const main = pickMainByQuality(members)
    const others = members.filter((m) => m.id !== main.id)
    const aliasSet = new Set<string>()
    for (const m of members) {
      aliasSet.add(m.name)
      for (const a of m.aliases_mentioned ?? []) aliasSet.add(a)
    }
    aliasSet.delete(main.name)

    groups.push({ main, others, aliases: [...aliasSet] })
  }

  return groups
}

