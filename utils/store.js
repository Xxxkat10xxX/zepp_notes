// Локальное хранилище на часах: заметки и картинки, полученные с телефона.
import { readFileSync, writeFileSync, rmSync } from '@zos/fs'

const NOTES_FILE = 'notes.json'
const ASSETS_FILE = 'assets.json'

function readJson(path, fallback) {
  try {
    const s = readFileSync({ path, options: { encoding: 'utf8' } })
    return s ? JSON.parse(s) : fallback
  } catch (e) {
    return fallback
  }
}

function writeJson(path, value) {
  try {
    writeFileSync({ path, data: JSON.stringify(value), options: { encoding: 'utf8' } })
  } catch (e) {
    console.log('writeJson failed', path, e)
  }
}

export function loadNotes() {
  const v = readJson(NOTES_FILE, [])
  return Array.isArray(v) ? v : []
}

export function saveNotes(notes) {
  writeJson(NOTES_FILE, notes)
}

export function findNote(id) {
  return loadNotes().find((n) => n.id === id)
}

// key -> 'data://download/....png'
export function loadAssets() {
  return readJson(ASSETS_FILE, {})
}

export function assetPath(key) {
  return loadAssets()[key]
}

export function putAsset(key, filePath) {
  const a = loadAssets()
  a[key] = filePath
  writeJson(ASSETS_FILE, a)
}

/** Ключи картинок, которые упомянуты в заметках, но ещё не скачаны. */
export function missingKeys(notes) {
  const have = loadAssets()
  const out = []
  notes.forEach((n) =>
    (n.blocks || []).forEach((b) => {
      if (b.t === 'img' && !have[b.key] && out.indexOf(b.key) === -1) out.push(b.key)
    }),
  )
  return out
}

/** Удаляет файлы картинок, на которые больше не ссылается ни одна заметка. */
export function pruneAssets(notes) {
  const used = {}
  notes.forEach((n) => (n.blocks || []).forEach((b) => b.t === 'img' && (used[b.key] = 1)))
  const a = loadAssets()
  let changed = false
  Object.keys(a).forEach((key) => {
    if (!used[key]) {
      try {
        rmSync({ path: String(a[key]).replace(/^data:\/\//, '') })
      } catch (e) {}
      delete a[key]
      changed = true
    }
  })
  if (changed) writeJson(ASSETS_FILE, a)
}

/** Общий обработчик входящего файла (вызывается из onReceivedFile страниц). */
export function handleIncomingFile(file, onReady) {
  file.on('change', (event) => {
    if (!event || !event.data || event.data.readyState !== 'transferred') return
    let params = file.params || {}
    if (typeof params === 'string') {
      try {
        params = JSON.parse(params)
      } catch (e) {
        params = {}
      }
    }
    if (params.key) {
      putAsset(params.key, file.filePath)
      onReady && onReady(params.key)
    }
  })
}
