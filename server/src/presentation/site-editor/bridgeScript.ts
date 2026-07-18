// Versioned, inert-by-default bridge injected into deployed result HTML. It accepts a
// session nonce only from its embedding parent during the v1 hello handshake; backend
// persistence remains protected by the authenticated, project-scoped cookie routes.
export const SITE_EDITOR_BRIDGE_PATH = '/.projectsflow/site-editor-bridge.v1.js';

export const SITE_EDITOR_BRIDGE_SCRIPT = String.raw`(() => {
  if (window.__PROJECTSFLOW_SITE_EDITOR_V1__) return;
  window.__PROJECTSFLOW_SITE_EDITOR_V1__ = true;
  const protocol = 'projectsflow.site-editor';
  const version = 1;
  const safeStyles = new Set(['color','backgroundColor','borderColor','borderRadius','borderWidth','borderStyle','fontSize','fontWeight','fontFamily','lineHeight','letterSpacing','textAlign','padding','paddingTop','paddingRight','paddingBottom','paddingLeft','margin','marginTop','marginRight','marginBottom','marginLeft','gap','width','height','minWidth','minHeight','maxWidth','maxHeight','display','opacity','boxShadow','justifyContent','alignItems','flexDirection','gridTemplateColumns']);
  const safeAttributes = new Set(['title','alt','aria-label','href','target','rel','class']);
  const dangerous = /(?:javascript\s*:|expression\s*\(|url\s*\(|@import|[{};]|<\/?script)/i;
  const safeHref = (value) => {
    if ([...value].some((char) => { const code = char.charCodeAt(0); return code < 32 || code === 127; })) return false;
    if (value.startsWith('//')) return false;
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value)?.[1]?.toLowerCase();
    return !scheme || ['http', 'https', 'mailto', 'tel'].includes(scheme);
  };
  const parentOriginAllowed = (raw) => {
    try {
      const parent = new URL(raw);
      const labels = location.hostname.split('.');
      const baseHost = labels.length > 2 ? labels.slice(1).join('.') : location.hostname;
      if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
        return (parent.hostname === 'localhost' || parent.hostname === '127.0.0.1') && (parent.protocol === 'http:' || parent.protocol === 'https:');
      }
      return parent.protocol === 'https:' && (parent.hostname === baseHost || parent.hostname === 'www.' + baseHost);
    } catch { return false; }
  };
  let nonce = null;
  let parentOrigin = null;
  let mode = 'preview';
  let hovered = null;
  let selected = null;
  let revision = 0;
  const undo = [];
  const redo = [];
  let persisted = [];
  let mutationTimer = null;

  const send = (type, payload) => {
    if (!nonce || !parentOrigin) return;
    window.parent.postMessage({ protocol, version, sessionNonce: nonce, type, payload }, parentOrigin);
  };
  const selectorFor = (node) => {
    if (node.id && CSS.escape) return '#' + CSS.escape(node.id);
    for (const name of ['data-pf-id','data-testid','data-id']) {
      const value = node.getAttribute(name);
      if (value && CSS.escape) return '[' + name + '="' + CSS.escape(value) + '"]';
    }
    const parts = [];
    let current = node;
    while (current && current.nodeType === 1 && current !== document.documentElement && parts.length < 8) {
      let part = current.tagName.toLowerCase();
      const siblings = current.parentElement ? [...current.parentElement.children].filter((item) => item.tagName === current.tagName) : [];
      if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(' > ');
  };
  const describe = (node) => {
    if (!node || node === document.documentElement || node === document.body || node.closest('script,style')) return null;
    const rect = node.getBoundingClientRect();
    if (!rect.width && !rect.height) return null;
    const attributes = {};
    for (const name of ['id','class','title','alt','aria-label','data-pf-id','data-testid','data-id']) {
      const value = node.getAttribute(name);
      if (value) attributes[name] = value.slice(0, 200);
    }
    const computed = getComputedStyle(node);
    const styles = {};
    for (const name of safeStyles) {
      const value = computed[name];
      if (typeof value === 'string' && value.length <= 500 && !dangerous.test(value)) styles[name] = value;
    }
    const text = (node.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 512);
    return {
      locator: { selector: selectorFor(node), tagName: node.tagName.toLowerCase(), text, attributes },
      source: node.outerHTML.slice(0, 50000), styles,
      bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      label: (node.getAttribute('aria-label') || node.getAttribute('title') || text || node.tagName.toLowerCase()).slice(0, 80),
    };
  };
  const resolveSelected = () => selected && document.querySelector(selected.locator.selector);
  const resolveTarget = (selector) => selector ? document.querySelector(selector) : resolveSelected();
  const emitHistory = () => send('history', { revision, undoDepth: undo.length, redoDepth: redo.length });
  const record = (apply, revert) => {
    apply();
    undo.push({ apply, revert });
    redo.length = 0;
    revision += 1;
    selected = resolveSelected() ? describe(resolveSelected()) : null;
    send('select', { element: selected });
    emitHistory();
  };
  const applyPatch = (patch, selector, recordHistory = true, patchId = '') => {
    const node = resolveTarget(selector);
    if (!node || !patch) return recordHistory ? send('error', { message: 'Выбранный элемент больше не найден.' }) : undefined;
    const mutate = (apply, revert) => recordHistory ? record(apply, revert) : apply();
    if (patch.kind === 'text') {
      const before = node.textContent || '';
      const after = String(patch.value || '').slice(0, 4000);
      return mutate(() => { if (node.textContent !== after) node.textContent = after; }, () => { node.textContent = before; });
    }
    if (patch.kind === 'style') {
      if (!safeStyles.has(patch.property) || typeof patch.value !== 'string' || dangerous.test(patch.value)) return send('error', { message: 'Небезопасное CSS-значение.' });
      const before = node.style[patch.property];
      return mutate(() => { if (node.style[patch.property] !== patch.value) node.style[patch.property] = patch.value; }, () => { node.style[patch.property] = before; });
    }
    if (patch.kind === 'attribute') {
      const name = String(patch.name || '').toLowerCase();
      if (!safeAttributes.has(name) || (name === 'href' && patch.value !== null && !safeHref(String(patch.value)))) return send('error', { message: 'Небезопасный атрибут.' });
      const before = node.getAttribute(name);
      return mutate(() => patch.value === null ? node.removeAttribute(name) : node.setAttribute(name, String(patch.value)), () => before === null ? node.removeAttribute(name) : node.setAttribute(name, before));
    }
    if (patch.kind === 'visibility') {
      const before = node.hidden;
      return mutate(() => { node.hidden = Boolean(patch.hidden); }, () => { node.hidden = before; });
    }
    if (patch.kind === 'command') {
      if (patch.command === 'toggle-visibility') { const before = node.hidden; return mutate(() => { node.hidden = !before; }, () => { node.hidden = before; }); }
      if (patch.command === 'layout') { const before = node.style.display; return mutate(() => { node.style.display = 'flex'; }, () => { node.style.display = before; }); }
      if (patch.command === 'duplicate') {
        if (!recordHistory && patchId && document.querySelector('[data-pf-duplicate="' + CSS.escape(patchId) + '"]')) return;
        const clone = node.cloneNode(true); const parent = node.parentNode; const next = node.nextSibling;
        if (patchId && clone.setAttribute) clone.setAttribute('data-pf-duplicate', patchId);
        return mutate(() => parent && parent.insertBefore(clone, next), () => clone.remove());
      }
      if (patch.command === 'delete') {
        const parent = node.parentNode; const next = node.nextSibling;
        return mutate(() => node.remove(), () => parent && parent.insertBefore(node, next));
      }
    }
  };

  const applyPersisted = () => {
    for (const item of persisted) {
      if (!item || typeof item.selector !== 'string' || !item.patch) continue;
      applyPatch(item.patch, item.selector, false, String(item.id || ''));
    }
  };
  const observer = new MutationObserver(() => {
    if (!persisted.length) return;
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(() => {
      observer.disconnect();
      applyPersisted();
      observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    }, 80);
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });

  const refreshSelection = () => {
    const node = resolveSelected();
    if (node) { selected = describe(node); send('select', { element: selected }); }
  };
  window.addEventListener('scroll', refreshSelection, true);
  window.addEventListener('resize', refreshSelection);
  for (const name of ['pushState', 'replaceState']) {
    const original = history[name];
    history[name] = function (...args) { const result = original.apply(this, args); send('navigation', { path: location.pathname + location.search }); return result; };
  }

  document.addEventListener('pointermove', (event) => {
    if (mode !== 'edit') return;
    const element = describe(event.target);
    if (element?.locator.selector === hovered?.locator.selector) return;
    hovered = element;
    send('hover', { element });
  }, true);
  document.addEventListener('click', (event) => {
    if (mode !== 'edit') return;
    event.preventDefault(); event.stopPropagation();
    selected = describe(event.target);
    send('select', { element: selected });
  }, true);
  window.addEventListener('popstate', () => send('navigation', { path: location.pathname + location.search }));
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || !event.data || event.data.protocol !== protocol || event.data.version !== version) return;
    const message = event.data;
    if (message.type === 'hello') {
      if (!parentOriginAllowed(event.origin) || typeof message.sessionNonce !== 'string' || message.sessionNonce.length < 8 || message.sessionNonce.length > 256) return;
      nonce = message.sessionNonce; parentOrigin = event.origin; mode = message.payload?.mode === 'edit' ? 'edit' : 'preview';
      send('ready', { path: location.pathname + location.search }); emitHistory(); return;
    }
    if (!nonce || message.sessionNonce !== nonce || event.origin !== parentOrigin) return;
    if (message.type === 'set-mode') mode = message.payload?.mode === 'edit' ? 'edit' : 'preview';
    else if (message.type === 'navigate' && typeof message.payload?.path === 'string' && message.payload.path.startsWith('/')) location.assign(message.payload.path);
    else if (message.type === 'reload') location.reload();
    else if (message.type === 'patch') applyPatch(message.payload?.patch);
    else if (message.type === 'replay' && Array.isArray(message.payload?.patches)) {
      persisted = message.payload.patches.slice(0, 500);
      revision = Number.isInteger(message.payload.revision) && message.payload.revision >= 0 ? message.payload.revision : revision;
      applyPersisted();
      send('history', { revision, undoDepth: persisted.length, redoDepth: 0 });
    }
    else if (message.type === 'undo' && undo.length) { const action = undo.pop(); action.revert(); redo.push(action); revision += 1; emitHistory(); }
    else if (message.type === 'redo' && redo.length) { const action = redo.pop(); action.apply(); undo.push(action); revision += 1; emitHistory(); }
  });
})();`;
