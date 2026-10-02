#!/usr/bin/env python3
"""Inline game.js into index.html -> pelican-ride.html (single self-contained file)."""
import pathlib
d = pathlib.Path(__file__).resolve().parent
html = (d / 'index.html').read_text(encoding='utf-8')
js = (d / 'game.js').read_text(encoding='utf-8')
tag = '<script src="game.js"></script>'
assert tag in html
out = html.replace(tag, '<script>\n' + js.replace('</script', '<\\/script') + '\n</script>')
(d / 'pelican-ride.html').write_text(out, encoding='utf-8')
print('wrote', d / 'pelican-ride.html', len(out), 'bytes')
