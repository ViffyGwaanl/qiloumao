#!/usr/bin/env python3
"""shot.py — take one screenshot of the game with a URL query, and report what an unattended builder needs to know:
is it ready, which errors happened, how heavy the frame is, and how bright and colourful the picture is.

usage (from qiloumao/):
  uv run --quiet --with playwright==1.56.0 --with numpy --with pillow python3 tools/shot.py "<query>" shots/<name>.jpg
      [--size 1920x1080] [--wait 2.5] [--cam "x,y,z,lx,ly,lz"] [--js "<expression run after ready, its value is printed>"]
      [--page dev.html] [--keys "w:1.5,space:0.2"]   (hold keys for seconds, in order, before the picture)
      [--url file:///full/path/to/release/qiloumao.html]   (any page; the query is added to it)

The page is http://127.0.0.1:5208/<page>?<query>: serve this folder there first (python3 -m http.server 5208 --bind 127.0.0.1).
The single-file release needs no server: pass its file:// URL with --url. Real clock.
At most 2 of these run at once on this machine (lock files in shots/.locks); the others wait their turn.
Prints one JSON object: ready, fatal, errors (window.__errors), console (errors and warnings), stats (window.__stats()),
js (your expression's value), luma (mean 0..255), sat (mean saturation 0..255), dark (share of pixels under luma 40)."""
import json, os, sys, time
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
LOCKS = os.path.join(HERE, '..', 'shots', '.locks')


def gpu_args(window):
    """WebGL in headless Chrome. window = the layout size in CSS px: without it headless Chrome keeps its real window inside
    the screen's work area and squashes the page into it (a 1080p frame came out 8 % short)."""
    a = ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required',
         f'--window-size={window[0]},{window[1]}']
    return (['--use-angle=d3d11'] if os.name == 'nt' else []) + a


def launch(p, args):
    """The installed Google Chrome or Edge first, else Playwright's own Chromium (`playwright install chromium`)."""
    for ch in ('chrome', 'msedge'):
        try:
            return p.chromium.launch(channel=ch, headless=True, args=args), ch
        except Exception:
            pass
    return p.chromium.launch(headless=True, args=args), 'playwright chromium'


def acquire():
    os.makedirs(LOCKS, exist_ok=True)
    t0 = time.time()
    while True:
        for i in range(2):
            p = os.path.join(LOCKS, f'slot{i}')
            try:
                if os.path.exists(p) and time.time() - os.path.getmtime(p) > 150:
                    os.rmdir(p)
                os.mkdir(p); return p
            except OSError:
                pass
        if time.time() - t0 > 600:
            raise SystemExit('shot.py: waited 10 minutes for a slot')
        time.sleep(1.5)


def main():
    a = sys.argv[1:]
    if len(a) < 2:
        raise SystemExit(__doc__)
    q, out = a[0], a[1]
    opt = dict(zip(a[2::2], a[3::2]))
    W, H = map(int, opt.get('--size', '1920x1080').split('x'))
    if opt.get('--cam'):
        q += ('&' if q else '') + 'cam=' + opt['--cam']
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    slot = acquire(); rep = {}
    try:
        with sync_playwright() as p:
            b, name = launch(p, gpu_args((W, H)))
            ctx = b.new_context(viewport={'width': W, 'height': H}, device_scale_factor=1)
            page = ctx.new_page(); logs = []
            page.on('console', lambda m: m.type in ('error', 'warning') and logs.append(f'[{m.type}] {m.text[:300]}'))
            page.on('pageerror', lambda e: logs.append('[pageerror] ' + str(e)[:300]))
            url = opt.get('--url') or f"http://127.0.0.1:5208/{opt.get('--page', 'dev.html')}"
            page.goto(f"{url}{'&' if '?' in url else '?'}{q}", wait_until='load', timeout=60000)
            t0 = time.time()
            while time.time() - t0 < 90 and not page.evaluate('window.__ready === true || !!window.__fatal'):
                page.wait_for_timeout(200)
            page.wait_for_timeout(int(float(opt.get('--wait', 2.5)) * 1000))
            for kv in filter(None, opt.get('--keys', '').split(',')):
                k, s = kv.split(':'); key = {'space': 'Space', 'shift': 'Shift'}.get(k, k)
                page.keyboard.down(key); page.wait_for_timeout(int(float(s) * 1000)); page.keyboard.up(key)
            if opt.get('--js'):
                try:
                    rep['js'] = page.evaluate(opt['--js'])
                except Exception as e:
                    rep['js'] = 'threw: ' + str(e)[:300]
                page.wait_for_timeout(400)
            rep.update(ready=page.evaluate('window.__ready === true'), fatal=page.evaluate('window.__fatal'), errors=page.evaluate('(window.__errors || []).slice(0, 12)'),
                       stats=page.evaluate('window.__stats ? window.__stats() : null'), console=[l for l in logs if 'favicon' not in l][:12], boot_s=round(time.time() - t0, 1))
            page.screenshot(path=out, type='jpeg', quality=90)
            ctx.close(); b.close()
        try:
            import numpy as np
            from PIL import Image
            im = np.asarray(Image.open(out).convert('RGB').resize((320, 180))).astype('float32')
            mx, mn = im.max(axis=2), im.min(axis=2); lum = im @ np.array([0.2126, 0.7152, 0.0722], dtype='float32')
            rep.update(luma=round(float(lum.mean()), 1), sat=round(float(((mx - mn) / np.maximum(mx, 1) * 255).mean()), 1), dark=round(float((lum < 40).mean()), 3))
        except Exception as e:
            rep['image_stats'] = 'failed: ' + str(e)[:120]
    finally:
        try:
            os.rmdir(slot)
        except OSError:
            pass
    rep['picture'] = os.path.abspath(out)
    print(json.dumps(rep, ensure_ascii=False, indent=1))


main()
