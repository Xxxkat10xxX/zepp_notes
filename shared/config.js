// Общие константы для часов, телефона и side service.

// Amazfit Cheetah Square: 390 x 450, прямоугольный AMOLED
export const SCREEN_W = 390
export const SCREEN_H = 450
export const MARGIN = 20
export const CONTENT_W = SCREEN_W - MARGIN * 2 // 350 — ширина картинок

// Ключи в settingsStorage (хранилище на телефоне)
export const KEY_NOTES = 'notes' // JSON-массив [{ id, title, body, updated }]
export const KEY_SERVER = 'server' // адрес офлайн-рендерера (Termux на этом же телефоне)
export const DEFAULT_SERVER = 'http://127.0.0.1:8787'
export const KEY_STATUS = 'status' // строка статуса для экрана настроек
