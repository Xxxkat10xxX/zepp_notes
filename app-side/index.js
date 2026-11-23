// Side service — работает внутри приложения Zepp на телефоне.
// Хранит заметки (settingsStorage), рендерит LaTeX / фото / PDF в PNG,
// конвертирует их в формат часов и передаёт файлы на часы.
import { BaseSideService, settingsLib } from '@zeppos/zml/base-side'
import { parseNote, hashKey, previewOf } from '../shared/markup'
import { CONTENT_W, KEY_NOTES, KEY_SERVER, KEY_STATUS } from '../shared/config'
import {
  qs,
  codecogsUrl,
  weservMetaUrl,
  weservBoxUrl,
  fitBox,
  directLink,
  YANDEX_API,
  MAX_PHOTO_H,
} from '../shared/sources'

const CACHE_TTL = 30 * 60 * 1000 // ссылки Яндекс Диска живут ограниченное время

// key -> { url, w, h }  — откуда качать картинку с данным ключом
const assetSources = {}
// кэш разрешённых блоков (чтобы не дёргать сервер на каждую синхронизацию)
const resolveCache = {}

function readNotes() {
  try {
    const raw = settingsLib.getItem(KEY_NOTES)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr : []
  } catch (e) {
    return []
  }
}

function writeNotes(notes) {
  settingsLib.setItem(KEY_NOTES, JSON.stringify(notes))
}

function serverUrl() {
  const s = (settingsLib.getItem(KEY_SERVER) || '').trim()
  return s ? s.replace(/\/+$/, '') : ''
}

function setStatus(text) {
  try {
    settingsLib.setItem(KEY_STATUS, text)
  } catch (e) {}
}

