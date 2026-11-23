// Экран настроек в приложении Zepp на телефоне: создание и редактирование заметок.
import { KEY_NOTES, KEY_SERVER, KEY_STATUS } from '../shared/config'
import { previewOf } from '../shared/markup'

const KEY_EDIT = 'ui:editing' // id редактируемой заметки ('' — список)

const ACCENT = '#ffb300'

function getNotes(storage) {
  try {
    const v = JSON.parse(storage.getItem(KEY_NOTES) || '[]')
    return Array.isArray(v) ? v : []
  } catch (e) {
    return []
  }
}

function setNotes(storage, notes) {
  storage.setItem(KEY_NOTES, JSON.stringify(notes))
}

function updateNote(storage, id, patch) {
  const notes = getNotes(storage).map((n) => (n.id === id ? { ...n, ...patch, updated: Date.now() } : n))
  setNotes(storage, notes)
}

function appendToBody(storage, note, snippet) {
  const body = note.body ? note.body.replace(/\s+$/, '') + '\n' + snippet + '\n' : snippet + '\n'
  updateNote(storage, note.id, { body })
}

function header(text) {
  return Text({ paragraph: true, style: { fontSize: '20px', fontWeight: 'bold', color: ACCENT, margin: '16px 0 8px' } }, [text])
}

function hint(text) {
  return Text({ paragraph: true, style: { fontSize: '13px', color: '#888', margin: '4px 0' } }, [text])
}

function btn(label, onClick, color = 'default') {
  return View({ style: { margin: '6px 0' } }, [Button({ label, color, onClick })])
}

function listView(storage) {
  const notes = getNotes(storage)
  const items = notes.map((n, i) =>
    View(
      {
        style: {
          padding: '10px 12px',
          margin: '6px 0',
          borderRadius: '10px',
          background: '#f3f3f3',
        },
      },
      [
        Text({ paragraph: true, style: { fontSize: '16px', fontWeight: 'bold' } }, [n.title || 'Без названия']),
        Text({ paragraph: true, style: { fontSize: '13px', color: '#666', margin: '4px 0 6px' } }, [
          previewOf(n.body, 90) || '—',
        ]),
        View({ style: { display: 'flex', flexDirection: 'row', gap: '8px' } }, [
          Button({ label: 'Изменить', color: 'primary', onClick: () => storage.setItem(KEY_EDIT, n.id) }),
          i > 0
            ? Button({
                label: '↑',
                onClick: () => {
                  const arr = getNotes(storage)
                  const tmp = arr[i - 1]
                  arr[i - 1] = arr[i]
                  arr[i] = tmp
                  setNotes(storage, arr)
                },
              })
            : null,
        ].filter(Boolean)),
      ],
    ),
  )

  return Section({}, [
    header('Заметки'),
    ...(items.length ? items : [hint('Пока пусто. Нажмите «Новая заметка».')]),
    btn(
      '+ Новая заметка',
      () => {
        const id = 'n' + Date.now().toString(36)
        const arr = getNotes(storage)
        arr.unshift({ id, title: 'Новая заметка', body: '', updated: Date.now() })
        setNotes(storage, arr)
        storage.setItem(KEY_EDIT, id)
      },
      'primary',
    ),

    header('Файлы с телефона (офлайн)'),
    hint(
      'Всё работает без интернета. Положите файлы в папку «ZeppNotes» во внутренней памяти ' +
        '(через «Файлы» или «Поделиться → Сохранить»):',
    ),
    hint('• лекция.pdf — станет заметкой со страницами PDF'),
    hint('• фото.jpg — станет заметкой-фото'),
    hint('• конспект.md / .txt — текстовая заметка с формулами (первая строка «# …» — заголовок)'),
    hint(
      'Картинки, формулы и PDF рисует рендерер в Termux на этом же телефоне. ' +
        'Он должен быть запущен во время синхронизации (команда zepp-notes в Termux).',
    ),

    header('Синтаксис'),
    hint('# Заголовок'),
    hint('$$ \\int_0^1 x^2\\,dx = \\frac13 $$ — формула'),
    hint('$E=mc^2$ — короткая формула'),
    hint('![подпись](file:фото.jpg) — фото из папки ZeppNotes'),
    hint('[pdf](file:лекция.pdf) — PDF целиком (до 30 стр.)'),
    hint('[pdf:31-60](file:лекция.pdf) — страницы 31–60'),
    hint('\\$ — знак доллара'),

    header('Адрес рендерера'),
    TextInput({
      label: 'Адрес (пусто = http://127.0.0.1:8787)',
      placeholder: 'http://127.0.0.1:8787',
      value: storage.getItem(KEY_SERVER) || '',
      onChange: (v) => storage.setItem(KEY_SERVER, String(v || '').trim()),
    }),
    Text({ paragraph: true, style: { fontSize: '12px', color: '#aaa', margin: '12px 0' } }, [
      storage.getItem(KEY_STATUS) || '',
    ]),
  ])
}

function editView(storage, note) {
  return Section({}, [
    btn('← К списку', () => storage.setItem(KEY_EDIT, '')),
    header('Редактирование'),
    TextInput({
      label: 'Заголовок',
      value: note.title || '',
      maxLength: 80,
      onChange: (v) => updateNote(storage, note.id, { title: String(v || '') }),
    }),
    TextInput({
      label: 'Текст заметки',
      placeholder: 'Текст, формулы $...$, ![](url), [pdf](url)',
      value: note.body || '',
      multiline: true,
      rows: 10,
      maxLength: 20000,
      onChange: (v) => updateNote(storage, note.id, { body: String(v || '') }),
    }),
    View({ style: { padding: '8px', background: '#f7f7f7', borderRadius: '8px', margin: '8px 0' } }, [
      Text({ paragraph: true, style: { fontSize: '13px', color: '#444', whiteSpace: 'pre-wrap' } }, [
        note.body || '(пусто)',
      ]),
    ]),

    header('Быстро добавить'),
    TextInput({
      label: '+ Формула LaTeX',
      placeholder: '\\sum_{n=1}^\\infty \\frac{1}{n^2} = \\frac{\\pi^2}{6}',
      value: '',
      onChange: (v) => v && appendToBody(storage, note, '$$ ' + v + ' $$'),
    }),
    TextInput({
      label: '+ Фото (имя файла в папке ZeppNotes)',
      placeholder: 'фото.jpg',
      value: '',
      onChange: (v) => v && appendToBody(storage, note, '![](file:' + String(v).trim() + ')'),
    }),
    TextInput({
      label: '+ PDF (имя файла в папке ZeppNotes)',
      placeholder: 'лекция.pdf',
      value: '',
      onChange: (v) => v && appendToBody(storage, note, '[pdf](file:' + String(v).trim() + ')'),
    }),
    hint('Сначала скопируйте фото / PDF в папку ZeppNotes, затем впишите сюда имя файла.'),

    btn(
      'Удалить заметку',
      () => {
        setNotes(storage, getNotes(storage).filter((n) => n.id !== note.id))
        storage.setItem(KEY_EDIT, '')
      },
      'secondary',
    ),
  ])
}

AppSettingsPage({
  build(props) {
    const storage = props.settingsStorage
    const editing = storage.getItem(KEY_EDIT)
    const note = editing ? getNotes(storage).find((n) => n.id === editing) : null
    return View({ style: { padding: '12px 16px' } }, [note ? editView(storage, note) : listView(storage)])
  },
})
