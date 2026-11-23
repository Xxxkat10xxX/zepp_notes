// CI: из собранного .zab достаёт пакет для Amazfit Cheetah Square (390x450, NXP),
// кладёт его в site/ вместе со страницей установки и QR-кодами для приложения Zepp.
//   node tools/ci-package.mjs <pagesBaseUrl> <releaseDownloadBase>
import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import QRCode from 'qrcode'

const [pagesBase, releaseBase] = process.argv.slice(2)
const ZIP_NAME = 'cheetah-square.zip'

const dist = 'dist'
const zabName = fs.readdirSync(dist).find((f) => f.endsWith('.zab'))
if (!zabName) throw new Error('no .zab in dist/ — run zeus build first')
const zab = await JSZip.loadAsync(fs.readFileSync(path.join(dist, zabName)))
const manifest = JSON.parse(await zab.file('manifest.json').async('string'))
const zpk = manifest.zpks.find((z) =>
  (z.platforms || []).some(
    (p) => p.screenType === 'square' && p.screenResolution === '390x450' && p.cpuPlatform === 'NXP',
  ),
)
if (!zpk) throw new Error('no 390x450 NXP package in ' + zabName + ': ' + JSON.stringify(manifest))

fs.mkdirSync('site', { recursive: true })
fs.writeFileSync(path.join('site', ZIP_NAME), await zab.file(zpk.name).async('nodebuffer'))
fs.copyFileSync(path.join(dist, zabName), path.join('site', 'zepp-notes.zab'))

const toZpkd = (httpUrl) => httpUrl.replace(/^https?:\/\//, 'zpkd1://')
const pagesLink = toZpkd(pagesBase.replace(/\/?$/, '/') + ZIP_NAME)
const releaseLink = toZpkd(releaseBase.replace(/\/?$/, '/') + ZIP_NAME)
await QRCode.toFile('site/qr.png', pagesLink, { width: 560, margin: 2 })
await QRCode.toFile('site/qr-release.png', releaseLink, { width: 560, margin: 2 })

const appJson = JSON.parse(fs.readFileSync('app.json', 'utf8'))
const version = appJson.app.version.name
const built = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC'

fs.writeFileSync(
  'site/index.html',
  `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Заметки — установка</title>
<style>
:root{--bg:#fff;--fg:#111;--sub:#666;--card:#f3f3f3;--acc:#c78800}
@media (prefers-color-scheme:dark){:root{--bg:#000;--fg:#eee;--sub:#999;--card:#1c1c1e;--acc:#ffb300}}
body{background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif;margin:0 auto;max-width:560px;padding:16px}
h1{color:var(--acc);margin:.2em 0}.sub{color:var(--sub);font-size:14px}
img{width:100%;max-width:360px;display:block;margin:12px auto;background:#fff;border-radius:12px}
.card{background:var(--card);border-radius:12px;padding:12px 14px;margin:12px 0}
a.btn{display:block;text-align:center;background:var(--acc);color:#000;text-decoration:none;padding:12px;border-radius:12px;font-weight:600;margin:8px 0}
code{word-break:break-all;font-size:13px}
</style></head><body>
<h1>Заметки для Cheetah Square</h1>
<div class="sub">Версия ${version} · сборка ${built}</div>
<div class="card"><b>1.</b> В приложении Zepp включите режим разработчика:
Профиль → Настройки → О программе → 7 раз нажмите на логотип Zepp.</div>
<div class="card"><b>2.</b> Профиль → Режим разработчика → значок сканера.
Наведите на QR-код (с экрана другого устройства или распечатки) — или, если в сканере есть
кнопка «Альбом», сохраните QR-картинку и выберите её.</div>
<img src="qr.png" alt="QR-код установки">
<div class="card"><b>Или попробуйте</b> просто нажать кнопку — если Zepp перехватит ссылку, установка начнётся сразу:
<a class="btn" href="${pagesLink}">Установить в Zepp</a>
<code>${pagesLink}</code></div>
<details class="card"><summary>Запасной QR (через GitHub Releases)</summary>
<img src="qr-release.png" alt="Запасной QR-код"><code>${releaseLink}</code></details>
<div class="card">Файлы: <a href="${ZIP_NAME}">${ZIP_NAME}</a> · <a href="zepp-notes.zab">zepp-notes.zab</a></div>
</body></html>
`,
)
console.log('package:', zpk.name, '->', 'site/' + ZIP_NAME)
console.log('pages link:', pagesLink)
console.log('release link:', releaseLink)
