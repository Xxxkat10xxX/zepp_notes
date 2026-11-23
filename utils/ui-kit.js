// Небольшие помощники для построения UI на часах.
import ui from '@zos/ui'
import { SCREEN_W, MARGIN, CONTENT_W } from '../shared/config'

export const COLORS = {
  bg: 0x000000,
  card: 0x1c1c1e,
  cardPress: 0x3a3a3c,
  accent: 0xffb300,
  text: 0xffffff,
  sub: 0x9e9e9e,
  err: 0xff5252,
}

/** Простая "раскладка сверху вниз": помнит текущую координату y и созданные виджеты. */
export class Column {
  constructor(y = 0) {
    this.y = y
    this.widgets = []
  }

  add(type, opts) {
    const w = ui.createWidget(type, opts)
    this.widgets.push(w)
    return w
  }

  gap(h) {
    this.y += h
  }

  clear() {
    this.widgets.forEach((w) => {
      try {
        ui.deleteWidget(w)
      } catch (e) {}
    })
    this.widgets = []
  }

  textHeight(text, size, width = CONTENT_W) {
    try {
      const l = ui.getTextLayout(text, { text_size: size, text_width: width, wrapped: 1 })
      if (l && l.height) return l.height + 6
    } catch (e) {}
    // запасной вариант: грубая оценка
    const perLine = Math.max(1, Math.floor(width / (size * 0.55)))
    const lines = String(text)
      .split('\n')
      .reduce((acc, l) => acc + Math.max(1, Math.ceil(l.length / perLine)), 0)
    return lines * Math.round(size * 1.3) + 6
  }

  text(text, { size = 28, color = COLORS.text, align = ui.align.LEFT, x = MARGIN, w = CONTENT_W } = {}) {
    const h = this.textHeight(text, size, w)
    const widget = this.add(ui.widget.TEXT, {
      x,
      y: this.y,
      w,
      h,
      text,
      text_size: size,
      color,
      align_h: align,
      align_v: ui.align.TOP,
      text_style: ui.text_style.WRAP,
    })
    this.y += h
    return widget
  }

  button(text, onClick, { h = 64, color = COLORS.card, press = COLORS.cardPress, textColor = COLORS.text } = {}) {
    const widget = this.add(ui.widget.BUTTON, {
      x: MARGIN,
      y: this.y,
      w: CONTENT_W,
      h,
      radius: 16,
      normal_color: color,
      press_color: press,
      color: textColor,
      text_size: 28,
      text,
      click_func: onClick,
    })
    this.y += h
    return widget
  }

  /** Карточка заметки: заголовок + превью, кликабельна целиком. */
  card(title, sub, onClick) {
    const pad = 16
    const titleH = this.textHeight(title, 30, CONTENT_W - pad * 2)
    const subH = sub ? this.textHeight(sub, 22, CONTENT_W - pad * 2) : 0
    const h = Math.min(titleH, 80) + Math.min(subH, 64) + pad * 2
    const top = this.y
    const bg = this.add(ui.widget.FILL_RECT, {
      x: MARGIN,
      y: top,
      w: CONTENT_W,
      h,
      radius: 16,
      color: COLORS.card,
    })
    const t = this.add(ui.widget.TEXT, {
      x: MARGIN + pad,
      y: top + pad,
      w: CONTENT_W - pad * 2,
      h: Math.min(titleH, 80),
      text: title,
      text_size: 30,
      color: COLORS.text,
      text_style: ui.text_style.ELLIPSIS,
    })
    let s = null
    if (sub) {
      s = this.add(ui.widget.TEXT, {
        x: MARGIN + pad,
        y: top + pad + Math.min(titleH, 80),
        w: CONTENT_W - pad * 2,
        h: Math.min(subH, 64),
        text: sub,
        text_size: 22,
        color: COLORS.sub,
        text_style: ui.text_style.WRAP,
      })
    }
    ;[bg, t, s].forEach((w) => {
      if (!w) return
      w.addEventListener(ui.event.CLICK_DOWN, () => bg.setProperty(ui.prop.COLOR, COLORS.cardPress))
      w.addEventListener(ui.event.CLICK_UP, () => {
        bg.setProperty(ui.prop.COLOR, COLORS.card)
        onClick()
      })
    })
    this.y += h
  }
}

export function toast(text) {
  try {
    ui.showToast({ text })
  } catch (e) {
    console.log('toast', text)
  }
}

export { SCREEN_W, MARGIN, CONTENT_W }
