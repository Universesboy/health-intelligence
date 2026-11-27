// Page shell and design system. Token names match Coachchalk (app/globals.css) so both apps share
// one brand language: Board green for structure, Chalk lime as accent, Paper as the page.
// Coach Health adds a calmer health palette and a few depth effects. See docs/DESIGN_SYSTEM.md.
import { icon, type IconName } from "./icons";

export function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const FONTS = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap";

export const CSS = String.raw`
:root{
  color-scheme:light;
  /* Shared with Coachchalk */
  --color-bg:#f3f1e7;--color-surface:#ffffff;--color-surface-muted:#efede3;--color-surface-hover:#f9f8f3;
  --color-border:#e0ddd0;--color-border-strong:#cbc7b6;--color-border-input:#8a8d82;
  --color-text:#1e2a24;--color-text-secondary:#4b5650;--color-text-muted:#5e6b64;
  --color-brand:#1e2a24;--color-brand-hover:#2c3b33;--color-brand-soft:#eef6d8;--color-brand-border:#cfe3a0;
  --color-accent:#c8f169;--color-accent-hover:#b8e553;--color-on-brand:#c8f169;
  --color-success:#1f7a4d;--color-success-soft:#e7f4ec;--color-warning:#9a5b00;--color-warning-soft:#fdf3e1;
  --color-danger:#b42318;--color-danger-soft:#fdecea;--color-danger-border:#f0bdb7;--color-info:#1d5fa8;--color-info-soft:#e8f1fb;
  --color-focus:#1d5fa8;
  --font-sans:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif;
  --font-display:"Space Grotesk","Inter","PingFang SC","Noto Sans SC",system-ui,sans-serif;
  --text-xs:12px;--text-sm:13px;--text-base:14px;--text-md:15px;--text-lg:17px;--text-xl:20px;--text-2xl:26px;--text-3xl:34px;
  --space-1:4px;--space-2:8px;--space-3:12px;--space-4:16px;--space-5:20px;--space-6:24px;--space-8:32px;
  --radius-sm:6px;--radius-md:8px;--radius-lg:12px;--radius-xl:18px;--radius-full:999px;
  --control-h:40px;--duration:160ms;--ease:cubic-bezier(.2,.7,.2,1);
  --sidebar-w:232px;--content-max:1160px;--mobile-nav-h:64px;
  /* Coach Health: data series and depth */
  --series-sleep:#5560d6;--series-sleep-soft:#e9eafb;
  --series-activity:#2f8f5b;--series-activity-soft:#e3f2e8;
  --series-load:#b86e0b;--series-load-soft:#fbefdc;
  --series-body:#2a73a8;--series-body-soft:#e4eff8;
  --series-recovery:#0f8f7a;--series-recovery-soft:#dff3ef;
  --band:rgba(30,42,36,.07);
  --shadow-xs:0 1px 2px rgba(23,32,28,.05);
  --shadow-card:0 1px 0 rgba(255,255,255,.7) inset,0 1px 2px rgba(23,32,28,.05),0 8px 24px -12px rgba(23,32,28,.18);
  --shadow-lift:0 1px 0 rgba(255,255,255,.7) inset,0 2px 4px rgba(23,32,28,.06),0 22px 40px -18px rgba(23,32,28,.32);
  --shadow-board:0 2px 0 rgba(255,255,255,.06) inset,0 30px 60px -28px rgba(10,20,15,.65),0 10px 20px -12px rgba(10,20,15,.4);
}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;background:var(--color-bg)}
body{margin:0;min-height:100dvh;color:var(--color-text);font:var(--text-md)/1.55 var(--font-sans);-webkit-font-smoothing:antialiased;
  background:
    radial-gradient(1200px 600px at 85% -10%,rgba(200,241,105,.20),transparent 60%),
    radial-gradient(900px 500px at -10% 30%,rgba(85,96,214,.07),transparent 60%),
    var(--color-bg);background-attachment:fixed}
h1,h2,h3{margin:0;font-weight:600;line-height:1.3}
h1{font-family:var(--font-display);font-size:var(--text-2xl);letter-spacing:-.015em}
h2{font-family:var(--font-display);font-size:var(--text-lg);letter-spacing:-.01em}
h3{font-size:var(--text-md)}
p{margin:0}
a{color:inherit}
:focus-visible{outline:2px solid var(--color-focus);outline-offset:2px}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
.icon{display:inline-block;flex:none;vertical-align:-.15em}
.num{font-family:var(--font-display);font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.muted{color:var(--color-text-muted)}
.small{font-size:var(--text-sm)}

/* Shell */
.sidebar{position:fixed;inset:0 auto 0 0;z-index:30;display:flex;flex-direction:column;gap:var(--space-6);width:var(--sidebar-w);
  padding:20px 12px 16px;border-right:1px solid var(--color-border);background:rgba(255,255,255,.72);backdrop-filter:saturate(1.2) blur(12px)}
.brand-lockup{display:flex;align-items:center;gap:10px;padding:4px 8px;text-decoration:none}
.brand-lockup strong{display:block;font:700 16px/1.2 var(--font-display);letter-spacing:-.02em}
.brand-lockup small{display:block;color:var(--color-text-muted);font-size:var(--text-xs)}
.brand-mark{display:inline-grid;place-items:center;width:32px;height:32px;padding:2px;border-radius:var(--radius-md);background:var(--color-accent);color:var(--color-brand);
  box-shadow:0 1px 0 rgba(255,255,255,.6) inset,0 4px 10px -4px rgba(30,42,36,.5)}
.nav{display:grid;gap:2px}
.nav a{display:flex;align-items:center;gap:10px;min-height:40px;padding:8px 10px;border-radius:var(--radius-md);color:var(--color-text-secondary);
  font-size:var(--text-base);font-weight:500;text-decoration:none;transition:background-color var(--duration),color var(--duration)}
.nav a:hover{background:var(--color-surface-muted);color:var(--color-text)}
.nav a[aria-current=page]{background:var(--color-brand-soft);color:var(--color-brand);font-weight:600}
.nav-label{margin:8px 10px 4px;color:var(--color-text-muted);font-size:var(--text-xs);font-weight:600;letter-spacing:.04em}
.sidebar-foot{margin-top:auto;padding:12px 10px 0;border-top:1px solid var(--color-border);color:var(--color-text-muted);font-size:var(--text-xs);line-height:1.5}
.sidebar-foot a{color:var(--color-text-secondary)}
.stage{margin-left:var(--sidebar-w);min-height:100dvh}
.topbar{position:sticky;top:0;z-index:20;display:flex;align-items:center;justify-content:space-between;gap:var(--space-4);min-height:60px;
  padding:10px max(32px,calc((100% - var(--content-max))/2 + 32px));border-bottom:1px solid rgba(224,221,208,.7);background:rgba(243,241,231,.78);backdrop-filter:blur(14px)}
.topbar .title{display:grid}.topbar .title small{color:var(--color-text-muted);font-size:var(--text-sm)}
.topbar h1{font-size:var(--text-xl)}
.content{display:flex;flex-direction:column;gap:var(--space-5);max-width:var(--content-max);margin:0 auto;padding:24px 32px 64px}
.mobile-nav,.mobile-brand{display:none}

/* Surfaces */
.card{position:relative;border:1px solid var(--color-border);border-radius:var(--radius-xl);background:var(--color-surface);padding:var(--space-5);box-shadow:var(--shadow-card)}
.card.flat{box-shadow:none;background:rgba(255,255,255,.6)}
.card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--space-3);margin-bottom:var(--space-4)}
.card-head p{margin-top:2px;color:var(--color-text-muted);font-size:var(--text-sm)}
.grid{display:grid;gap:var(--space-4)}
.grid.two{grid-template-columns:repeat(2,minmax(0,1fr))}
.grid.three{grid-template-columns:repeat(3,minmax(0,1fr))}
.grid.split{grid-template-columns:minmax(0,1.35fr) minmax(0,1fr)}
.section-title{display:flex;align-items:baseline;justify-content:space-between;gap:var(--space-3);margin-top:var(--space-2)}
.section-title p{color:var(--color-text-muted);font-size:var(--text-sm)}

/* The Board: the dark hero slab with stacked sheets behind it for depth. */
.board-wrap{position:relative;perspective:1400px}
.board-wrap::before,.board-wrap::after{content:"";position:absolute;left:18px;right:18px;border-radius:var(--radius-xl);background:#2a3a31;z-index:0}
.board-wrap::before{bottom:-8px;opacity:.55;transform:scale(.985)}
.board-wrap::after{bottom:-15px;left:36px;right:36px;opacity:.28;transform:scale(.97)}
.board{position:relative;z-index:1;display:grid;grid-template-columns:minmax(0,1.4fr) minmax(260px,1fr);gap:var(--space-6);padding:28px;border-radius:var(--radius-xl);
  color:#eef3ea;background:
    radial-gradient(600px 300px at 100% 0%,rgba(200,241,105,.16),transparent 60%),
    radial-gradient(500px 260px at 0% 100%,rgba(85,96,214,.18),transparent 65%),
    linear-gradient(160deg,#24332b 0%,#1a251f 55%,#16201b 100%);
  box-shadow:var(--shadow-board);transform:rotateX(1.2deg);transform-origin:50% 100%;transition:transform .5s var(--ease)}
.board-wrap:hover .board{transform:rotateX(0deg) translateY(-2px)}
.board h1,.board h2{color:#fff}
.board .eyebrow{color:var(--color-accent);font-size:var(--text-xs);font-weight:600;letter-spacing:.08em;text-transform:uppercase}
.board .lede{margin-top:6px;color:#c5d0c8;font-size:var(--text-md)}
.focus-list{display:grid;gap:10px;margin:18px 0 0;padding:0;list-style:none}
.focus-item{display:grid;grid-template-columns:28px minmax(0,1fr);gap:12px;padding:12px 14px;border:1px solid rgba(255,255,255,.08);border-radius:var(--radius-lg);
  background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.02));box-shadow:0 1px 0 rgba(255,255,255,.05) inset}
.focus-item .dot{display:grid;place-items:center;width:28px;height:28px;border-radius:9px;background:rgba(200,241,105,.14);color:var(--color-accent)}
.focus-item.watch .dot{background:rgba(255,196,102,.16);color:#ffc466}
.focus-item.alert .dot{background:rgba(255,120,110,.2);color:#ff8a80}
.focus-item strong{display:block;color:#fff;font-weight:600}
.focus-item span{display:block;margin-top:2px;color:#b9c5bd;font-size:var(--text-sm)}
.focus-empty{margin-top:18px;color:#b9c5bd;font-size:var(--text-sm)}

/* Isometric status stack: three plates (sleep, load, body); colour = status, label beside it. */
.stack{position:relative;display:grid;align-content:center;justify-items:center;min-height:240px}
.stack-scene{position:relative;width:180px;height:180px;transform:rotateX(58deg) rotateZ(-42deg);transform-style:preserve-3d}
.plate{position:absolute;inset:0;border-radius:22px;border:1px solid rgba(255,255,255,.18);
  background:linear-gradient(135deg,rgba(255,255,255,.16),rgba(255,255,255,.03));box-shadow:0 0 0 1px rgba(0,0,0,.15) inset,-14px 14px 28px rgba(0,0,0,.35);transition:transform .6s var(--ease)}
.plate::after{content:"";position:absolute;inset:18%;border-radius:14px;background:var(--plate,rgba(255,255,255,.12));opacity:.9;box-shadow:0 0 30px var(--plate,transparent)}
.plate.p1{transform:translateZ(0)}.plate.p2{transform:translateZ(36px)}.plate.p3{transform:translateZ(72px)}
.board-wrap:hover .plate.p2{transform:translateZ(44px)}.board-wrap:hover .plate.p3{transform:translateZ(88px)}
.stack-legend{display:grid;gap:6px;width:100%;max-width:280px;margin-top:6px;padding:0;list-style:none;font-size:var(--text-sm)}
.stack-legend li{display:grid;grid-template-columns:10px minmax(0,1fr) auto;align-items:center;gap:8px;color:#c5d0c8}
.stack-legend i{width:10px;height:10px;border-radius:3px;background:var(--plate)}
.stack-legend b{color:#fff;font-weight:600}

/* Metric tiles */
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:var(--space-3)}
.tile{position:relative;display:grid;gap:6px;padding:16px;border:1px solid var(--color-border);border-radius:var(--radius-lg);background:var(--color-surface);
  box-shadow:var(--shadow-card);text-decoration:none;transition:transform var(--duration) var(--ease),box-shadow var(--duration) var(--ease)}
a.tile:hover{transform:translateY(-2px);box-shadow:var(--shadow-lift)}
.tile .label{display:flex;align-items:center;gap:6px;color:var(--color-text-secondary);font-size:var(--text-sm);font-weight:500}
.tile .label .icon{color:var(--accent,var(--color-text-muted))}
.tile .value{font:600 var(--text-2xl)/1.1 var(--font-display);letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.tile .value small{margin-left:3px;color:var(--color-text-muted);font:500 var(--text-sm) var(--font-sans)}
.tile .meta{color:var(--color-text-muted);font-size:var(--text-xs)}
.tile .spark{height:34px}
.tile.missing .value{color:var(--color-text-muted);font-size:var(--text-lg)}
.delta{display:inline-flex;align-items:center;gap:3px;padding:1px 7px;border-radius:var(--radius-full);font-size:var(--text-xs);font-weight:600}
.delta.good{background:var(--color-success-soft);color:var(--color-success)}
.delta.watch{background:var(--color-warning-soft);color:var(--color-warning)}
.delta.neutral{background:var(--color-surface-muted);color:var(--color-text-secondary)}

/* Badges, chips, buttons, inputs */
.badge{display:inline-flex;align-items:center;gap:4px;min-height:22px;padding:2px 8px;border-radius:var(--radius-full);font-size:var(--text-xs);font-weight:600;white-space:nowrap}
.badge.brand{background:var(--color-brand-soft);color:var(--color-brand)}
.badge.success{background:var(--color-success-soft);color:var(--color-success)}
.badge.warning{background:var(--color-warning-soft);color:var(--color-warning)}
.badge.info{background:var(--color-info-soft);color:var(--color-info)}
.badge.neutral{background:var(--color-surface-muted);color:var(--color-text-secondary)}
.badge.danger{background:var(--color-danger-soft);color:var(--color-danger)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:var(--control-h);padding:0 16px;border:1px solid transparent;border-radius:var(--radius-md);
  font:600 var(--text-base) var(--font-sans);text-decoration:none;cursor:pointer;transition:background-color var(--duration),transform var(--duration),box-shadow var(--duration)}
.btn:active{transform:translateY(1px)}
.btn.primary{background:var(--color-brand);color:var(--color-on-brand);box-shadow:0 1px 0 rgba(255,255,255,.08) inset,0 6px 14px -8px rgba(30,42,36,.7)}
.btn.primary:hover{background:var(--color-brand-hover)}
.btn.accent{background:var(--color-accent);color:var(--color-brand)}
.btn.accent:hover{background:var(--color-accent-hover)}
.btn.secondary{border-color:var(--color-border-strong);background:var(--color-surface);color:var(--color-text)}
.btn.secondary:hover{background:var(--color-surface-hover)}
.btn.ghost{background:transparent;color:var(--color-text-secondary)}
.btn.ghost:hover{background:var(--color-surface-muted)}
.btn.danger{background:var(--color-danger);color:#fff}
.btn.sm{min-height:32px;padding:0 12px;font-size:var(--text-sm)}
.btn.icon-only{width:32px;min-height:32px;padding:0}
label.field{display:grid;gap:6px;color:var(--color-text-secondary);font-size:var(--text-sm);font-weight:500}
input,select,textarea{width:100%;min-height:var(--control-h);padding:8px 12px;border:1px solid var(--color-border-input);border-radius:var(--radius-md);background:var(--color-surface);
  color:var(--color-text);font:inherit;font-size:16px}
textarea{min-height:auto;resize:vertical}
input[type=checkbox],input[type=radio]{width:auto;min-height:auto}
.form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-3) var(--space-4)}
.form-grid .full{grid-column:1/-1}
.actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.hint{color:var(--color-text-muted);font-size:var(--text-xs)}
/* One-tap scales */
.scale{display:flex;gap:6px;flex-wrap:wrap;border:0;margin:0;padding:0}
.scale legend{width:100%;margin-bottom:6px;color:var(--color-text-secondary);font-size:var(--text-sm);font-weight:500}
.scale label{position:relative}
.scale input{position:absolute;opacity:0;pointer-events:none}
.scale span{display:grid;place-items:center;min-width:44px;height:40px;padding:0 10px;border:1px solid var(--color-border-strong);border-radius:var(--radius-md);background:var(--color-surface);
  font-weight:600;font-size:var(--text-sm);cursor:pointer;transition:all var(--duration)}
.scale span small{display:block;font-weight:500;font-size:10px;color:var(--color-text-muted)}
.scale input:checked+span{border-color:var(--color-brand);background:var(--color-brand);color:var(--color-accent);box-shadow:0 6px 14px -8px rgba(30,42,36,.8)}
.scale input:checked+span small{color:#c5d0c8}
.scale input:focus-visible+span{outline:2px solid var(--color-focus);outline-offset:2px}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{display:inline-flex;align-items:center;gap:6px;min-height:32px;padding:0 12px;border:1px solid var(--color-border-strong);border-radius:var(--radius-full);background:var(--color-surface);
  font-size:var(--text-sm);font-weight:500;cursor:pointer}
.chip input{width:auto;min-height:0;margin:0}
.chip:has(input:checked){border-color:var(--color-brand);background:var(--color-brand-soft)}
button.chip:hover{background:var(--color-surface-hover)}
details.more{border-top:1px solid var(--color-border);margin-top:var(--space-4);padding-top:var(--space-3)}
details.more summary{cursor:pointer;color:var(--color-text-secondary);font-size:var(--text-sm);font-weight:600;list-style:none}
details.more summary::-webkit-details-marker{display:none}
details.more summary::before{content:"+ "}
details.more[open] summary::before{content:"− "}

/* Sentence entry */
.say{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;padding:8px;border:1px solid var(--color-border);border-radius:var(--radius-lg);background:var(--color-surface);box-shadow:var(--shadow-card)}
.say input{border:0;min-height:44px;background:transparent;box-shadow:none}
.say input:focus{outline:none}
.say:focus-within{border-color:var(--color-brand);box-shadow:0 0 0 3px rgba(200,241,105,.5),var(--shadow-card)}

/* Lists and tables */
.list{display:grid;margin:0;padding:0;list-style:none}
.list>li{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:12px;padding:12px 0;border-top:1px solid var(--color-border)}
.list>li:first-child{border-top:0}
.list .ico{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:var(--soft,var(--color-surface-muted));color:var(--accent,var(--color-text-secondary))}
.list strong{display:block;font-weight:600}
.list span.sub{display:block;color:var(--color-text-muted);font-size:var(--text-sm)}
table{width:100%;border-collapse:collapse;font-size:var(--text-sm)}
th,td{padding:8px 6px;border-bottom:1px solid var(--color-border);text-align:left;vertical-align:top}
th{color:var(--color-text-muted);font-weight:600;font-size:var(--text-xs)}
.table-wrap{overflow-x:auto}
code{font-size:12px;word-break:break-all}

/* Completeness ring */
.ring{position:relative;display:grid;place-items:center;width:128px;height:128px;flex:none}
.ring svg{position:absolute;inset:0;filter:drop-shadow(0 8px 14px rgba(30,42,36,.18))}
.ring .center{position:relative;display:grid;justify-items:center;line-height:1.1}
.ring .center b{font:700 30px/1 var(--font-display);letter-spacing:-.03em}
.ring .center small{color:var(--color-text-muted);font-size:var(--text-xs)}
.status-row{display:flex;align-items:center;gap:var(--space-5)}

/* Charts */
.chart{width:100%;height:auto;overflow:visible}
.chart text{font:11px var(--font-sans);fill:var(--color-text-muted)}
.chart .grid-line{stroke:var(--color-border);stroke-width:1}
.chart-meta{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:8px;color:var(--color-text-muted);font-size:var(--text-xs)}
.chart-meta i{display:inline-block;width:10px;height:10px;margin-right:4px;border-radius:2px;vertical-align:-1px}
.legend-band{background:var(--band);border:1px dashed var(--color-border-strong)}
.range-tabs{display:inline-flex;gap:2px;padding:3px;border:1px solid var(--color-border);border-radius:var(--radius-md);background:var(--color-surface-muted)}
.range-tabs a{padding:4px 12px;border-radius:6px;color:var(--color-text-secondary);font-size:var(--text-sm);font-weight:600;text-decoration:none}
.range-tabs a[aria-current=true]{background:var(--color-surface);color:var(--color-text);box-shadow:var(--shadow-xs)}

/* Notices */
.notice{display:grid;grid-template-columns:auto minmax(0,1fr);gap:12px;padding:14px 16px;border:1px solid var(--color-border);border-radius:var(--radius-lg);background:var(--color-surface)}
.notice.danger{border-color:var(--color-danger-border);background:var(--color-danger-soft);color:var(--color-danger)}
.notice.info{border-color:#b9d1ee;background:var(--color-info-soft)}
.notice.success{border-color:#b4dac3;background:var(--color-success-soft)}
.empty{padding:28px 16px;border:1px dashed var(--color-border-strong);border-radius:var(--radius-lg);color:var(--color-text-muted);text-align:center;font-size:var(--text-sm)}

/* Motion */
@keyframes rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.content>*{animation:rise .45s var(--ease) both}
.content>*:nth-child(2){animation-delay:.04s}.content>*:nth-child(3){animation-delay:.08s}.content>*:nth-child(4){animation-delay:.12s}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}.board{transform:none}}

/* Phones */
@media (max-width:900px){
  .grid.split,.grid.three{grid-template-columns:1fr}
  .board{grid-template-columns:1fr;padding:22px}
  .stack{min-height:200px}
}
@media (max-width:760px){
  .sidebar{display:none}
  .stage{margin-left:0;padding-bottom:calc(var(--mobile-nav-h) + env(safe-area-inset-bottom))}
  .topbar{padding:10px 16px}
  .topbar h1{font-size:var(--text-lg)}
  .mobile-brand{display:inline-grid}
  .content{padding:16px 16px 40px;gap:var(--space-4)}
  .grid.two,.form-grid{grid-template-columns:1fr}
  .tiles{grid-template-columns:repeat(2,minmax(0,1fr))}
  .tile{padding:12px}.tile .value{font-size:var(--text-xl)}
  .card{padding:16px;border-radius:16px}
  .board-wrap::after{display:none}
  .stack-scene{width:140px;height:140px}
  .mobile-nav{position:fixed;inset:auto 0 0 0;z-index:30;display:grid;grid-template-columns:repeat(5,1fr);height:calc(var(--mobile-nav-h) + env(safe-area-inset-bottom));
    padding-bottom:env(safe-area-inset-bottom);border-top:1px solid var(--color-border);background:rgba(255,255,255,.9);backdrop-filter:blur(14px)}
  .mobile-nav a{display:grid;place-items:center;align-content:center;gap:2px;color:var(--color-text-muted);font-size:11px;font-weight:600;text-decoration:none}
  .mobile-nav a[aria-current=page]{color:var(--color-brand)}
  .mobile-nav a[aria-current=page] .icon{padding:3px 12px;border-radius:999px;background:var(--color-brand-soft);box-sizing:content-box}
  .status-row{flex-direction:column;align-items:flex-start}
  .chart text{font-size:19px}.chart.wide text{font-size:32px}
}
.chart.wide text{font-size:13px}
@media (max-width:760px){.chart.wide text{font-size:32px}}
`;

