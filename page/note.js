// Экран просмотра заметки: текст, заголовки, формулы LaTeX, фото и страницы PDF.
import ui from '@zos/ui'
import { back } from '@zos/router'
import { setScrollMode, SCROLL_MODE_FREE } from '@zos/page'
import { BasePage } from '@zeppos/zml/base-page'
import { Column, COLORS, toast, MARGIN, CONTENT_W, SCREEN_W } from '../utils/ui-kit'
import { findNote, assetPath, loadNotes, saveNotes, handleIncomingFile } from '../utils/store'

// Длинный текст режем на куски, чтобы один TEXT-виджет не был гигантским
function chunks(text, max = 500) {
  const out = []
  text.split(/\n{2,}/).forEach((para) => {
    let p = para
    while (p.length > max) {
      let cut = p.lastIndexOf(' ', max)
      if (cut < max / 2) cut = max
      out.push(p.slice(0, cut))
      p = p.slice(cut).replace(/^\s+/, '')
    }
    if (p.trim()) out.push(p)
  })
  return out
}

function imageSize(path, b) {
  let w = b.w
  let h = b.h
  if (!w || !h) {
    try {
      const info = ui.getImageInfo && ui.getImageInfo(path)
      if (info && info.width) {
        w = info.width
        h = info.height
      }
    } catch (e) {}
  }
  if (!w || !h) {
    // размер неизвестен (старая прошивка + публичный рендер) — разумная оценка
    w = CONTENT_W
    h = b.inline ? 48 : 90
  }
  return { w: Math.min(w, CONTENT_W), h }
}

Page(
  BasePage({
    state: {
      id: null,
      col: null,
      armedDelete: false,
    },

    onInit(params) {
      try {
        const p = typeof params === 'string' ? JSON.parse(params) : params
        this.state.id = p && p.id
      } catch (e) {
        this.state.id = null
      }
      try {
        setScrollMode({ mode: SCROLL_MODE_FREE })
      } catch (e) {}
    },

    build() {
      this.state.col = new Column(0)
      this.render()
    },

    render() {
      const col = this.state.col
      col.clear()
      col.y = 28
      const note = findNote(this.state.id)
      if (!note) {
        col.text('Заметка не найдена', { size: 30, color: COLORS.err, align: ui.align.CENTER_H })
        return
      }

      col.text(note.title, { size: 36, color: COLORS.accent })
      col.gap(4)
      col.add(ui.widget.FILL_RECT, { x: MARGIN, y: col.y, w: CONTENT_W, h: 2, color: 0x333333 })
      col.gap(14)

      ;(note.blocks || []).forEach((b) => this.renderBlock(col, b))

      col.gap(24)
      col.button(
        this.state.armedDelete ? 'Точно удалить?' : 'Удалить',
        () => this.onDelete(),
        { color: 0x3a1212, press: 0x5a1a1a, textColor: COLORS.err },
      )
      col.gap(90)
      col.add(ui.widget.FILL_RECT, { x: MARGIN, y: col.y, w: CONTENT_W, h: 1, color: COLORS.bg })
    },

    renderBlock(col, b) {
      switch (b.t) {
        case 'h':
          col.gap(6)
          col.text(b.v, { size: 32, color: COLORS.text })
          col.gap(6)
          break
        case 'text':
          chunks(b.v).forEach((c) => {
            col.text(c, { size: 28 })
            col.gap(8)
          })
          break
        case 'err':
          col.text('⚠ ' + b.v, { size: 22, color: COLORS.err })
          col.gap(8)
          break
        case 'img': {
          const path = assetPath(b.key)
          if (!path) {
            const h = b.h ? Math.min(b.h, 200) : 60
            col.add(ui.widget.STROKE_RECT, {
              x: MARGIN,
              y: col.y,
              w: CONTENT_W,
              h,
              radius: 12,
              line_width: 2,
              color: 0x444444,
            })
            col.add(ui.widget.TEXT, {
              x: MARGIN,
              y: col.y,
              w: CONTENT_W,
              h,
              text: 'загрузка…',
              text_size: 22,
              color: COLORS.sub,
              align_h: ui.align.CENTER_H,
              align_v: ui.align.CENTER_V,
            })
            col.y += h + 10
            break
          }
          const { w, h } = imageSize(path, b)
          const x = b.inline ? MARGIN : Math.round((SCREEN_W - w) / 2)
          col.add(ui.widget.IMG, { x, y: col.y, w, h, src: path })
          col.y += h
          if (b.cap) {
            col.gap(4)
            col.text(b.cap, { size: 20, color: COLORS.sub, align: ui.align.CENTER_H })
          }
          col.gap(10)
          break
        }
        default:
          break
      }
    },

    onDelete() {
      if (!this.state.armedDelete) {
        this.state.armedDelete = true
        toast('Нажмите ещё раз для удаления')
        this.render()
        return
      }
      const id = this.state.id
      this.request({ method: 'notes.delete', params: { id } })
        .then(() => {
          saveNotes(loadNotes().filter((n) => n.id !== id))
          back()
        })
        .catch((e) => {
          this.state.armedDelete = false
          toast(e && e.message ? e.message : 'Телефон недоступен — удаление невозможно')
          this.render()
        })
    },

    onReceivedFile(file) {
      handleIncomingFile(file, (key) => {
        const note = findNote(this.state.id)
        if (note && (note.blocks || []).some((b) => b.key === key)) this.render()
      })
    },
  }),
)
