#!/usr/bin/env python3
"""Tiny HTTP server for the LaTeXML conversion service.

Endpoints:
  POST /convert  { kind: 'tex'|'pdf', slug, texPath?, bytes? } -> { html }
  GET  /health
"""
from __future__ import annotations
import base64, json, os, re, subprocess, sys
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TEX_ROOT = Path('/data/tex')
CACHE: Path = Path('/cache')
CACHE.mkdir(parents=True, exist_ok=True)

def load_manifest():
    p = TEX_ROOT / 'manifest.json'
    if not p.exists(): return {}
    try: return json.loads(p.read_text())
    except Exception: return {}

def run(cmd, timeout=180):
    return subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=timeout)

class Handler(BaseHTTPRequestHandler):
    def _send(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != '/convert':
            return self._send({'error': 'not found'}, 404)
        try:
            req = json.loads(self.rfile.read(int(self.headers['Content-Length'] or 0)))
        except Exception as e:
            return self._send({'error': f'bad body: {e}'}, 400)

        kind = req.get('kind')
        slug = req.get('slug', 'unknown')
        try:
            if kind == 'tex':
                html = self._convert_tex(req.get('texPath', ''), slug)
            elif kind == 'pdf':
                b64 = req.get('bytes', '')
                html = self._convert_pdf(base64.b64decode(b64), slug)
            else:
                return self._send({'error': 'kind must be tex or pdf'}, 400)
            return self._send({'html': html})
        except Exception as e:
            return self._send({'error': str(e)}, 502)

    def _convert_tex(self, tex_path: str, slug: str) -> str:
        dest = CACHE / f'{slug}.html'
        if dest.exists():
            return str(dest)
        src = TEX_ROOT / tex_path
        if not src.exists():
            raise FileNotFoundError(f'tex not found: {src}')
        run(['latexml', '--dest', str(dest), str(src)], timeout=180)
        return str(dest)

    def _convert_pdf(self, data: bytes, slug: str) -> str:
        dest = CACHE / f'{slug}.html'
        if dest.exists():
            return str(dest)
        pdf = TEX_ROOT / 'pdftmp' / f'{slug}.pdf'
        pdf.parent.mkdir(parents=True, exist_ok=True)
        pdf.write_bytes(data)
        run(['pdftohtml', '-c', str(pdf), str(CACHE / slug)], timeout=180)
        out = CACHE / f'{slug}.html'
        if not out.exists():
            out = sorted(CACHE.glob(f'{slug}*.html'))[0]
        return str(out)

    def do_GET(self):
        if self.path == '/health':
            return self._send({'ok': True, 'cache': len(list(CACHE.glob('*.html')))})
        return self._send({'error': 'not found'}, 404)

    def log_message(self, fmt, *args):
        print(fmt % args, flush=True)

if __name__ == '__main__':
    port = int(os.environ.get('LATEXML_PORT', '8080'))
    ThreadingHTTPServer(('0.0.0.0', port), Handler).serve_forever()
