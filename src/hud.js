// hud.js — LEVEL agent: the screen overlay. DOM only, inside #ui, with its own stylesheet and inline SVG (no image files):
// three fish that fill in, a wetness ring, one hint line, whiskers at the screen edges that follow the head, the title
// screen, pause, the ending card. Buttons only emit events (ui:start, ui:resume, ui:restart, ui:click); game.js decides.
import { clamp } from './util.js';

const CSS = `
.qm{position:absolute;inset:0;pointer-events:none;color:#f3e9d6;font-family:"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif;--amber:#ffb86b;--cream:#f3e9d6;--night:#0c1420;--blue:#16283a}
.qm *{box-sizing:border-box}
.qm-fade{position:absolute;inset:0;background:#0c1420;opacity:0;transition:opacity .6s ease}
.qm-play{position:absolute;inset:0;opacity:0;transition:opacity .5s ease}
.qm-play.on{opacity:1}
.qm-top{position:absolute;left:calc(28px + env(safe-area-inset-left));top:calc(24px + env(safe-area-inset-top));display:flex;align-items:center;gap:22px}
.qm-fish{display:flex;gap:10px;padding:10px 16px 8px;background:rgba(12,20,32,.5);border:1px solid rgba(243,233,214,.2);border-radius:999px}
.qm-fish svg{width:54px;height:30px;overflow:visible}
.qm-fish path,.qm-fish circle{fill:rgba(255,184,107,0);stroke:var(--cream);stroke-width:2.2;stroke-linejoin:round;transition:fill .5s ease,stroke .5s ease}
.qm-fish circle{stroke:none;fill:var(--cream)}
.qm-fish .got path{fill:var(--amber);stroke:var(--amber)}
.qm-fish .got circle{fill:var(--night)}
.qm-fish .got{animation:qm-pop .7s cubic-bezier(.2,1.6,.4,1)}
@keyframes qm-pop{0%{transform:scale(1)}35%{transform:scale(1.5) rotate(-12deg)}100%{transform:scale(1)}}
.qm-wet{position:relative;width:54px;height:54px;border-radius:50%;background:rgba(12,20,32,.5)}
.qm-wet svg{position:absolute;inset:0;width:100%;height:100%;transform:rotate(-90deg)}
.qm-wet .bg{fill:none;stroke:rgba(243,233,214,.22);stroke-width:4}
.qm-wet .fg{fill:none;stroke:#48d1ff;stroke-width:4.5;stroke-linecap:round;transition:stroke .3s ease}
.qm-wet .drop{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
.qm-wet .drop svg{position:static;width:20px;height:24px;transform:none}
.qm-wet .drop path{fill:#48d1ff;transition:fill .3s ease}
.qm-wet.hot .fg{stroke:#ff4d6d}.qm-wet.hot .drop path{fill:#ff4d6d}.qm-wet.hot{animation:qm-throb .5s ease-in-out infinite alternate}
.qm-wet.shake{animation:qm-shake .09s linear infinite}
@keyframes qm-throb{to{transform:scale(1.12)}}
@keyframes qm-shake{0%{transform:translateX(-4px) rotate(-8deg)}50%{transform:translateX(4px) rotate(8deg)}100%{transform:translateX(-4px) rotate(-8deg)}}
.qm-wetlabel{font-size:17px;letter-spacing:.08em;color:var(--cream);opacity:0;transition:opacity .3s ease;text-shadow:0 1px 6px #0c1420;white-space:nowrap}
.qm-wetlabel.on{opacity:.95}
.qm-hint{position:absolute;left:50%;bottom:calc(9% + env(safe-area-inset-bottom));transform:translateX(-50%);max-width:min(86vw,1100px);padding:11px 26px;font-size:clamp(17px,2.05vw,25px);line-height:1.45;letter-spacing:.04em;text-align:center;color:var(--cream);background:rgba(12,20,32,.62);border-left:3px solid var(--amber);border-radius:4px;opacity:0;transition:opacity .6s ease;text-wrap:balance}
.qm-hint.on{opacity:1}.qm-hint.dim{opacity:.62}
.qm-meow{position:absolute;left:50%;bottom:23%;font-size:30px;font-weight:700;color:var(--amber);opacity:0;transform:translate(-50%,0);text-shadow:0 2px 10px #0c1420}
.qm-meow.go{animation:qm-meow .9s ease-out}
@keyframes qm-meow{0%{opacity:0;transform:translate(-50%,10px) scale(.8)}18%{opacity:1}100%{opacity:0;transform:translate(-50%,-46px) scale(1.15)}}
.qm-whisk{position:absolute;top:56%;width:19vw;height:26vh;opacity:.26;overflow:visible;transition:opacity .5s ease}
.qm-whisk path{fill:none;stroke:var(--cream);stroke-width:1.6;stroke-linecap:round;vector-effect:non-scaling-stroke}
.qm-wl{left:-1vw;transform-origin:0% 50%}.qm-wr{right:-1vw;transform-origin:100% 50%}
.qm-screen{position:absolute;inset:0;display:none;pointer-events:auto}
.qm-screen.on{display:flex}
.qm-title{align-items:center;justify-content:flex-start;background:linear-gradient(90deg,rgba(12,20,32,.86) 0%,rgba(12,20,32,.6) 34%,rgba(12,20,32,0) 62%)}
.qm-title .box{margin-left:clamp(28px,8vw,150px);max-width:min(88vw,720px)}
.qm-title h1{margin:0;font-weight:900;font-size:clamp(64px,11.5vw,168px);letter-spacing:.1em;line-height:1.04;color:var(--cream);text-shadow:0 0 34px rgba(255,184,107,.5),0 4px 0 rgba(12,20,32,.6)}
.qm-title h1 b{color:var(--amber);font-weight:900}
.qm-title .blurb{margin:18px 0 34px;font-size:clamp(20px,2.3vw,30px);letter-spacing:.12em;color:var(--cream)}
.qm-title .keys{margin-top:30px;font-size:clamp(15px,1.45vw,19px);line-height:1.9;color:#c9d3df;letter-spacing:.05em}
.qm-title .keys b{color:var(--amber);font-weight:700}
.qm-btn{appearance:none;border:0;cursor:pointer;font-family:inherit;font-weight:800;font-size:clamp(22px,2.3vw,30px);letter-spacing:.3em;padding:15px 44px 15px 54px;color:var(--night);background:var(--amber);border-radius:999px;box-shadow:0 0 0 0 rgba(255,184,107,.5),0 8px 26px rgba(0,0,0,.4);transition:transform .15s ease,box-shadow .2s ease,background .2s ease}
.qm-btn:hover,.qm-btn:focus-visible{transform:translateY(-2px) scale(1.03);background:#ffc98a;box-shadow:0 0 0 8px rgba(255,184,107,.22),0 10px 28px rgba(0,0,0,.45);outline:none}
.qm-btn.ghost{background:transparent;color:var(--cream);box-shadow:inset 0 0 0 2px rgba(243,233,214,.6)}
.qm-btn.ghost:hover{background:rgba(243,233,214,.12)}
.qm-card-wrap{align-items:center;justify-content:center;background:rgba(12,20,32,.34)}
.qm-card{min-width:min(86vw,560px);padding:42px 56px 44px;text-align:center;background:linear-gradient(180deg,rgba(22,40,58,.96),rgba(12,20,32,.96));border:1px solid rgba(255,184,107,.45);border-radius:18px;box-shadow:0 22px 80px rgba(0,0,0,.55)}
.qm-card h2{margin:0 0 6px;font-size:clamp(22px,2.2vw,28px);font-weight:600;letter-spacing:.3em;color:#c9d3df}
.qm-card .rate{font-size:clamp(54px,7vw,92px);font-weight:900;letter-spacing:.14em;margin:6px 0 4px;color:var(--amber);text-shadow:0 0 30px rgba(255,184,107,.45)}
.qm-card .say{font-size:clamp(18px,1.7vw,22px);color:var(--cream);margin-bottom:26px;letter-spacing:.06em}
.qm-card .nums{display:flex;justify-content:center;gap:54px;margin:0 0 32px}
.qm-card .nums div{font-size:17px;color:#c9d3df;letter-spacing:.14em}
.qm-card .nums b{display:block;font-size:clamp(34px,3.6vw,46px);color:var(--cream);font-weight:800;letter-spacing:.04em;margin-bottom:2px}
.qm-card .row{display:flex;gap:18px;justify-content:center;flex-wrap:wrap}
.qm-target{position:absolute;left:0;top:0;display:flex;flex-direction:column;align-items:center;gap:5px;opacity:0;transition:opacity .35s ease;will-change:transform}
.qm-target.on{opacity:1}
.qm-target .ico{position:relative;width:52px;height:30px}
.qm-target .ico svg{width:100%;height:100%;overflow:visible;filter:drop-shadow(0 0 7px rgba(255,184,107,.85)) drop-shadow(0 2px 3px rgba(12,20,32,.8))}
.qm-target .ico path{fill:var(--amber);stroke:var(--night);stroke-width:1.6;stroke-linejoin:round}
.qm-target .ico circle{fill:var(--night)}
.qm-target .ico .win rect{fill:var(--amber);stroke:var(--night);stroke-width:1.6}
.qm-target .ico .win path{fill:none;stroke:var(--night);stroke-width:1.8}
.qm-target .ico .paw ellipse{fill:var(--amber);stroke:var(--night);stroke-width:1.4}
.qm-target .ring{position:absolute;left:50%;top:50%;width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:50%;border:2px solid rgba(255,184,107,.7);animation:qm-ring 1.6s ease-out infinite}
@keyframes qm-ring{0%{transform:scale(.45);opacity:.9}100%{transform:scale(1.25);opacity:0}}
.qm-target .dist{font-size:16px;line-height:1.3;letter-spacing:.06em;color:var(--cream);background:rgba(12,20,32,.66);border:1px solid rgba(255,184,107,.35);padding:3px 12px;border-radius:999px;white-space:nowrap;text-shadow:0 1px 4px #0c1420}
.qm-target .arrow{position:absolute;left:50%;top:50%;width:0;height:0;margin:-16px 0 0 -12px;border:12px solid transparent;border-top:0;border-bottom:20px solid var(--amber);display:none;filter:drop-shadow(0 0 1.5px #0c1420) drop-shadow(0 0 7px rgba(255,184,107,.95))}
.qm-target.edge .arrow{display:block}.qm-target.edge .ring{display:none}
.qm-map{position:absolute;right:calc(28px + env(safe-area-inset-right));top:calc(22px + env(safe-area-inset-top));width:188px;height:188px;border-radius:50%;overflow:hidden;background:radial-gradient(circle at 50% 45%,rgba(22,40,58,.78),rgba(12,20,32,.82));box-shadow:inset 0 0 0 1.5px rgba(243,233,214,.32),0 8px 26px rgba(0,0,0,.4);opacity:0;transition:opacity .4s ease}
.qm-map.on{opacity:1}
.qm-map canvas{position:absolute;inset:0;width:100%;height:100%}
@media (max-width:700px){.qm-map{width:120px;height:120px;right:14px;top:14px}.qm-target .dist{font-size:13px}.qm-top{left:14px;top:14px;gap:12px}.qm-fish svg{width:40px;height:22px}.qm-wet{width:44px;height:44px}.qm-card{padding:30px 22px}.qm-card .nums{gap:28px}.qm-whisk{display:none}}
`;
const FISH = '<svg viewBox="0 0 56 32"><path d="M3 16C9 4 30 3 41 16C30 29 9 28 3 16Z"/><path d="M40 16L53 6L50 16L53 26Z"/><circle cx="12" cy="14" r="2"/></svg>';
const WHISK = '<path d="M0 46 C 30 44, 70 34, 100 10"/><path d="M0 52 C 34 52, 72 50, 100 44"/><path d="M0 58 C 30 62, 68 72, 96 88"/>';
const fmt = s => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const SAY = { '夜行大师': '一滴雨都没白淋，天还没亮就到家了', '机灵猫': '三条咸鱼一条不少，赶在天亮前回了窝', '落汤猫': '湿是湿了点，鱼总算叼回来了' };