type NavItem = { href: string; label: string; icon: IconName };
const NAV: NavItem[] = [
  { href: "/", label: "今天", icon: "today" },
  { href: "/log", label: "记录", icon: "plus" },
  { href: "/trends", label: "趋势", icon: "chart" },
  { href: "/insights", label: "洞察", icon: "sparkles" },
  { href: "/data", label: "数据", icon: "layers" },
];
const NAV_MORE: NavItem[] = [
  { href: "/profile", label: "档案与目标", icon: "user" },
  { href: "/import", label: "导入历史", icon: "upload" },
  { href: "/sources", label: "数据源令牌", icon: "link" },
  { href: "/privacy", label: "导出与删除", icon: "shield" },
];

/** Coach Health mark: Coachchalk's tally strokes with the cross stroke drawn as a pulse line. */
export function brandMark(size = 32) {
  return `<span class="brand-mark" style="width:${size}px;height:${size}px" aria-hidden="true"><svg viewBox="0 0 64 64" width="100%" height="100%">
<g stroke="currentColor" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" fill="none">
<line x1="18" y1="17" x2="18" y2="47"/><line x1="30" y1="17" x2="30" y2="47"/><line x1="42" y1="17" x2="42" y2="47"/>
<polyline points="9,38 22,38 27,28 34,46 39,33 55,33"/></g></svg></span>`;
}

