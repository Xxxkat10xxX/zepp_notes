// Главный экран: список заметок + синхронизация с телефоном.
import ui from '@zos/ui'
import { push } from '@zos/router'
import { setScrollMode, SCROLL_MODE_FREE } from '@zos/page'
import { BasePage } from '@zeppos/zml/base-page'
import { Column, COLORS, toast, MARGIN, CONTENT_W } from '../utils/ui-kit'
import { loadNotes, saveNotes, missingKeys, pruneAssets, handleIncomingFile } from '../utils/store'

Page(
  BasePage({
    state: {
      col: null,
      status: '',
      syncing: false,
      pending: 0,
      statusWidget: null,
    },

    onInit() {
      try {
        setScrollMode({ mode: SCROLL_MODE_FREE })
      } catch (e) {}
    },

    build() {
      this.state.col = new Column(0)
      this.render()
      this.sync()
    },

    onResume() {
      // вернулись со страницы заметки — список мог измениться (удаление)
      this.render()
    },

    render() {
      const col = this.state.col
      col.clear()
      col.y = 24
      col.text('Заметки', { size: 40, color: COLORS.accent, align: ui.align.CENTER_H })
      this.state.statusWidget = col.text(this.state.status || ' ', {
        size: 20,
        color: COLORS.sub,
        align: ui.align.CENTER_H,
      })
      col.gap(12)

      const notes = loadNotes()
      if (!notes.length) {
        col.text(
          'Заметок пока нет.\nПоложите .md, PDF или фото в папку ZeppNotes на телефоне или создайте заметку в настройках приложения в Zepp.',
          { size: 24, color: COLORS.sub, align: ui.align.CENTER_H },
        )
        col.gap(16)
      }
      notes.forEach((n) => {
        col.card(n.title, n.preview, () => push({ url: 'page/note', params: JSON.stringify({ id: n.id }) }))
        col.gap(12)
      })

      col.gap(8)
      if (typeof ui.createKeyboard === 'function') {
        col.button('+ Быстрая заметка', () => this.quickNote(), { color: 0x2e2a12, textColor: COLORS.accent })
        col.gap(12)
      }
      col.button(this.state.syncing ? 'Синхронизация…' : '⟳ Синхронизировать', () => this.sync())
      col.gap(90) // запас снизу для прокрутки
      // невидимый "якорь", чтобы страница точно прокручивалась до конца
      col.add(ui.widget.FILL_RECT, { x: MARGIN, y: col.y, w: CONTENT_W, h: 1, color: COLORS.bg })
    },

    // rerender=false: меняем только строку статуса, не сбрасывая прокрутку списка
    setStatus(s, rerender = false) {
      this.state.status = s
      if (rerender || !this.state.statusWidget) {
        this.render()
      } else {
        this.state.statusWidget.setProperty(ui.prop.TEXT, s)
      }
    },

    sync() {
      if (this.state.syncing) return
      this.state.syncing = true
      this.setStatus('Синхронизация с телефоном…', true)
      this.request({ method: 'notes.sync', params: {} })
        .then((res) => {
          const notes = (res && res.notes) || []
          saveNotes(notes)
          pruneAssets(notes)
          const missing = missingKeys(notes)
          this.state.syncing = false
          if (missing.length) {
            this.state.pending = missing.length
            this.setStatus('Загрузка картинок: ' + missing.length, true)
            return this.request({ method: 'assets.get', params: { keys: missing } })
          }
          this.setStatus('Готово · ' + notes.length + ' шт.', true)
        })
        .catch((e) => {
          this.state.syncing = false
          const msg = e && e.message ? e.message : 'Нет связи с телефоном'
          this.setStatus(msg + ' · показаны сохранённые', true)
          console.log('sync error', JSON.stringify(e))
        })
    },

    quickNote() {
      ui.createKeyboard({
        inputType: ui.inputType ? ui.inputType.CHAR : undefined,
        text: '',
        onComplete: (_, result) => {
          try {
            ui.deleteKeyboard()
          } catch (e) {}
          const body = (result && result.data) || ''
          if (!body.trim()) return
          const title = body.split('\n')[0].slice(0, 40)
          this.request({ method: 'notes.add', params: { title, body } })
            .then(() => {
              toast('Сохранено')
              this.sync()
            })
            .catch(() => toast('Телефон недоступен'))
        },
        onCancel: () => {
          try {
            ui.deleteKeyboard()
          } catch (e) {}
        },
      })
    },

    onCall(data) {
      if (data && data.method === 'notes.changed') this.sync()
      if (data && data.method === 'asset.failed') {
        this.state.pending = Math.max(0, this.state.pending - 1)
        this.setStatus('Ошибка загрузки картинки')
      }
    },

    onReceivedFile(file) {
      handleIncomingFile(file, () => {
        this.state.pending = Math.max(0, this.state.pending - 1)
        this.setStatus(this.state.pending ? 'Загрузка картинок: ' + this.state.pending : 'Готово')
      })
    },
  }),
)
