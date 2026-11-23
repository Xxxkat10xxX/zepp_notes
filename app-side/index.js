// Side service — работает внутри приложения Zepp на телефоне.
// Хранит заметки (settingsStorage), рендерит LaTeX / фото / PDF в PNG,
// конвертирует их в формат часов и передаёт файлы на часы.
import { BaseSideService, settingsLib } from '@zeppos/zml/base-side'
import { parseNote, hashKey, previewOf } from '../shared/markup'
import {
  CONTENT_W,
  KEY_NOTES,
  KEY_SERVER,
  KEY_STATUS,
  CODECOGS,
  WESERV,
} from '../shared/config'

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

function qs(obj) {
  return Object.keys(obj)
    .filter((k) => obj[k] !== undefined && obj[k] !== null && obj[k] !== '')
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]))
    .join('&')
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
      if (resolveCache[id]) return resolveCache[id]

      let items
      if (server) {
        items = await this.resolveViaServer(server, b)
      } else {
        items = this.resolveViaPublic(b)
      }

      const result = items.map((it, i) => {
        const key = hashKey(id + '#' + i)
        assetSources[key] = it
        return { t: 'img', key, w: it.w || 0, h: it.h || 0, cap: it.cap || '', inline: !!it.inline }
      })
      resolveCache[id] = result
      return result
    },

    async resolveViaServer(server, b) {
      let query
      if (b.t === 'latex') {
        query = { kind: 'latex', tex: b.v, display: b.display ? 1 : 0, w: CONTENT_W }
      } else if (b.t === 'photo') {
        query = { kind: 'image', url: b.url, w: CONTENT_W }
      } else if (b.t === 'pdf') {
        query = { kind: 'pdf', url: b.url, from: b.from, to: b.to, w: CONTENT_W }
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

    resolveViaPublic(b) {
      if (b.t === 'latex') {
        const dpi = b.display ? 170 : 150
        const tex = '\\dpi{' + dpi + '}\\bg{black}\\color{white}' + b.v
        return [{ url: CODECOGS + encodeURIComponent(tex), w: 0, h: 0, inline: !b.display }]
      }
      if (b.t === 'photo') {
        // contain -> картинка ровно 350x420 с чёрными полями, размер известен заранее
        const h = 420
        const url =
          WESERV +
          qs({ url: b.url, w: CONTENT_W, h, fit: 'contain', cbg: '000000', output: 'png' })
        return [{ url, w: CONTENT_W, h, cap: b.alt || '' }]
      }
      throw new Error('для PDF укажите сервер рендеринга в настройках')
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