function absUrl(base, url) {
  if (/^https?:\/\//i.test(url)) return url
  return base + (url.startsWith('/') ? '' : '/') + url
}

function parseBody(body) {
  if (typeof body === 'string') {
    try {
      return JSON.parse(body)
    } catch (e) {
      return null
    }
  }
  return body
}

AppSideService(
  BaseSideService({
    state: {
      queue: [],
      busy: false,
    },

    onInit() {
      this.log('notes side service init')
    },

    onRun() {},

    onDestroy() {},

    // ---------- Связь с часами ----------
    onRequest(req, res) {
      const p = req.params || {}
      switch (req.method) {
        case 'notes.sync':
          this.buildSyncPayload()
            .then((data) => res(null, data))
            .catch((e) => res({ message: String(e) }))
          break
        case 'assets.get':
          this.enqueueAssets(p.keys || [])
          res(null, { queued: (p.keys || []).length })
          break
        case 'notes.add': {
          const notes = readNotes()
          const note = {
            id: 'n' + Date.now().toString(36),
            title: (p.title || '').trim() || 'Заметка с часов',
            body: p.body || '',
            updated: Date.now(),
          }
          notes.unshift(note)
          writeNotes(notes)
          res(null, { id: note.id })
          break
        }
        case 'notes.delete': {
          writeNotes(readNotes().filter((n) => n.id !== p.id))
          res(null, { ok: true })
          break
        }
        default:
          res({ message: 'unknown method ' + req.method })
      }
    },

    onSettingsChange({ key }) {
      if (key === KEY_NOTES || key === KEY_SERVER) {
        if (key === KEY_SERVER) {
          Object.keys(resolveCache).forEach((k) => delete resolveCache[k])
        }
        // если приложение на часах открыто — оно пересинхронизируется
        try {
          this.call({ method: 'notes.changed', params: {} })
        } catch (e) {}
      }
    },

    // ---------- Подготовка заметок ----------
    async buildSyncPayload() {
      const notes = readNotes()
      const out = []
      for (const note of notes) {
        const raw = parseNote(note.body)
        const blocks = []
        for (const b of raw) {
          if (b.t === 'text' || b.t === 'h') {
            blocks.push(b)
            continue
          }
          try {
            const resolved = await this.resolveBlock(b)
            resolved.forEach((r) => blocks.push(r))
          } catch (e) {
            blocks.push({ t: 'err', v: this.describe(b) + ': ' + (e && e.message ? e.message : e) })
          }
        }
        out.push({
          id: note.id,
          title: note.title || 'Без названия',
          preview: previewOf(note.body),
          updated: note.updated || 0,
          blocks,
        })
      }
      setStatus('Синхронизировано: ' + new Date().toLocaleString())
      return { notes: out }
    },

    describe(b) {
      if (b.t === 'latex') return 'LaTeX'
      if (b.t === 'photo') return 'Фото'
      if (b.t === 'pdf') return 'PDF'
      return b.t
    },

    // Возвращает массив блоков вида { t: 'img', key, w, h, cap }
    async resolveBlock(b) {
      const server = serverUrl()
      const id = JSON.stringify([server, CONTENT_W, b])
      const hit = resolveCache[id]
      if (hit && Date.now() - hit.at < CACHE_TTL) return hit.blocks

      let items
      if (server) {
        items = await this.resolveViaServer(server, b)
      } else {
        items = await this.resolveViaPublic(b)
      }

      const result = items.map((it, i) => {
        const key = hashKey(id + '#' + i)
        assetSources[key] = it
        return { t: 'img', key, w: it.w || 0, h: it.h || 0, cap: it.cap || '', inline: !!it.inline }
      })
      resolveCache[id] = { at: Date.now(), blocks: result }
      return result
    },

    async resolveViaServer(server, b) {
      let query
      if (b.t === 'latex') {
        query = { kind: 'latex', tex: b.v, display: b.display ? 1 : 0, w: CONTENT_W }
      } else if (b.t === 'photo') {
        query = { kind: 'image', url: await this.sourceUrl(b.url), w: CONTENT_W }
      } else if (b.t === 'pdf') {
        query = {
          kind: 'pdf',
          url: await this.sourceUrl(b.url),
          from: b.from,
          to: b.to,
          w: CONTENT_W,
        }
      }
      const resp = await this.fetch({
        method: 'GET',
        url: server + '/render?' + qs(query),
        timeout: 60000,
      })
      const data = parseBody(resp && resp.body !== undefined ? resp.body : resp)
      if (!data || !Array.isArray(data.items)) {
        throw new Error((data && data.error) || 'сервер вернул неверный ответ')
      }
      return data.items.map((it, i) => ({
        url: absUrl(server, it.url),
        w: it.w,
        h: it.h,
        inline: b.t === 'latex' && !b.display,
        cap:
          b.t === 'pdf'
            ? 'стр. ' + (it.page || b.from + i) + (data.pages ? ' / ' + data.pages : '')
            : b.alt || '',
      }))
    },

    // ---------- Публичные сервисы (работает без компьютера и своего сервера) ----------
    async getJson(url) {
      const resp = await this.fetch({ method: 'GET', url, timeout: 60000 })
      const data = parseBody(resp && resp.body !== undefined ? resp.body : resp)
      if (!data) throw new Error('пустой ответ')
      if (data.status === 'error' || data.error) {
        throw new Error(data.message || data.error || 'ошибка сервиса')
      }
      return data
    },

    // ссылка «Поделиться» (Google Drive / Dropbox / Яндекс Диск) -> прямая ссылка
    async sourceUrl(url) {
      const d = directLink(url)
      if (!d.yandex) return d.url
      const data = await this.getJson(YANDEX_API + encodeURIComponent(d.url))
      if (!data.href) throw new Error('Яндекс Диск: файл не найден или ссылка закрыта')
      return data.href
    },

    async meta(url) {
      const m = await this.getJson(weservMetaUrl(url))
      let w = m.width
      let h = m.height
      if (m.orientation >= 5 && m.orientation <= 8) {
        // фото повёрнуто по EXIF — weserv выдаст его уже повёрнутым
        const t = w
        w = h
        h = t
      }
      return { w, h, pages: m.pages || 1, format: m.format }
    },

    async resolveViaPublic(b) {
      if (b.t === 'latex') {
        const direct = codecogsUrl(b.v, b.display)
        const m = await this.meta(direct)
        if (m.w <= CONTENT_W) {
          return [{ url: direct, w: m.w, h: m.h, inline: !b.display }]
        }
        // слишком широкая формула — уменьшаем через weserv
        const box = fitBox(m.w, m.h, CONTENT_W)
        return [{ url: weservBoxUrl(direct, box.w, box.h), w: box.w, h: box.h, inline: !b.display }]
      }

      const src = await this.sourceUrl(b.url)
      const m = await this.meta(src)

      if (b.t === 'photo') {
        const box = fitBox(m.w, m.h, CONTENT_W, MAX_PHOTO_H)
        return [{ url: weservBoxUrl(src, box.w, box.h), w: box.w, h: box.h, cap: b.alt || '' }]
      }

      if (b.t === 'pdf') {
        if (m.format && m.format !== 'pdf') throw new Error('это не PDF (' + m.format + ')')
        const last = Math.min(b.to, m.pages)
        if (b.from > last) throw new Error('в документе всего ' + m.pages + ' стр.')
        // страницы PDF растягиваем на всю ширину экрана
        const box = fitBox(m.w, m.h, CONTENT_W, 0, true)
        const items = []
        for (let p = b.from; p <= last; p++) {
          items.push({
            url: weservBoxUrl(src, box.w, box.h, p - 1),
            w: box.w,
            h: box.h,
            cap: 'стр. ' + p + ' / ' + m.pages,
          })
        }
        return items
      }
      throw new Error('неизвестный блок')
    },

    // ---------- Загрузка и передача картинок ----------
    enqueueAssets(keys) {
      keys.forEach((k) => {
        if (assetSources[k] && this.state.queue.indexOf(k) === -1) this.state.queue.push(k)
      })
      this.pump()
    },

    pump() {
      if (this.state.busy) return
      const key = this.state.queue.shift()
      if (!key) return
      this.state.busy = true
      this.transferAsset(key)
        .catch((e) => {
          this.log('asset failed', key, e)
          try {
            this.call({ method: 'asset.failed', params: { key, message: String(e) } })
          } catch (err) {}
        })
        .then(() => {
          this.state.busy = false
          this.pump()
        })
    },

    fetchFile(url, filePath) {
      return new Promise((resolve, reject) => {
        let task
        try {
          task = network.downloader.downloadFile({ url, filePath, timeout: 60000 })
        } catch (e) {
          reject(e)
          return
        }
        task.onSuccess = (data) => {
          if (data && data.statusCode && data.statusCode !== 200) {
            reject(new Error('HTTP ' + data.statusCode))
          } else {
            resolve(data)
          }
        }
        task.onFail = (e) => reject(new Error('download failed ' + JSON.stringify(e)))
      })
    },

    sendToWatch(path, params) {
      return new Promise((resolve, reject) => {
        const file = this.sendFile(path, params)
        file.on('change', (e) => {
          const st = e && e.data && e.data.readyState
          if (st === 'transferred') resolve()
          else if (st === 'error' || st === 'canceled') reject(new Error('transfer ' + st))
        })
      })
    },

    async transferAsset(key) {
      const src = assetSources[key]
      const rawName = 'r_' + key + '.png'
      await this.fetchFile(src.url, rawName)
      const target = 'data://download/w_' + key + '.png'
      await this.convert({ filePath: 'data://download/' + rawName, targetFilePath: target })
      await this.sendToWatch(target, { type: 'image', key })
    },
  }),
)
