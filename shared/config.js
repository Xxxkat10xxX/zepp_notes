// Общие константы для часов, телефона и side service.

// Amazfit Cheetah Square: 390 x 450, прямоугольный AMOLED
export const SCREEN_W = 390
export const SCREEN_H = 450
export const MARGIN = 20
export const CONTENT_W = SCREEN_W - MARGIN * 2 // 350 — ширина картинок

// Ключи в settingsStorage (хранилище на телефоне)
export const KEY_NOTES = 'notes' // JSON-массив [{ id, title, body, updated }]
export const KEY_SERVER = 'server' // адрес сервера рендеринга (необязательно)
export const KEY_STATUS = 'status' // строка статуса для экрана настроек

// Публичные сервисы, используемые без собственного сервера
export const CODECOGS = 'https://latex.codecogs.com/png.image?'
export const WESERV = 'https://images.weserv.nl/?'
