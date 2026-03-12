export function renderTemplate(template: string, content: Record<string, unknown>): string {
  let html = template;
  html = processEachBlocks(html, content);
  html = processIfBlocks(html, content);
  html = replaceVariables(html, content);
  html = html.replace(/\{\{[^}]+\}\}/g, '');
  return html;
}
function processEachBlocks(html: string, data: Record<string, unknown>): string {
  const r = /\{\{#each\s+([\w.[\]]+)\}\}([\s\S]*?)\{\{\/each\}\}/g;
  return html.replace(r, (_, path: string, inner: string) => {
    const items = gv(data, path);
    if (!Array.isArray(items) || items.length === 0) return '';
    return items.map((item, i) => {
      let s = inner.replace(/\{\{@index\}\}/g, String(i));
      if (typeof item !== 'object' || item === null) return s.replace(/\{\{this\}\}/g, String(item));
      s = processEachBlocks(s, item as Record<string, unknown>);
      s = processIfBlocks(s, item as Record<string, unknown>);
      s = s.replace(/\{\{(\w[\w.]*)\}\}/g, (_: string, k: string) => {
        const v = gv(item as Record<string, unknown>, k);
        if (v !== undefined && v !== null) return String(v);
        const rv = gv(data, k);
        if (rv !== undefined && rv !== null) return String(rv);
        return '';
      });
      return s;
    }).join('\n');
  });
}
function processIfBlocks(html: string, data: Record<string, unknown>): string {
  return html.replace(/\{\{#if\s+([\w.[\]]+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g, (_, p: string, t: string, f: string = '') => {
    const v = gv(data, p);
    return (v !== undefined && v !== null && v !== '' && v !== false && !(Array.isArray(v) && v.length === 0)) ? t : f;
  });
}
function replaceVariables(html: string, data: Record<string, unknown>): string {
  return html.replace(/\{\{([\w.[\]]+)\}\}/g, (_, p: string) => {
    const v = gv(data, p); if (v === undefined || v === null) return '';
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  });
}
function gv(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let c: unknown = obj;
  for (const k of keys) { if (c == null || typeof c !== 'object') return undefined; c = (c as any)[k]; }
  return c;
}
