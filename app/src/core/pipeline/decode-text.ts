/**
 * 文本解码（工程约定第 4 节）。
 *
 * 中文网文 txt **大量是 GBK/GB18030**，按 UTF-8 读会整本乱码 —— 而这会直接卡死在第 1 步。
 * 策略：先按 UTF-8 严格解码，失败则退到 GBK；都失败就交给用户手选。
 */
export interface DecodeResult {
  text: string
  encoding: 'utf-8' | 'gbk'
  ok: boolean
}

const UTF8 = new TextDecoder('utf-8', { fatal: true })
const GBK = new TextDecoder('gbk')

/** 猜测并解码。返回 ok=false 表示两种编码都不可信（仍会给出 GBK 的结果供用户预览）。 */
export function decodeBytes(bytes: ArrayBuffer): DecodeResult {
  try {
    const text = UTF8.decode(bytes)
    // BOM 去掉
    return { text: text.charCodeAt(0) === 0xfeff ? text.slice(1) : text, encoding: 'utf-8', ok: true }
  } catch {
    try {
      const text = GBK.decode(bytes)
      return { text, encoding: 'gbk', ok: true }
    } catch {
      return { text: GBK.decode(bytes), encoding: 'gbk', ok: false }
    }
  }
}

/** 用户手选编码时用。 */
export function decodeWith(bytes: ArrayBuffer, encoding: 'utf-8' | 'gbk'): string {
  return encoding === 'utf-8' ? new TextDecoder('utf-8').decode(bytes) : GBK.decode(bytes)
}
