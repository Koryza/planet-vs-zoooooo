#!/usr/bin/env python3
"""Build the offline game and downloadable archive using only Python's stdlib."""
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
html = (ROOT / 'index.html').read_text(encoding='utf-8')
html = html.replace('<link rel="stylesheet" href="style.css">',
                    '<style>' + (ROOT / 'style.css').read_text(encoding='utf-8') + '</style>')
for name in ('music.js', 'rift.js', 'game.js'):
    script = (ROOT / name).read_text(encoding='utf-8').replace('</script', '<\\/script')
    html = html.replace(f'<script src="{name}"></script>', '<script>' + script + '</script>')
(ROOT / 'ИГРАТЬ.html').write_text(html, encoding='utf-8')
# Fixed timestamps make repeated builds of the same inputs byte-for-byte stable.
with zipfile.ZipFile(ROOT / 'Зелёный-рубеж.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in ('ИГРАТЬ.html', 'README.md'):
        info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(info, (ROOT / name).read_bytes())
print('Built ИГРАТЬ.html and Зелёный-рубеж.zip')
