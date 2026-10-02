#!/usr/bin/env python3
"""Inline game.js into index.html -> pelican-ride.html (single self-contained file).

The single file is meant to be opened straight from disk (file://), so it drops the PWA bits:
the manifest / icon links (they would 404 there) and it tells game.js not to register the service worker.
"""
import pathlib, re
d = pathlib.Path(__file__).resolve().parent
html = (d / 'index.html').read_text(encoding='utf-8')
js = (d / 'game.js').read_text(encoding='utf-8')
tag = '<script src="game.js"></script>'
assert tag in html
# strip PWA head tags
html, n = re.subn(r'\s*<link rel="(?:manifest|icon|apple-touch-icon)"[^>]*>', '', html)
assert n >= 2, 'expected manifest/icon links in index.html'
html = html.replace('<title>', '<link rel="icon" href="data:,">\n<title>', 1)
out = html.replace(tag, '<script>window.__PELICAN_SINGLE_FILE__ = true;</script>\n<script>\n' + js.replace('</script', '<\\/script') + '\n</script>')
(d / 'pelican-ride.html').write_text(out, encoding='utf-8')
print('wrote', d / 'pelican-ride.html', len(out), 'bytes')
