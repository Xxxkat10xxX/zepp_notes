// Разбор разметки заметки. Используется в side service (телефон) и в тестах.
//
// Поддерживаемый синтаксис:
//   # Заголовок            — строка-заголовок
//   $$ ... $$              — формула LaTeX (может быть многострочной)
//   $ ... $                — короткая формула LaTeX (рендерится отдельной картинкой)
//   ![подпись](https://...) — фотография по ссылке
//   [pdf](https://...)     — все страницы PDF (до MAX_PDF_PAGES)
//   [pdf:2-5](https://...) — страницы 2..5 PDF
//   \$                     — буквальный знак доллара
//   всё остальное          — обычный текст

export const MAX_PDF_PAGES = 30

const TOKEN_RE =
  /\$\$([\s\S]+?)\$\$|!\[([^\]]*)\]\(([^)\s]+)\)|\[pdf(?::(\d+)(?:-(\d+))?)?\]\(([^)\s]+)\)|\$([^$\n]+?)\$/g

function restore(s) {
  return s.replace(/\u0001/g, '\\$')
}

function pushText(blocks, text) {
  const cleaned = text.replace(/\u0001/g, '$')
  const lines = cleaned.split('\n')
  let buf = []
  const flush = () => {
    const v = buf.join('\n').replace(/^\n+|\n+$/g, '')
    if (v.trim()) blocks.push({ t: 'text', v })
    buf = []
  }
  for (const line of lines) {
    const m = /^\s{0,3}(#{1,3})\s+(.*)$/.exec(line)
    if (m) {
      flush()
      blocks.push({ t: 'h', v: m[2].trim() })
    } else {
      buf.push(line)
    }
  }
  flush()
}

/**
 * Превращает текст заметки в список "сырых" блоков:
 *   { t: 'text', v } | { t: 'h', v } | { t: 'latex', v, display }
 *   { t: 'photo', url, alt } | { t: 'pdf', url, from, to }
 */
export function parseNote(body) {
  const blocks = []
  // экранированный \$ временно заменяем, чтобы обойтись без lookbehind в RegExp
  const src = String(body || '').replace(/\\\$/g, '\u0001')
  let last = 0
  TOKEN_RE.lastIndex = 0
  let m
  while ((m = TOKEN_RE.exec(src))) {
    if (m.index > last) pushText(blocks, src.slice(last, m.index))
    if (m[1] !== undefined) {
      blocks.push({ t: 'latex', v: restore(m[1]).trim(), display: true })
    } else if (m[3] !== undefined) {
      blocks.push({ t: 'photo', url: m[3], alt: m[2] || '' })
    } else if (m[6] !== undefined) {
      const from = m[4] ? parseInt(m[4], 10) : 1
      const to = m[5] ? parseInt(m[5], 10) : m[4] ? from : from + MAX_PDF_PAGES - 1
      blocks.push({ t: 'pdf', url: m[6], from, to: Math.min(to, from + MAX_PDF_PAGES - 1) })
    } else if (m[7] !== undefined) {
      blocks.push({ t: 'latex', v: restore(m[7]).trim(), display: false })
    }
    last = TOKEN_RE.lastIndex
  }
  if (last < src.length) pushText(blocks, src.slice(last))
  return blocks
}

/** Короткий стабильный хеш строки (djb2) — используется как имя файла картинки. */
export function hashKey(str) {
  let h = 5381
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0
  let h2 = 52711
  for (let i = str.length - 1; i >= 0; i--) h2 = ((h2 << 5) + h2 + str.charCodeAt(i)) >>> 0
  return h.toString(36) + h2.toString(36)
}

/** Превью заметки для списка на часах. */
export function previewOf(body, max = 60) {
  const text = String(body || '')
    .replace(/\$\$[\s\S]*?\$\$/g, '∑')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '🖼')
    .replace(/\[pdf[^\]]*\]\([^)]*\)/g, 'PDF')
    .replace(/[#\n\r]+/g, ' ')
    .trim()
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}
