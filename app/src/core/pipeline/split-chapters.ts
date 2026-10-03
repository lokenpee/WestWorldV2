/**
 * 分章与切块 —— 纯代码，不调模型（实施计划步骤 3）。
 *
 * 三个必须处理的坑（工程约定第 4 节）：
 *   1. 正则必须带 `gm` 标志，否则只能匹配到第一个章节
 *   2. 捕获组要**包含标题**（原式 `[^ \n\r]{0,80}` 在第一个空格就断了）
 *   3. `(?:^|[^\w\n\r])` 会**消费掉章节标记前的一个字符** —— 切分时要补偿
 */


export const DEFAULT_CHAPTER_REGEX =
  /(?:^|[^\w\n\r])([\s\u3000\uFEFF]*第\s*(?:[零一二三四五六七八九十百千万0-9]\s*)+[章回卷节部篇][^\n\r]{0,80})/gm

export interface SplitOptions {
  /** 自定义分章正则。必须带 g 标志。 */
  regex?: RegExp
  /** 单块字数上限，超过就切块。默认 10000。 */
  maxChunkChars?: number
  /** 找不到任何章节标记时的滑窗大小。默认 4000。 */
  fallbackWindowChars?: number
}

/** 分章产物（还没挂 bookId，由调用方补）。 */
export interface ChapterDraft {
  /** 章节标识。字符串，切块后形如 "101.1"。 */
  chapterIndex: string
  /** 章节名。 */
  chapterName: string
  /** 本章（或本块）正文。 */
  text: string
  /** 字数。 */
  charCount: number
  /** 在书中的顺序，从 0 开始。 */
  order: number
}

/**
 * 从正则匹配结果里取标题。
 *
 * 捕获组本身已含标题，但前面可能被 `(?:^|[^\w\n\r])` 吃掉一个字符，
 * 所以这里用 `match.index + match[0].indexOf(captured)` 反推真实起点。
 */
function resolveTitleStart(fullMatch: string, captured: string, matchIndex: number): number {
  const offsetInFull = fullMatch.indexOf(captured)
  return matchIndex + (offsetInFull >= 0 ? offsetInFull : 0)
}

/** 把超长的一章按字数切成多块（如 101 → 101.1 / 101.2 / 101.3）。 */
function chunkLongChapter(
  index: string,
  name: string,
  text: string,
  maxChars: number,
): ChapterDraft[] {
  if (text.length <= maxChars) {
    return [{ chapterIndex: index, chapterName: name, text, charCount: text.length, order: 0 }]
  }

  const parts: ChapterDraft[] = []
  let cursor = 0
  let part = 1
  while (cursor < text.length) {
    const slice = text.slice(cursor, cursor + maxChars)
    parts.push({
      chapterIndex: `${index}.${part}`,
      chapterName: `${name}（第 ${part} 块）`,
      text: slice,
      charCount: slice.length,
      order: 0,
    })
    cursor += maxChars
    part += 1
  }
  return parts
}

/** 找不到章节标记时的兜底：按固定字数滑窗切。 */
function fallbackSplit(text: string, windowChars: number): ChapterDraft[] {
  const parts: ChapterDraft[] = []
  let cursor = 0
  let n = 1
  while (cursor < text.length) {
    const slice = text.slice(cursor, cursor + windowChars)
    parts.push({
      chapterIndex: String(n),
      chapterName: `第 ${n} 段`,
      text: slice,
      charCount: slice.length,
      order: 0,
    })
    cursor += windowChars
    n += 1
  }
  return parts
}

/**
 * 把整本书的正文切成章节。
 *
 * - 有章节标记 → 按标记切
 * - 没有章节标记 → 按 `fallbackWindowChars` 滑窗兜底
 * - 单章超过 `maxChunkChars` → 切成 `X.1 / X.2 / …`
 */
export function splitChapters(text: string, options: SplitOptions = {}): ChapterDraft[] {
  const {
    regex = DEFAULT_CHAPTER_REGEX,
    maxChunkChars = 10_000,
    fallbackWindowChars = 4_000,
  } = options

  if (!regex.global) {
    throw new Error('分章正则必须带 g 标志，否则只能匹配到第一个章节（见工程约定第 4 节）')
  }

  // 每次用之前重置 lastIndex，避免复用同一个正则对象时漏匹配
  regex.lastIndex = 0
  const matches: Array<{ titleStart: number; title: string }> = []
  let m: RegExpExecArray | null
  while ((m = regex.exec(text)) !== null) {
    const captured = m[1]
    if (captured === undefined) continue
    matches.push({ titleStart: resolveTitleStart(m[0], captured, m.index), title: captured.trim() })
    // 防御零宽匹配死循环
    if (m.index === regex.lastIndex) regex.lastIndex += 1
  }

  if (matches.length === 0) {
    const parts = fallbackSplit(text, fallbackWindowChars)
    return parts.map((p, i) => ({ ...p, order: i }))
  }

  const chapters: ChapterDraft[] = []
  for (let i = 0; i < matches.length; i += 1) {
    const current = matches[i]
    const next = matches[i + 1]
    if (!current) continue

    const bodyStart = current.titleStart
    const bodyEnd = next ? next.titleStart : text.length
    const raw = text.slice(bodyStart, bodyEnd)
    const chapterName = current.title
    // 章节标识取标题里的序号（中文数字保留原样，便于人工识别）
    const index = String(i + 1)

    chapters.push(...chunkLongChapter(index, chapterName, raw, maxChunkChars))
  }

  return chapters.map((c, i) => ({ ...c, order: i }))
}


