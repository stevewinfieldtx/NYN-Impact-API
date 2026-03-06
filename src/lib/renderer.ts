// Template Renderer — merges Kimi design templates with JSON content schemas
// Templates use Mustache-like syntax: {{field.path}}, {{#each items}}, {{#if field}}

export function renderTemplate(template: string, content: Record<string, unknown>): string {
  let html = template;

  // 1. Process {{#each path}}...{{/each}} loops
  html = processEachBlocks(html, content);

  // 2. Process {{#if path}}...{{/if}} conditionals
  html = processIfBlocks(html, content);

  // 3. Replace {{field.path}} variables
  html = replaceVariables(html, content);

  // 4. Clean up any remaining unresolved tags
  html = html.replace(/\{\{[^}]+\}\}/g, '');

  return html;
}

function processEachBlocks(html: string, data: Record<string, unknown>): string {
  const eachRegex = /\{\{#each\s+([\w.[\]]+)\}\}([\s\S]*?)\{\{\/each\}\}/g;

  return html.replace(eachRegex, (_match, path: string, inner: string) => {
    const items = getNestedValue(data, path);
    if (!Array.isArray(items) || items.length === 0) return '';

    return items.map((item, index) => {
      let rendered = inner;

      // Replace {{@index}} with current index
      rendered = rendered.replace(/\{\{@index\}\}/g, String(index));

      // If item is a primitive, replace {{this}}
      if (typeof item !== 'object' || item === null) {
        rendered = rendered.replace(/\{\{this\}\}/g, String(item));
        return rendered;
      }

      // Process nested each blocks within this item
      rendered = processEachBlocks(rendered, item as Record<string, unknown>);

      // Process nested if blocks within this item
      rendered = processIfBlocks(rendered, item as Record<string, unknown>);

      // Replace {{field}} references to item properties
      rendered = rendered.replace(/\{\{(\w[\w.]*)\}\}/g, (_m, key: string) => {
        // First try item-level, then fall back to root
        const val = getNestedValue(item as Record<string, unknown>, key);
        if (val !== undefined && val !== null) return String(val);
        const rootVal = getNestedValue(data, key);
        if (rootVal !== undefined && rootVal !== null) return String(rootVal);
        return '';
      });

      return rendered;
    }).join('\n');
  });
}

function processIfBlocks(html: string, data: Record<string, unknown>): string {
  const ifRegex = /\{\{#if\s+([\w.[\]]+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g;

  return html.replace(ifRegex, (_match, path: string, truthy: string, falsy: string = '') => {
    const value = getNestedValue(data, path);
    const isTruthy = value !== undefined && value !== null && value !== '' && value !== false &&
      !(Array.isArray(value) && value.length === 0);
    return isTruthy ? truthy : falsy;
  });
}

function replaceVariables(html: string, data: Record<string, unknown>): string {
  return html.replace(/\{\{([\w.[\]]+)\}\}/g, (_match, path: string) => {
    const value = getNestedValue(data, path);
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  });
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

// Generate a complete static HTML page from template + content
export function generateStaticSite(template: string, content: Record<string, unknown>): string {
  return renderTemplate(template, content);
}