export async function create(G) {
  const ui = document.getElementById('ui') || document.body, ev = G.events;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const root = document.createElement('div'); root.className = 'qm';
  const touch = 'ontouchstart' in window && navigator.maxTouchPoints > 0;
  const keysLine = touch
    ? '<b>左手</b> 拖动走路，推到底就跑　<b>右手</b> 滑动转头<br><b>跳</b> 按住跳得更高　<b>喵</b> 叫一声'
    : '<b>W A S D</b> 走　<b>鼠标</b> 或 <b>← →</b> 转头　<b>空格</b> 跳，按住跳得更高<br><b>Shift</b> 跑　<b>E</b> 喵一声　<b>Esc</b> 歇一歇';
  root.innerHTML = `
<div class="qm-play">
  <svg class="qm-whisk qm-wl" viewBox="0 0 100 100" preserveAspectRatio="none">${WHISK}</svg>
  <svg class="qm-whisk qm-wr" viewBox="0 0 100 100" preserveAspectRatio="none"><g transform="translate(100,0) scale(-1,1)">${WHISK}</g></svg>
  <div class="qm-top">
    <div class="qm-fish" aria-label="咸鱼"><span>${FISH}</span><span>${FISH}</span><span>${FISH}</span></div>
    <div class="qm-wet" aria-label="淋湿"><svg viewBox="0 0 54 54"><circle class="bg" cx="27" cy="27" r="22"/><circle class="fg" cx="27" cy="27" r="22"/></svg><div class="drop"><svg viewBox="0 0 20 24"><path d="M10 1C6 8 2 12 2 16a8 8 0 0 0 16 0C18 12 14 8 10 1Z"/></svg></div></div>
    <div class="qm-wetlabel"></div>
  </div>
  <div class="qm-target"><div class="ico"><span class="ring"></span><span class="arrow"></span><span class="pic"></span></div><div class="dist"></div></div>
  <div class="qm-map"><canvas></canvas></div>
  <div class="qm-hint"></div>
  <div class="qm-meow">喵～</div>
</div>
<div class="qm-fade"></div>
<div class="qm-screen qm-title"><div class="box">
  <h1>骑楼<b>猫</b></h1>
  <p class="blurb">下雨的夜里，把三条咸鱼叼回阁楼</p>
  <button class="qm-btn" data-ev="ui:start">开始</button>
  <p class="keys">${keysLine}</p>
</div></div>
<div class="qm-screen qm-card-wrap qm-pause"><div class="qm-card">
  <h2>歇一歇</h2><div class="say" style="margin:18px 0 30px">雨还在下，咸鱼还在晾着</div>
  <div class="row"><button class="qm-btn" data-ev="ui:resume">继续</button><button class="qm-btn ghost" data-ev="ui:restart">重新开始</button></div>
</div></div>
<div class="qm-screen qm-card-wrap qm-end"><div class="qm-card">
  <h2>到家了</h2><div class="rate"></div><div class="say"></div>
  <div class="nums"><div><b class="n-time">0:00</b>用时</div><div><b class="n-shake">0</b>抖水</div><div><b class="n-fish">3</b>咸鱼</div></div>
  <div class="row"><button class="qm-btn" data-ev="ui:restart">再来一次</button></div>
</div></div>`;
  ui.appendChild(root);
  const $ = s => root.querySelector(s), play = $('.qm-play'), fadeEl = $('.qm-fade'), hintEl = $('.qm-hint'), wetEl = $('.qm-wet'), fg = $('.qm-wet .fg'), wetLabel = $('.qm-wetlabel'), meowEl = $('.qm-meow');
  const fishEls = [...root.querySelectorAll('.qm-fish span')], wl = $('.qm-wl'), wr = $('.qm-wr');
  const C = 2 * Math.PI * 22; fg.style.strokeDasharray = C; fg.style.strokeDashoffset = C;
  const guide = makeGuide(G, $('.qm-target'), $('.qm-map'));
  root.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-ev]'); if (!b) return; ev.emit('ui:click'); ev.emit(b.dataset.ev); });
  addEventListener('keydown', e => { if (e.code !== 'Enter' && e.code !== 'NumpadEnter') return; if (e.target && e.target.closest && e.target.closest('.qm-btn')) return; if (api.screen === 'title') { ev.emit('ui:click'); ev.emit('ui:start'); } else if (api.screen === 'end') { ev.emit('ui:click'); ev.emit('ui:restart'); } else if (api.screen === 'pause') ev.emit('ui:resume'); });
  let hintT = 0, hintText = '', sway = 0, swayV = 0, t = 0, wetShown = -1, lastLabel = '';
  const api = {
    root, screen: 'none',
    // 'title' | 'play' | 'pause' | 'end' | 'none'
    show(screen, data = {}) {
      api.screen = screen;
      $('.qm-title').classList.toggle('on', screen === 'title'); $('.qm-pause').classList.toggle('on', screen === 'pause'); $('.qm-end').classList.toggle('on', screen === 'end');
      play.classList.toggle('on', screen === 'play' || screen === 'pause'); if (screen !== 'play') guide.hide();
      if (screen === 'end') { $('.qm-end .rate').textContent = data.rating || '机灵猫'; $('.qm-end .say').textContent = SAY[data.rating] || ''; $('.n-time').textContent = fmt(data.time || 0); $('.n-shake').textContent = (data.shakes || 0) + ' 次'; $('.n-fish').textContent = (data.fish ?? 3) + ' 条'; }
      const b = root.querySelector('.qm-screen.on .qm-btn'); if (b && screen !== 'play' && !G.params.shot) { try { b.focus({ preventScroll: true }); } catch (e) { /* no focus */ } }
    },
    setFish(n) { fishEls.forEach((el, i) => el.classList.toggle('got', i < n)); },
    setWet(w, shaking = 0) {
      w = clamp(w, 0, 1); if (Math.abs(w - wetShown) > 0.004) { wetShown = w; fg.style.strokeDashoffset = C * (1 - w); }
      wetEl.classList.toggle('hot', w > 0.78 && !shaking); wetEl.classList.toggle('shake', shaking > 0);
      const label = shaking > 0 ? '抖一抖' : w > 0.78 ? '快找地方躲雨' : ''; if (label !== lastLabel) { lastLabel = label; if (label) wetLabel.textContent = label; wetLabel.classList.toggle('on', !!label); }
    },
    hint(text, o = {}) { if (!text) { hintEl.classList.remove('on', 'dim'); hintText = ''; return; } if (text === hintText && !o.again) return; hintText = text; hintEl.textContent = text; hintEl.classList.add('on'); hintEl.classList.remove('dim'); hintT = o.hold || 7; },
    fade(v, seconds = 0.6) { fadeEl.style.transitionDuration = seconds + 's'; fadeEl.style.opacity = String(clamp(v, 0, 1)); },
    meow() { meowEl.classList.remove('go'); void meowEl.offsetWidth; meowEl.classList.add('go'); },
    update(dt) {
      t += dt;
      if (hintT > 0) { hintT -= dt; if (hintT <= 0 && hintText) hintEl.classList.add('dim'); }
      if (api.screen !== 'play') return;
      // whiskers: a spring that lags the head turn, plus a little breathing and a twitch when running
      const p = G.player || {}, turn = clamp((p.turnRate || 0) * 0.22, -1, 1), sp = clamp((p.speed || 0) / 5, 0, 1);
      swayV += ((turn - sway) * 60 - swayV * 9) * dt; sway += swayV * dt;
      const br = Math.sin(t * 1.7) * 1.2 + Math.sin(t * 13) * sp * 1.4, shake = p.shaking > 0 ? Math.sin(t * 46) * 7 : 0;
      wl.style.transform = `rotate(${(-sway * 9 + br + shake).toFixed(2)}deg) scaleX(${(1 + sway * 0.12).toFixed(3)})`;
      wr.style.transform = `rotate(${(-sway * 9 - br + shake).toFixed(2)}deg) scaleX(${(1 - sway * 0.12).toFixed(3)})`;
      guide.update(dt);
    },
  };
  ev.on('cat:meow', () => api.meow());
  return api;
}