export const FAVICON = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="15" fill="#1E2A24"/><rect x="8" y="8" width="48" height="48" rx="11" fill="#C8F169"/><g stroke="#1E2A24" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" fill="none"><line x1="21" y1="19" x2="21" y2="45"/><line x1="32" y1="19" x2="32" y2="45"/><line x1="43" y1="19" x2="43" y2="45"/><polyline points="13,38 24,38 28,30 34,44 38,34 51,34"/></g></svg>`)}`;

export interface PageOptions { path: string; subtitle?: string; actions?: string }

export function page(title: string, body: string, opts: PageOptions = { path: "" }): string {
  const current = (href: string) => (href === "/" ? opts.path === "/" : opts.path.startsWith(href)) ? ' aria-current="page"' : "";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#f3f1e7"><title>${esc(title)} · Coach Health</title>
<link rel="icon" href="${FAVICON}"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}"><style>${CSS}</style></head><body>
<aside class="sidebar" aria-label="主导航">
  <a class="brand-lockup" href="/">${brandMark()}<div><strong>Coach Health</strong><small>by Coachchalk</small></div></a>
  <nav class="nav">${NAV.map((n) => `<a href="${n.href}"${current(n.href)}>${icon(n.icon, 18)}${n.label}</a>`).join("")}
  <div class="nav-label">设置</div>${NAV_MORE.map((n) => `<a href="${n.href}"${current(n.href)}>${icon(n.icon, 18)}${n.label}</a>`).join("")}</nav>
  <div class="sidebar-foot">${icon("shield", 14)} 健康数据只属于你。默认不与任何人共享。<br><a href="https://coachchalk.com">打开 Coachchalk ↗</a></div>
</aside>
<div class="stage">
<header class="topbar"><div class="title">${opts.subtitle ? `<small>${esc(opts.subtitle)}</small>` : ""}<h1>${esc(title)}</h1></div>
<div class="actions">${opts.actions ?? ""}<a class="mobile-brand" href="/profile" aria-label="档案与设置">${brandMark(30)}</a></div></header>
<main class="content" id="main">${body}</main>
</div>
<nav class="mobile-nav" aria-label="主导航">${NAV.map((n) => `<a href="${n.href}"${current(n.href)}>${icon(n.icon, 20)}${n.label}</a>`).join("")}</nav>
</body></html>`;
}
