// Проверка парсера разметки: node tools/test-markup.mjs
import assert from 'node:assert/strict'
import { parseNote, hashKey, previewOf } from '../shared/markup.js'

const body = `# Физика
Энергия $E=mc^2$ и цена \\$5.
$$ \\int_0^1 x^2\\,dx = \\frac13 \\\\ a^2+b^2=c^2 $$
![кот](https://example.com/cat.jpg)
## Конспект
[pdf](https://example.com/a.pdf)
[pdf:3-5](https://example.com/b.pdf)
[pdf:7](https://example.com/c.pdf)
конец`

const b = parseNote(body)
const types = b.map((x) => x.t).join(',')
assert.equal(types, 'h,text,latex,text,latex,photo,h,pdf,pdf,pdf,text')
assert.deepEqual(b[0], { t: 'h', v: 'Физика' })
assert.equal(b[1].v, 'Энергия ')
assert.deepEqual(b[2], { t: 'latex', v: 'E=mc^2', display: false })
assert.equal(b[3].v, ' и цена $5.')
assert.equal(b[4].display, true)
assert.ok(b[4].v.startsWith('\\int_0^1'))
assert.deepEqual(b[5], { t: 'photo', url: 'https://example.com/cat.jpg', alt: 'кот' })
assert.deepEqual(b[7], { t: 'pdf', url: 'https://example.com/a.pdf', from: 1, to: 30 })
assert.deepEqual(b[8], { t: 'pdf', url: 'https://example.com/b.pdf', from: 3, to: 5 })
assert.deepEqual(b[9], { t: 'pdf', url: 'https://example.com/c.pdf', from: 7, to: 7 })
assert.equal(b[10].v, 'конец')

assert.deepEqual(parseNote(''), [])
assert.deepEqual(parseNote('просто текст'), [{ t: 'text', v: 'просто текст' }])
assert.equal(hashKey('abc'), hashKey('abc'))
assert.notEqual(hashKey('abc'), hashKey('abd'))
assert.match(hashKey('x'), /^[0-9a-z]+$/)
assert.equal(previewOf('# T\n$$x$$ ![](u) [pdf](p)'), 'T ∑ 🖼 PDF')

console.log('markup tests passed:', b.length, 'blocks')

// --- ссылки облачных дисков и вписывание размеров ---
const { directLink, fitBox, weservBoxUrl } = await import('../shared/sources.js')
assert.equal(
  directLink('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing').url,
  'https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOp',
)
assert.equal(
  directLink('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp').url,
  'https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOp',
)
assert.equal(
  directLink('https://www.dropbox.com/scl/fi/abc/cat.jpg?rlkey=xyz&dl=0').url,
  'https://www.dropbox.com/scl/fi/abc/cat.jpg?rlkey=xyz&raw=1',
)
assert.equal(directLink('https://www.dropbox.com/s/abc/cat.jpg').url, 'https://www.dropbox.com/s/abc/cat.jpg?raw=1')
assert.equal(directLink('https://disk.yandex.ru/i/AbCd123').yandex, true)
assert.equal(directLink('https://yadi.sk/d/AbCd123').yandex, true)
assert.equal(directLink('https://example.com/a.jpg').url, 'https://example.com/a.jpg')
assert.deepEqual(fitBox(1200, 900, 350, 600), { w: 350, h: 263 })
assert.deepEqual(fitBox(1000, 3000, 350, 600), { w: 200, h: 600 })
assert.deepEqual(fitBox(100, 50, 350), { w: 100, h: 50 })
assert.deepEqual(fitBox(612, 792, 350, 0, true), { w: 350, h: 453 })
assert.match(weservBoxUrl('https://x/y.pdf', 350, 453, 0), /page=0/)
console.log('source tests passed')
