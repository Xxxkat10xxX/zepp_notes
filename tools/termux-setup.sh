#!/data/data/com.termux/files/usr/bin/bash
# Установка офлайн-рендерера «Заметок» в Termux (Android). Интернет нужен только сейчас.
#   bash termux-setup.sh
set -e

REPO_RAW="https://raw.githubusercontent.com/Xxxkat10xxX/zepp_notes/claude/sharp-turing-mpom9u"
APP_DIR="$HOME/zepp-notes"

echo "== Пакеты Termux (python, Pillow, mupdf-tools, matplotlib) =="
pkg update -y
pkg install -y python python-pillow mupdf-tools matplotlib curl

echo "== Доступ к памяти телефона =="
if [ ! -d "$HOME/storage/shared" ]; then
  termux-setup-storage
  echo "Разрешите доступ к файлам во всплывающем окне, затем нажмите Enter"
  read -r _
fi
mkdir -p "$HOME/storage/shared/ZeppNotes"

echo "== Рендерер =="
mkdir -p "$APP_DIR"
if [ -f "$(dirname "$0")/render_server.py" ]; then
  cp "$(dirname "$0")/render_server.py" "$APP_DIR/"
else
  curl -fsSL "$REPO_RAW/tools/render_server.py" -o "$APP_DIR/render_server.py"
fi

# Пример заметки, чтобы сразу было что открыть на часах
EXAMPLE="$HOME/storage/shared/ZeppNotes/Пример.md"
if [ ! -f "$EXAMPLE" ]; then
  cat > "$EXAMPLE" <<'NOTE'
# Пример заметки
Обычный текст. Формула в строке: $E=mc^2$.

$$ \int_0^1 x^2\,dx = \frac{1}{3} $$

$$ \sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6} $$

Фото: положите в эту папку файл и напишите ![подпись](file:имя.jpg)
PDF: [pdf](file:имя.pdf) или [pdf:1-3](file:имя.pdf)
NOTE
fi

# Команда zepp-notes: запуск рендерера (экран может гаснуть — wake-lock держит процесс)
cat > "$PREFIX/bin/zepp-notes" <<SH
#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock 2>/dev/null || true
exec python "$APP_DIR/render_server.py" --host 127.0.0.1 --port 8787 --notes-dir "\$HOME/storage/shared/ZeppNotes" "\$@"
SH
chmod +x "$PREFIX/bin/zepp-notes"

# Автозапуск после перезагрузки (если установлен Termux:Boot)
mkdir -p "$HOME/.termux/boot"
cat > "$HOME/.termux/boot/zepp-notes.sh" <<'SH'
#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock
nohup zepp-notes >/dev/null 2>&1 &
SH
chmod +x "$HOME/.termux/boot/zepp-notes.sh"

echo
echo "Готово. Запуск рендерера:  zepp-notes"
echo "Папка с заметками: Внутренняя память/ZeppNotes"
