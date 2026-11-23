export function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function page(title: string, body: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
:root{--bg:#fafaf8;--fg:#1d1d1b;--muted:#6b6b66;--line:#e2e1dc;--accent:#2f6f4f;--warn:#9a5b00;--danger:#b42318;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#151514;--fg:#ecebe6;--muted:#a3a29c;--line:#33332f;--accent:#7fc4a0;--warn:#e0a84a;--danger:#ff8a80;--card:#1e1e1c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"PingFang SC",sans-serif}
main{max-width:760px;margin:0 auto;padding:16px}nav{display:flex;gap:14px;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid var(--line)}
nav a{color:var(--fg);text-decoration:none}nav a:hover{text-decoration:underline}
h1{font-size:22px;margin:8px 0 16px}h2{font-size:17px;margin:24px 0 8px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:12px 0}
.muted{color:var(--muted)}.warn{color:var(--warn)}.danger{border-color:var(--danger);color:var(--danger)}
table{width:100%;border-collapse:collapse;font-size:14px}td,th{text-align:left;padding:6px 4px;border-bottom:1px solid var(--line)}
label{display:block;margin:10px 0 4px}input,select,textarea{font:inherit;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--fg);width:100%}
.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}button{font:inherit;padding:8px 14px;border-radius:6px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer}
.chips label{display:inline-flex;gap:4px;align-items:center;margin:4px 10px 4px 0}.chips input{width:auto}
code{font-size:13px;word-break:break-all}
</style></head><body>
<nav><a href="/">今天</a><a href="/quality">数据质量</a><a href="/import">导入历史</a><a href="/sources">数据源</a><a href="/privacy">导出与删除</a></nav>
<main>${body}</main></body></html>`;
}
