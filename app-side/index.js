// Side service — работает внутри приложения Zepp на телефоне, полностью офлайн.
// Берёт заметки (из настроек Zepp и из папки ZeppNotes через локальный рендерер в Termux),
// получает от рендерера готовые PNG (формулы, фото, страницы PDF), конвертирует их
// в формат часов и передаёт файлы на часы по Bluetooth.
import { BaseSideService, settingsLib } from '@zeppos/zml/base-side'
import { parseNote, hashKey, previewOf } from '../shared/markup'
import { CONTENT_W, KEY_NOTES, KEY_SERVER, KEY_STATUS, DEFAULT_SERVER } from '../shared/config'

// key -> { url } — откуда (с локального рендерера) качать картинку с данным ключом
const assetSources = {}

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
  const s = String(settingsLib.getItem(KEY_SERVER) || '').trim()
  return (s || DEFAULT_SERVER).replace(/\/+$/, '')
}

function setStatus(text) {
  try {
    settingsLib.setItem(KEY_STATUS, text)
  } catch (e) {}
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

function errText(e) {
  return e && e.message ? e.message : String(e)
}

const NO_SERVER =
  'Рендерер не запущен. Откройте Termux и выполните: zepp-notes'

AppSideService(
  BaseSideService({
    state: {
      queue: [],
      busy: false,
    },

    onInit() {},
    onRun() {},
    onDestroy() {},

    // ---------- Связь с часами ----------
    onRequest(req, res) {
      const p = req.params || {}
      switch (req.method) {
        case 'notes.sync':
          this.buildSyncPayload()
            .then((data) => res(null, data))
            .catch((e) => {
              setStatus('Ошибка: ' + errText(e))
              res({ message: errText(e) })
            })
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
          if (String(p.id).indexOf('f:') === 0) {
            res({ message: 'Это файл из папки ZeppNotes — удалите его на телефоне' })
            break
          }
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
        // если приложение на часах открыто — оно пересинхронизируется
        try {
          this.call({ method: 'notes.changed', params: {} })
        } catch (e) {}
      }
    },

    // ---------- Локальный рендерер ----------
    async getJson(path) {
      let resp
      try {
        resp = await this.fetch({ method: 'GET', url: serverUrl() + path, timeout: 120000 })
      } catch (e) {
        throw new Error(NO_SERVER)
      }
      const data = parseBody(resp && resp.body !== undefined ? resp.body : resp)
      if (!data) throw new Error(NO_SERVER)
      if (data.error) throw new Error(data.error)
      return data
    },

    // ---------- Подготовка заметок ----------
    async buildSyncPayload() {
      // 1) заметки-файлы из папки ZeppNotes; если рендерер не отвечает — ошибка,
      //    и часы продолжают показывать сохранённую копию
      const folder = await this.getJson('/notes')
      const notes = readNotes().concat(folder.notes || [])

      const out = []
      for (const note of notes) {
        const blocks = []
        for (const b of parseNote(note.body)) {
          if (b.t === 'text' || b.t === 'h') {
            blocks.push(b)
            continue
          }
          try {
            ;(await this.resolveBlock(b)).forEach((r) => blocks.push(r))
          } catch (e) {
            blocks.push({ t: 'err', v: this.describe(b) + ': ' + errText(e) })
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
      setStatus('Синхронизировано: ' + new Date().toLocaleString() + ' · ' + out.length + ' шт.')
      return { notes: out }
    },

    describe(b) {
      if (b.t === 'latex') return 'LaTeX'
      if (b.t === 'photo') return 'Фото'
      if (b.t === 'pdf') return 'PDF'
      return b.t
    },

    // -> [{ t: 'img', key, w, h, cap, inline }]
    async resolveBlock(b) {
      let query
      if (b.t === 'latex') {
        query = { kind: 'latex', tex: b.v, display: b.display ? 1 : 0, w: CONTENT_W }
      } else if (b.t === 'photo') {
        query = { kind: 'image', url: b.url, w: CONTENT_W }
      } else if (b.t === 'pdf') {
        query = { kind: 'pdf', url: b.url, from: b.from, to: b.to, w: CONTENT_W }
      } else {
        throw new Error('неизвестный блок')
      }
      const data = await this.getJson('/render?' + qs(query))
      if (!Array.isArray(data.items)) throw new Error('рендерер вернул неверный ответ')

      return data.items.map((it, i) => {
        // имя картинки рендерера зависит от содержимого -> ключ меняется только при изменении файла
        const key = hashKey(it.url)
        assetSources[key] = { url: serverUrl() + it.url }
        let cap = ''
        if (b.t === 'pdf') cap = 'стр. ' + (it.page || b.from + i) + (data.pages ? ' / ' + data.pages : '')
        else if (b.t === 'photo') cap = b.alt || ''
        return { t: 'img', key, w: it.w || 0, h: it.h || 0, cap, inline: b.t === 'latex' && !b.display }
      })
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
          try {
            this.call({ method: 'asset.failed', params: { key, message: errText(e) } })
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
          task = network.downloader.downloadFile({ url, filePath, timeout: 120000 })
        } catch (e) {
          reject(e)
          return
        }
        task.onSuccess = (data) => {
          if (data && data.statusCode && data.statusCode !== 200) reject(new Error('HTTP ' + data.statusCode))
          else resolve(data)
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

    // PNG с рендерера -> формат картинок часов (image.convert) -> файл на часы
    async transferAsset(key) {
      const rawName = 'r_' + key + '.png'
      await this.fetchFile(assetSources[key].url, rawName)
      const target = 'data://download/w_' + key + '.png'
      await this.convert({ filePath: 'data://download/' + rawName, targetFilePath: target })
      await this.sendToWatch(target, { type: 'image', key })
    },
  }),
)
