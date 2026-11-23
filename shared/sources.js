// Построение ссылок на публичные сервисы рендеринга (без своего сервера).
//   latex.codecogs.com — формулы LaTeX -> PNG
//   images.weserv.nl   — уменьшение фото, рендер страниц PDF, размеры (output=json)
import { CODECOGS, WESERV, CONTENT_W } from './config.js'

export const MAX_PHOTO_H = 600

export function qs(obj) {
  return Object.keys(obj)
    .filter((k) => obj[k] !== undefined && obj[k] !== null && obj[k] !== '')
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]))
    .join('&')
}

export function codecogsUrl(tex, display) {
  const dpi = display ? 150 : 130
  return CODECOGS + encodeURIComponent('\\dpi{' + dpi + '}\\bg{black}\\color{white}' + tex)
}

/** Ссылка на JSON с размерами / числом страниц исходного файла. */
export function weservMetaUrl(url) {
  return WESERV + qs({ url, output: 'json' })
}

/** PNG ровно w x h (картинка вписывается, поля чёрные). page — 0-based (для PDF). */
export function weservBoxUrl(url, w, h, page) {
  return (
    WESERV +
    qs({ url, w, h, fit: 'contain', cbg: '000000', bg: '000000', output: 'png', page })
  )
}

/** Вписывает исходный размер в ширину экрана (и ограничение по высоте). Без увеличения. */
export function fitBox(srcW, srcH, maxW = CONTENT_W, maxH = 0, enlarge = false) {
  if (!srcW || !srcH) return { w: maxW, h: maxH || maxW }
  let s = maxW / srcW
  if (maxH) s = Math.min(s, maxH / srcH)
  if (!enlarge) s = Math.min(s, 1)
  return { w: Math.max(1, Math.round(srcW * s)), h: Math.max(1, Math.round(srcH * s)) }
}

/**
 * Превращает ссылку «Поделиться» облачного диска в прямую ссылку на файл.
 * Яндекс Диск требует запроса к API — для него возвращается { yandex: true }.
 */
export function directLink(url) {
  const u = String(url).trim()
  let m
  // Google Drive: /file/d/<id>/..., open?id=<id>, uc?id=<id>
  if (/^https?:\/\/(drive|docs)\.google\.com\//i.test(u)) {
    m = /\/d\/([\w-]{10,})/.exec(u) || /[?&]id=([\w-]{10,})/.exec(u)
    if (m) return { url: 'https://drive.google.com/uc?export=download&id=' + m[1] }
  }
  // Dropbox: ?dl=0 -> ?raw=1
  if (/^https?:\/\/(www\.)?dropbox\.com\//i.test(u)) {
    const base = u.replace(/([?&])(dl|raw)=\d/g, '$1').replace(/[?&]+$/, '')
    return { url: base + (base.indexOf('?') >= 0 ? '&' : '?') + 'raw=1' }
  }
  // Яндекс Диск: публичные ссылки disk.yandex.ru/i/..., /d/..., yadi.sk/...
  if (/^https?:\/\/(disk\.yandex\.[a-z]+|yadi\.sk)\//i.test(u)) {
    return { url: u, yandex: true }
  }
  return { url: u }
}

export const YANDEX_API =
  'https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key='
