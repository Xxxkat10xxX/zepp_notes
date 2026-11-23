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

// имена файлов с пробелами и кириллицей
const f = parseNote('![фото](file:Отпуск 2025.jpg)\n[pdf:2-3]( file:Лекция 1.pdf )')
assert.deepEqual(f[0], { t: 'photo', url: 'file:Отпуск 2025.jpg', alt: 'фото' })
assert.deepEqual(f[1], { t: 'pdf', url: 'file:Лекция 1.pdf', from: 2, to: 3 })

console.log('markup tests passed:', b.length, 'blocks')