// ---- 认路：下一条鱼（叼齐以后是阁楼窗）头上浮一个标记，写还有几米、往上几米；右上角一张跟着猫转的小地图。
// 人和 AI 看到的是同一个画面。?guide=0 关掉，回到原来的样子。
const WIN = '<svg class="win" viewBox="0 0 56 32"><rect x="15" y="2" width="26" height="28" rx="3"/><path d="M28 2V30M15 16H41"/></svg>';
const PAW = '<svg class="paw" viewBox="0 0 56 32"><ellipse cx="28" cy="21" rx="8.5" ry="7.5"/><ellipse cx="17.5" cy="11.5" rx="3.6" ry="4.6"/><ellipse cx="24.5" cy="6.5" rx="3.6" ry="4.6"/><ellipse cx="31.5" cy="6.5" rx="3.6" ry="4.6"/><ellipse cx="38.5" cy="11.5" rx="3.6" ry="4.6"/></svg>';
// 路线上每一跳落脚的地方（level.js 的 route.jumps 里 to 的名字）
const STEP = { 'crate stack': '木箱', 'load on the tricycle': '三轮车上的货', 'awning A': '红雨棚', 'AC cover 1': '空调罩', 'scaffold': '竹棚', 'balcony': '阳台', 'crate stack 2': '阳台上的木箱', 'AC cover 2': '空调罩', 'window awning': '小雨棚', 'cornice (7.8)': '屋檐' };
function makeGuide(G, el, mapEl) {
  const off = G.params.guide === '0' || G.params.shot;
  const pic = el.querySelector('.pic'), dist = el.querySelector('.dist'), arrow = el.querySelector('.arrow');
  const cv = mapEl.querySelector('canvas'), cx = cv.getContext('2d');
  const v = new G.THREE.Vector3();
  let kind = '', lastText = '', shown = false, mapT = 0;
  const steps = [];   // 每一跳的落脚点，缓存成向量
  const target = () => {
    const L = G.level, p = G.player; if (!L || !p) return null;
    const fish = L.fish || [], jumps = (L.route && L.route.jumps) || [];
    if (!steps.length) for (const j of jumps) steps.push({ pos: new G.THREE.Vector3(j.land[0], j.land[1], j.land[2]), name: STEP[j.to] || '台子' });
    const f = fish.find(q => !q.taken);
    const last = !f ? steps.length - 1 : f.index === 0 ? -1 : f.index === 1 ? 2 : 5;   // 第二条鱼前是三跳，第三条前到第六跳，回家到最后
    for (let j = 0; j <= Math.min(last, steps.length - 1); j++) if (steps[j].pos.y > p.pos.y + 0.25) return { kind: 'step', pos: steps[j].pos, stand: steps[j].pos.y, lift: 0.28, name: steps[j].name };
    if (f) return { kind: 'fish', pos: f.pos, stand: f.pos.y - 0.85 };
    if (L.home) return { kind: 'home', pos: L.home.pos, stand: L.home.pos.y, lift: 0.55 };
    return null;
  };
  const hide = () => { if (!shown) return; shown = false; el.classList.remove('on'); mapEl.classList.remove('on'); };
  // 小地图：只画和猫同一层高度上的东西，头顶上的楼板不画，免得把骑楼底下盖住。
  // 比猫脚下高出 0.2 到 1.4 米的台子是跳得上去的，涂成琥珀色；更高的是墙和楼，涂成深色；比脚下低的涂成浅色。
  const drawMap = (p, tg) => {
    const dpr = Math.min(2, window.devicePixelRatio || 1), W = Math.round((mapEl.clientWidth || 188) * dpr);
    if (cv.width !== W) { cv.width = cv.height = W; }
    const R = W / 2, scale = R / 12, y0 = p.pos.y;   // 半径对应 12 米
    cx.setTransform(1, 0, 0, 1, 0, 0); cx.clearRect(0, 0, W, W);
    cx.save(); cx.translate(R, R);
    // 猫面朝的方向朝上：世界坐标先平移到猫，再按朝向转
    cx.rotate(p.yaw); cx.scale(scale, scale); cx.translate(-p.pos.x, -p.pos.z);
    const boxes = (G.physics && G.physics.boxes) || [];
    const reach = 12 + 2;
    for (const pass of [0, 1, 2]) {
      for (const b of boxes) {
        if (b.max.x < p.pos.x - reach || b.min.x > p.pos.x + reach || b.max.z < p.pos.z - reach || b.min.z > p.pos.z + reach) continue;
        if (b.min.y > y0 + 1.5) continue;                       // 头顶上的，不画
        const top = b.max.y - y0;
        if (top < -0.05 && b.max.y < 0.2) continue;              // 街面本身
        const band = top <= 0.25 ? 0 : top <= 1.4 ? 1 : 2;        // 0 脚下这一层或更低，1 跳得上去，2 墙和楼
        if (band !== pass) continue;
        cx.fillStyle = band === 0 ? (top < -0.25 ? 'rgba(201,211,223,.10)' : 'rgba(201,211,223,.24)') : band === 1 ? 'rgba(255,184,107,.7)' : 'rgba(9,16,26,.92)';
        cx.fillRect(b.min.x, b.min.z, b.max.x - b.min.x, b.max.z - b.min.z);
        if (band === 2) { cx.strokeStyle = 'rgba(243,233,214,.28)'; cx.lineWidth = 1 / scale; cx.strokeRect(b.min.x, b.min.z, b.max.x - b.min.x, b.max.z - b.min.z); }
      }
    }
    cx.restore();
    // 鱼和阁楼窗：画在屏幕方向上，图标不跟着转
    const toMap = (x, z) => { const dx = x - p.pos.x, dz = z - p.pos.z, c = Math.cos(p.yaw), s = Math.sin(p.yaw); return [R + (dx * c - dz * s) * scale, R + (dx * s + dz * c) * scale]; };
    const icon = (x, z, isFish, hot) => {
      let [mx, my] = toMap(x, z); const ddx = mx - R, ddy = my - R, rr = Math.hypot(ddx, ddy), lim = R - 13 * dpr;
      const out = rr > lim; if (out) { mx = R + ddx / rr * lim; my = R + ddy / rr * lim; }
      cx.save(); cx.translate(mx, my);
      if (hot) { cx.beginPath(); cx.arc(0, 0, 10 * dpr, 0, 7); cx.fillStyle = 'rgba(255,184,107,.28)'; cx.fill(); }
      if (out) { cx.save(); cx.rotate(Math.atan2(ddy, ddx)); cx.beginPath(); cx.moveTo(12 * dpr, 0); cx.lineTo(5 * dpr, -5 * dpr); cx.lineTo(5 * dpr, 5 * dpr); cx.closePath(); cx.fillStyle = hot ? '#ffb86b' : 'rgba(243,233,214,.6)'; cx.fill(); cx.restore(); }
      cx.fillStyle = hot ? '#ffb86b' : 'rgba(243,233,214,.75)'; cx.strokeStyle = '#0c1420'; cx.lineWidth = 1.2 * dpr;
      const k = dpr * (hot ? 1.15 : 0.9);
      if (isFish) { cx.beginPath(); cx.moveTo(-7 * k, 0); cx.quadraticCurveTo(0, -6 * k, 5 * k, 0); cx.quadraticCurveTo(0, 6 * k, -7 * k, 0); cx.moveTo(4 * k, 0); cx.lineTo(9 * k, -4 * k); cx.lineTo(9 * k, 4 * k); cx.closePath(); cx.fill(); cx.stroke(); }
      else { cx.fillRect(-5 * k, -6 * k, 10 * k, 12 * k); cx.strokeRect(-5 * k, -6 * k, 10 * k, 12 * k); cx.beginPath(); cx.moveTo(0, -6 * k); cx.lineTo(0, 6 * k); cx.moveTo(-5 * k, 0); cx.lineTo(5 * k, 0); cx.stroke(); }
      cx.restore();
    };
    const L = G.level;
    if (tg && tg.kind === 'step') {
      let [mx, my] = toMap(tg.pos.x, tg.pos.z); const ddx = mx - R, ddy = my - R, rr = Math.hypot(ddx, ddy), lim = R - 13 * dpr;
      if (rr > lim) { mx = R + ddx / rr * lim; my = R + ddy / rr * lim; }
      cx.save(); cx.translate(mx, my); cx.beginPath(); cx.arc(0, 0, 10 * dpr, 0, 7); cx.fillStyle = 'rgba(255,184,107,.28)'; cx.fill();
      cx.fillStyle = '#ffb86b'; cx.strokeStyle = '#0c1420'; cx.lineWidth = 1 * dpr;
      for (const [ex, ey, rx, ry] of [[0, 2.2, 3.4, 3], [-4.2, -2.2, 1.5, 1.9], [-1.4, -4.2, 1.5, 1.9], [1.4, -4.2, 1.5, 1.9], [4.2, -2.2, 1.5, 1.9]]) { cx.beginPath(); cx.ellipse(ex * dpr, ey * dpr, rx * dpr, ry * dpr, 0, 0, 7); cx.fill(); cx.stroke(); }
      cx.restore();
    }
    if (L && L.home) icon(L.home.pos.x, L.home.pos.z, false, tg && tg.kind === 'home');
    for (const f of (L && L.fish) || []) if (!f.taken) icon(f.pos.x, f.pos.z, true, !!tg && tg.pos === f.pos);
    // 猫自己：中间一个朝上的箭头
    cx.save(); cx.translate(R, R); cx.beginPath(); cx.moveTo(0, -9 * dpr); cx.lineTo(6.5 * dpr, 7 * dpr); cx.lineTo(0, 3.5 * dpr); cx.lineTo(-6.5 * dpr, 7 * dpr); cx.closePath();
    cx.fillStyle = '#f3e9d6'; cx.strokeStyle = '#0c1420'; cx.lineWidth = 1.5 * dpr; cx.fill(); cx.stroke(); cx.restore();
  };
  return {
    hide,
    update(dt) {
      const p = G.player, cam = G.camera, tg = target();
      if (off || !p || !cam || !tg) { hide(); return; }
      if (!shown) { shown = true; el.classList.add('on'); mapEl.classList.add('on'); }
      if (tg.kind !== kind) { kind = tg.kind; pic.innerHTML = kind === 'fish' ? FISH : kind === 'step' ? PAW : WIN; }
      // 标记：目标在画面里就浮在它上方；在画面外或者身后，就贴在左边或右边的中间，箭头指向该转的那一边
      const Wd = window.innerWidth, Hd = window.innerHeight, mx = 96, top = 92, bottom = Hd * 0.72;
      v.set(tg.pos.x, tg.pos.y + (tg.lift || 0.35), tg.pos.z).project(cam);
      let sx = (v.x + 1) / 2 * Wd, sy = (1 - v.y) / 2 * Hd;
      const dxw = tg.pos.x - p.pos.x, dzw = tg.pos.z - p.pos.z;
      let bear = Math.atan2(-dxw, -dzw) - p.yaw; while (bear > Math.PI) bear -= 2 * Math.PI; while (bear < -Math.PI) bear += 2 * Math.PI;
      const deg = Math.abs(bear) * 180 / Math.PI, left = bear > 0;
      const edge = v.z > 1 || sx < mx || sx > Wd - mx || sy < top || sy > bottom;
      let where = '';
      if (edge) {
        sx = left ? mx : Wd - mx; sy = Math.min(bottom - 40, Math.max(270, isFinite(sy) && v.z <= 1 ? sy : Hd * 0.42));
        arrow.style.transform = `rotate(${left ? -90 : 90}deg) translateY(-42px)`;
        where = deg > 120 ? (left ? '在左后方' : '在右后方') : (left ? '在左边' : '在右边');
      }
      el.classList.toggle('edge', edge);
      if (!edge) { if (sx > Wd - 260 && sy < 250) sy = 250; if (sx < 420 && sy < 120) sy = 120; }   // 别压住右上角的小地图和左上角的鱼
      el.style.transform = `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px) translate(-50%,-50%)`;
      const d = Math.hypot(tg.pos.x - p.pos.x, tg.pos.z - p.pos.z), up = tg.stand - p.pos.y;
      const name = tg.kind === 'fish' ? '咸鱼' : tg.kind === 'step' ? `先上${tg.name}` : '阁楼窗';
      const sep = tg.kind === 'step' && where ? '，' : '';
      const text = `${name}${sep}${where} ${d < 10 ? d.toFixed(1) : Math.round(d)} 米` + (up > (tg.kind === 'step' ? 0.2 : 0.5) ? `，往上 ${up.toFixed(1)} 米` : '');
      if (text !== lastText) { lastText = text; dist.textContent = text; }
      mapT -= dt; if (mapT <= 0) { mapT = 1 / 30; drawMap(p, tg); }
    },
  };
}

// ?show=hud&hud=title|play|pause|end : each screen with sample values
export async function showcase(G) {
  const which = G.params.hud || 'play', h = G.hud;
  h.show(which === 'pause' ? 'pause' : which, { time: 163, shakes: 2, rating: G.params.rating || '机灵猫', fish: 3 });
  if (which === 'play' || which === 'pause') { h.show('play'); h.setFish(2); h.setWet(0.84); h.hint('第三条在二楼阳台：从雨棚跳上空调罩，再跳上竹棚，一直往前走，翻过栏杆就是'); if (which === 'pause') h.show('pause'); }
  return { cam: [-6, 0.4, 4.6], target: [6, 1.2, 4.4], update() {} };
}
