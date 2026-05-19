import { CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import * as fs from 'fs';

const SF_BASE = 'https://qualcomm-cdmatech-support.lightning.force.com';
const LIST_URL = `${SF_BASE}/lightning/o/Case/list?filterName=My_Open_Casesx1`;
const MAPPING_FILE = 'C:/Users/zhizhouc/Documents/sf_case_id_mapping.json';

function loadMapping(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(MAPPING_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveMapping(mapping: Record<string, string>) {
  try {
    fs.writeFileSync(MAPPING_FILE, JSON.stringify(mapping, null, 2));
  } catch {}
}

async function resolveCaseUrl(page: any, caseNum: string): Promise<string> {
  const mapping = loadMapping();
  if (!mapping[caseNum]) {
    throw new Error(`Case ${caseNum} not found in Salesforce ID mapping. Run "opencli salesforce cases-internal" first to refresh the mapping, or open the case in Salesforce to ensure it appears in the list.`);
  }
  return `${SF_BASE}/lightning/r/Case/${mapping[caseNum]}/view`;
}

async function refreshMappingFromPage(page: any, caseNum: string) {
  const href = await page.evaluate('location.href');
  const match = String(href || '').match(/\/Case\/([a-zA-Z0-9]{15,18})\/view/);
  if (!match || match[1] === caseNum) return;
  const mapping = loadMapping();
  if (mapping[caseNum] === match[1]) return;
  mapping[caseNum] = match[1];
  saveMapping(mapping);
}

function resolveReplyText(kwargs: Record<string, any>): string {
  if (kwargs.file) {
    return fs.readFileSync(String(kwargs.file), 'utf-8').trim();
  }
  return String(kwargs.text || '').trim();
}

async function inspectComposer(page: any): Promise<any> {
  return page.evaluate(`(() => {
    const norm = (value) => (value || '').replace(/\\u200b/g, '').replace(/\\s+/g, ' ').trim();
    const isRenderable = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (!style) return false;
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      if (el.hidden) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const toHit = (el, source) => {
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return {
        source,
        tag: el.tagName || '',
        text: norm(el.innerText || el.textContent || ''),
        title: norm(el.getAttribute?.('title') || ''),
        cls: norm((el.className || '').toString()),
        placeholder: norm(el.getAttribute?.('placeholder') || el.getAttribute?.('data-placeholder') || ''),
        renderable: isRenderable(el),
        disabled: !!el.disabled,
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    };
    const matchesNewPostEditor = (el) => {
      if (!el) return false;
      const tag = (el.tagName || '').toLowerCase();
      const isEditable = el.getAttribute?.('contenteditable') === 'true' || tag === 'textarea' || el.getAttribute?.('role') === 'textbox';
      if (!isEditable) return false;
      const hint = [
        norm(el.getAttribute?.('placeholder') || ''),
        norm(el.getAttribute?.('data-placeholder') || ''),
        norm(el.getAttribute?.('aria-label') || ''),
        norm(el.getAttribute?.('title') || ''),
        norm((el.className || '').toString()),
      ].join(' ').toLowerCase();
      if (hint.includes('write a comment') || hint.includes('commenttextarea') || hint.includes('comment text')) return false;
      if (hint.includes('search') || hint.includes('qlarify')) return false;
      if (hint.includes('share an update')) return true;
      if ((el.className || '').toString().includes('ql-editor')) return true;
      if (el.closest?.('.publisherRichTextEditor')) return true;
      return false;
    };
    const editorSelectors = [
      '.publisherRichTextEditor .ql-editor[contenteditable="true"]',
      '.publisherRichTextEditor [contenteditable="true"]',
      '.ql-editor[data-placeholder*="Share an update"]',
      '.ql-editor[contenteditable="true"]',
      '[contenteditable="true"][data-placeholder*="Share an update"]',
      '[contenteditable="true"][aria-label*="Share an update"]',
      '[contenteditable="true"]',
      '[role="textbox"][contenteditable="true"]',
      'textarea[data-placeholder*="Share an update"]',
      'textarea[placeholder*="Share an update"]',
      'textarea',
    ];
    let editor = null;
    for (const selector of editorSelectors) {
      const nodes = Array.from(document.querySelectorAll(selector));
      const match = nodes.find((node) => matchesNewPostEditor(node) && isRenderable(node)) || nodes.find((node) => matchesNewPostEditor(node));
      if (match) {
        editor = match;
        break;
      }
    }
    const submitSelectors = [
      '.dummyButtonSubmitAction',
      '.testid__dummy-button-submit-action',
      'button[title="Share"]',
      'button[title="Post"]',
      'button[title="Send"]',
      'button[aria-label="Share"]',
    ];
    let submit = null;
    for (const selector of submitSelectors) {
      const nodes = Array.from(document.querySelectorAll(selector));
      const match = nodes.find((node) => isRenderable(node) && !node.disabled) || nodes.find((node) => !node.disabled);
      if (match) {
        submit = match;
        break;
      }
    }
    const actionSelectors = [
      '.show_post_area_button',
      '.dummyButtonCallToAction',
      '.forcePublisherQuickActionCollapser',
      '.testid__publisher-quick-action-collapser',
      'a[data-tab-name="FeedItem.TextPost"]',
      '[data-target-selection-name="FeedItem.TextPostTab"]',
      'a.ew_ceupdate_button',
      '.ew_ceupdate_button',
    ];
    const actions = actionSelectors
      .map((selector) => toHit(document.querySelector(selector), selector))
      .filter(Boolean);
    const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], [role="tab"]'))
      .map((node) => toHit(node, 'candidate'))
      .filter((item) => {
        const hint = [item.text, item.title, item.cls].join(' ').toLowerCase();
        return /share|post|comment|update|publisher|ce update|submit|send/.test(hint);
      })
      .slice(0, 20);
    return {
      editor: editor ? {
        ...toHit(editor, 'editor'),
        value: norm('value' in editor ? editor.value : (editor.innerText || editor.textContent || '')),
      } : null,
      submit: submit ? toHit(submit, 'submit') : null,
      actions,
      candidates,
    };
  })()`);
}

async function tryNativeClick(page: any, hit: any, waitSeconds = 1) {
  if (!hit) return false;
  if (typeof hit.x !== 'number' || typeof hit.y !== 'number') return false;
  if (page.nativeClick) {
    await page.nativeClick(hit.x, hit.y);
  } else {
    await page.evaluate(`(() => {
      const x = ${JSON.stringify(hit.x)};
      const y = ${JSON.stringify(hit.y)};
      const el = document.elementFromPoint(x, y);
      if (el) el.click();
      return !!el;
    })()`);
  }
  await page.wait(waitSeconds);
  return true;
}

async function openComposerNative(page: any): Promise<any> {
  let lastState = await inspectComposer(page);
  const pressHotkey = async () => {
    if (!page.nativeKeyPress) return;
    try {
      await page.evaluate('document.body && document.body.focus && document.body.focus()');
    } catch {}
    await page.nativeKeyPress('u');
    await page.wait(1.2);
  };

  for (let round = 0; round < 4; round++) {
    if (lastState?.editor && lastState?.submit) return lastState;
    await pressHotkey();
    lastState = await inspectComposer(page);
    if (lastState?.editor && lastState?.submit) return lastState;

    const clickOrder = [
      '.show_post_area_button',
      '.forcePublisherQuickActionCollapser',
      '.testid__publisher-quick-action-collapser',
      'a[data-tab-name="FeedItem.TextPost"]',
      '[data-target-selection-name="FeedItem.TextPostTab"]',
      'a.ew_ceupdate_button',
      '.ew_ceupdate_button',
      '.dummyButtonCallToAction',
    ];
    for (const selector of clickOrder) {
      const hit = (lastState?.actions || []).find((item: any) => item.source === selector);
      if (!hit) continue;
      await tryNativeClick(page, hit, 1.2);
      lastState = await inspectComposer(page);
      if (lastState?.editor && lastState?.submit) return lastState;
    }
  }
  return lastState;
}

async function insertReplyText(page: any, text: string): Promise<any> {
  let state = await inspectComposer(page);
  const editor = state?.editor;
  if (!editor) return { ok: false, stage: 'missing-editor' };
  await tryNativeClick(page, editor, 0.4);
  const prepared = await page.evaluate(`(() => {
    const clickX = ${JSON.stringify(editor.x)};
    const clickY = ${JSON.stringify(editor.y)};
    const selectors = [
      '.publisherRichTextEditor .ql-editor[contenteditable="true"]',
      '.publisherRichTextEditor [contenteditable="true"]',
      '.ql-editor[data-placeholder*="Share an update"]',
      '.ql-editor[contenteditable="true"]',
      '[contenteditable="true"][data-placeholder*="Share an update"]',
      '[contenteditable="true"]',
      '[role="textbox"][contenteditable="true"]',
      'textarea',
    ];
    const norm = (value) => (value || '').replace(/\\u200b/g, '').replace(/\\s+/g, ' ').trim();
    const isTarget = (el) => {
      if (!el) return false;
      const tag = (el.tagName || '').toLowerCase();
      const isEditable = el.getAttribute?.('contenteditable') === 'true' || tag === 'textarea' || el.getAttribute?.('role') === 'textbox';
      if (!isEditable) return false;
      const hint = [
        norm(el.getAttribute?.('placeholder') || ''),
        norm(el.getAttribute?.('data-placeholder') || ''),
        norm(el.getAttribute?.('aria-label') || ''),
        norm(el.getAttribute?.('title') || ''),
        norm((el.className || '').toString()),
      ].join(' ').toLowerCase();
      if (hint.includes('write a comment') || hint.includes('commenttextarea') || hint.includes('comment text')) return false;
      return hint.includes('share an update') || hint.includes('ql-editor') || !!el.closest?.('.publisherRichTextEditor');
    };
    const resolveFromPoint = () => {
      let el = document.elementFromPoint(clickX, clickY);
      if (!el) return null;
      const visited = new Set();
      while (el && !visited.has(el)) {
        visited.add(el);
        if (isTarget(el)) return el;
        const child = el.querySelector?.('[contenteditable="true"], [role="textbox"], textarea');
        if (child && isTarget(child)) return child;
        el = el.parentElement;
      }
      return null;
    };
    for (const node of Array.from(document.querySelectorAll('[data-opencli-salesforce-editor="1"]'))) {
      node.removeAttribute('data-opencli-salesforce-editor');
    }
    const pointTarget = resolveFromPoint();
    if (pointTarget) {
      pointTarget.setAttribute('data-opencli-salesforce-editor', '1');
      pointTarget.focus();
      if ('value' in pointTarget) {
        pointTarget.value = '';
        pointTarget.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        pointTarget.innerHTML = '';
        pointTarget.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
      }
      return true;
    }
    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector));
      const el = nodes.find((node) => isTarget(node));
      if (!el) continue;
      el.setAttribute('data-opencli-salesforce-editor', '1');
      el.focus();
      if ('value' in el) {
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        el.innerHTML = '';
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
      }
      return true;
    }
    return false;
  })()`);
  if (!prepared) {
    return { ok: false, stage: 'prepare-target-failed' };
  }
  if (page.nativeType) {
    try {
      await page.nativeType(text);
    } catch {}
  }
  const exactValueAfterNative = await page.evaluate(`(() => {
    const norm = (value) => (value || '').replace(/\\u200b/g, '').replace(/\\s+/g, ' ').trim();
    const el = document.querySelector('[data-opencli-salesforce-editor="1"]');
    if (!el) return '';
    return norm('value' in el ? el.value : (el.innerText || el.textContent || ''));
  })()`);
  if (exactValueAfterNative === text.replace(/\s+/g, ' ').trim()) {
    return { ok: true, stage: 'native', value: exactValueAfterNative, editorClass: editor.cls || '' };
  }

  const fallback = await page.evaluate(`(() => {
    const text = ${JSON.stringify(text)};
    const norm = (value) => (value || '').replace(/\\u200b/g, '').replace(/\\s+/g, ' ').trim();
    const el = document.querySelector('[data-opencli-salesforce-editor="1"]');
    if (!el) return false;
    el.focus();
    if ('value' in el) {
      el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return norm(el.value) === norm(text);
    }
    const lines = text.split('\\n');
    el.innerHTML = lines.map((line) => '<p>' + (line || '<br>') + '</p>').join('');
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
    return norm(el.innerText || el.textContent || '') === norm(text);
  })()`);
  if (fallback) {
    return { ok: true, stage: 'fallback', value: exactValueAfterNative, editorClass: editor.cls || '' };
  }
  const exactValueAfterFallback = await page.evaluate(`(() => {
    const norm = (value) => (value || '').replace(/\\u200b/g, '').replace(/\\s+/g, ' ').trim();
    const el = document.querySelector('[data-opencli-salesforce-editor="1"]');
    if (!el) return '';
    return norm('value' in el ? el.value : (el.innerText || el.textContent || ''));
  })()`);
  return {
    ok: exactValueAfterFallback === text.replace(/\s+/g, ' ').trim(),
    stage: 'verify',
    valueAfterNative: exactValueAfterNative,
    valueAfterFallback: exactValueAfterFallback,
    editorClass: editor.cls || '',
    renderable: !!editor.renderable,
  };
}

async function inspectCeUpdateModal(page: any): Promise<any> {
  return page.evaluate(`(() => {
    const norm = (value) => (value || '').replace(/\\u200b/g, '').replace(/\\s+/g, ' ').trim();
    const isRenderable = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (!style) return false;
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      if (el.hidden) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const toHit = (el, source) => {
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return {
        source,
        tag: el.tagName || '',
        text: norm(el.innerText || el.textContent || ''),
        title: norm(el.getAttribute?.('title') || ''),
        cls: norm((el.className || '').toString()),
        placeholder: norm(el.getAttribute?.('placeholder') || el.getAttribute?.('data-placeholder') || ''),
        disabled: !!el.disabled,
        renderable: isRenderable(el),
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        value: norm('value' in el ? el.value : (el.innerText || el.textContent || '')),
      };
    };
    const roots = [document];
    for (let ri = 0; ri < roots.length; ri++) {
      const root = roots[ri];
      if (!root || !root.querySelectorAll) continue;
      root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) roots.push(el.shadowRoot); });
    }
    const candidates = [];
    roots.forEach((root) => {
      if (!root || !root.querySelectorAll) return;
      root.querySelectorAll('.swal2-popup, .swal2-container.ceupdate-container, .swal2-container, [role="dialog"], .slds-modal, .modal, [class*="modal"], [id*="ceupdate"], [id*="caseupdate"]').forEach((el) => candidates.push(el));
    });
    const modals = candidates
      .filter((el, idx) => candidates.indexOf(el) === idx)
      .filter((el) => {
        const text = norm(el.innerText || el.textContent || '');
        return isRenderable(el) && /case\\s+\\d+|ce update|case update|latest qualcomm progress update|subject tag status|answer given-awaiting feedback/i.test(text);
      });
    const modal = modals[0] || null;
    if (!modal) return { visible: false };
    const textareas = Array.from(modal.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]'));
    // Prefer the ql-editor (main reply rich-text box); avoid the progress-update textarea
    const editor =
      textareas.find((el) => isRenderable(el) && (el.className || '').toString().includes('ql-editor')) ||
      textareas.find((el) => isRenderable(el) && /enter case comment/i.test(norm(el.getAttribute?.('placeholder') || el.getAttribute?.('data-placeholder') || ''))) ||
      textareas.find((el) => isRenderable(el) && !/latest qualcomm progress update|subject/i.test(norm(el.getAttribute?.('placeholder') || el.getAttribute?.('data-placeholder') || '')) && !norm('value' in el ? el.value : (el.innerText || el.textContent || ''))) ||
      textareas.find((el) => isRenderable(el) && !/latest qualcomm progress update/i.test(norm(el.getAttribute?.('placeholder') || el.getAttribute?.('data-placeholder') || '')));
    const buttons = Array.from(modal.querySelectorAll('button, [role="button"]'));
    const save =
      buttons.find((el) => isRenderable(el) && /^save$/i.test(norm(el.innerText || el.textContent || ''))) ||
      buttons.find((el) => /^save$/i.test(norm(el.innerText || el.textContent || '')));
    return {
      visible: true,
      modalText: norm(modal.innerText || modal.textContent || '').slice(0, 400),
      editor: editor ? toHit(editor, 'ce-update-editor') : null,
      save: save ? toHit(save, 'ce-update-save') : null,
    };
  })()`);
}

async function dismissEasyWorkTimeout(page: any): Promise<boolean> {
  const clicked = await page.evaluate(`(() => {
    const norm = (value) => (value || '').replace(/\\u200b/g, '').replace(/\\s+/g, ' ').trim();
    const popups = Array.from(document.querySelectorAll('.swal2-popup, .swal2-container, [role="dialog"]'));
    const popup = popups.find((el) => /timeout to get case information|click\s+ok\s+to\s+refresh/i.test(norm(el.innerText || el.textContent || '')));
    if (!popup) return false;
    const buttons = Array.from(popup.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]'));
    const ok = buttons.find((el) => /^ok$/i.test(norm(el.innerText || el.textContent || el.value || el.getAttribute?.('title') || el.getAttribute?.('aria-label') || ''))) || buttons[0];
    if (!ok) return false;
    ok.click();
    return true;
  })()`);
  if (clicked) await page.wait(5);
  return !!clicked;
}

async function waitForCeUpdateModalAfterTrigger(page: any): Promise<any> {
  let modal = await inspectCeUpdateModal(page);
  if (modal?.visible) return modal;
  for (let poll = 0; poll < 20; poll++) {
    await dismissEasyWorkTimeout(page);
    modal = await inspectCeUpdateModal(page);
    if (modal?.visible) return modal;
    await page.wait(1.5);
  }
  return modal;
}

async function openCeUpdateModal(page: any): Promise<any> {
  let modal = await inspectCeUpdateModal(page);
  if (modal?.visible) return modal;
  for (let openTry = 0; openTry < 3 && !modal?.visible; openTry++) {
    if (page.nativeKeyPress) {
      try {
        await page.evaluate('document.body && document.body.focus && document.body.focus()');
      } catch {}
      await page.nativeKeyPress('u');
    }
    modal = await waitForCeUpdateModalAfterTrigger(page);
  }
  return modal;
}

async function insertCeUpdateText(page: any, text: string): Promise<any> {
  const modal = await inspectCeUpdateModal(page);
  if (!modal?.visible || !modal?.editor) {
    return { ok: false, stage: 'modal-editor-missing' };
  }
  await tryNativeClick(page, modal.editor, 0.3);
  const prepared = await page.evaluate(`(() => {
    const clickX = ${JSON.stringify(modal.editor.x)};
    const clickY = ${JSON.stringify(modal.editor.y)};
    const norm = (value) => (value || '').replace(/\\u200b/g, '').replace(/\\s+/g, ' ').trim();
    for (const node of Array.from(document.querySelectorAll('[data-opencli-salesforce-editor="1"]'))) {
      node.removeAttribute('data-opencli-salesforce-editor');
    }
    const modal = Array.from(document.querySelectorAll('.swal2-popup, .swal2-container.ceupdate-container, .swal2-container'))
      .find((el) => /case\\s+\\d+|ce update|latest qualcomm progress update/i.test(norm(el.innerText || el.textContent || '')));
    if (!modal) return false;
    const fromPoint = () => {
      let el = document.elementFromPoint(clickX, clickY);
      const visited = new Set();
      while (el && !visited.has(el)) {
        visited.add(el);
        const tag = (el.tagName || '').toLowerCase();
        const placeholder = norm(el.getAttribute?.('placeholder') || el.getAttribute?.('data-placeholder') || '');
        const isEditable = tag === 'textarea' || el.getAttribute?.('contenteditable') === 'true' || el.getAttribute?.('role') === 'textbox';
        if (isEditable && !/subject|latest qualcomm progress update/i.test(placeholder)) return el;
        // Prefer ql-editor child
        const qlChild = el.querySelector?.('.ql-editor[contenteditable="true"]');
        if (qlChild) return qlChild;
        const child = el.querySelector?.('textarea, [contenteditable="true"], [role="textbox"]');
        if (child) {
          const childPlaceholder = norm(child.getAttribute?.('placeholder') || child.getAttribute?.('data-placeholder') || '');
          if (!/subject|latest qualcomm progress update/i.test(childPlaceholder)) return child;
        }
        el = el.parentElement;
      }
      return null;
    };
    const nodes = Array.from(modal.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]'));
    const editor = fromPoint() ||
      nodes.find((el) => (el.className || '').toString().includes('ql-editor') && el.getBoundingClientRect().width > 0) ||
      nodes.find((el) => /enter case comment/i.test(norm(el.getAttribute?.('placeholder') || el.getAttribute?.('data-placeholder') || '')) && el.getBoundingClientRect().width > 0) ||
      nodes.find((el) => {
        const rect = el.getBoundingClientRect();
        const value = norm('value' in el ? el.value : (el.innerText || el.textContent || ''));
        const placeholder = norm(el.getAttribute?.('placeholder') || el.getAttribute?.('data-placeholder') || '');
        return rect.width > 0 && rect.height > 0 && !value && !/subject|latest qualcomm progress update/i.test(placeholder);
      }) ||
      nodes.find((el) => {
        const rect = el.getBoundingClientRect();
        const placeholder = norm(el.getAttribute?.('placeholder') || el.getAttribute?.('data-placeholder') || '');
        return rect.width > 0 && rect.height > 0 && !/latest qualcomm progress update/i.test(placeholder);
      });
    if (!editor) return false;
    editor.setAttribute('data-opencli-salesforce-editor', '1');
    editor.focus();
    if ('value' in editor) {
      editor.value = '';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      editor.innerHTML = '';
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    }
    return true;
  })()`);
  if (!prepared) return { ok: false, stage: 'modal-prepare-failed' };
  if (page.nativeType) {
    try {
      await page.nativeType(text);
    } catch {}
  }
  const nativeValue = await page.evaluate(`(() => {
    const norm = (value) => (value || '').replace(/\\u200b/g, '').replace(/\\s+/g, ' ').trim();
    const el = document.querySelector('[data-opencli-salesforce-editor="1"]');
    if (!el) return '';
    return norm('value' in el ? el.value : (el.innerText || el.textContent || ''));
  })()`);
  if (nativeValue === text.replace(/\s+/g, ' ').trim()) {
    return { ok: true, stage: 'modal-native', value: nativeValue };
  }
  const fallback = await page.evaluate(`(() => {
    const text = ${JSON.stringify(text)};
    const norm = (value) => (value || '').replace(/\\u200b/g, '').replace(/\\s+/g, ' ').trim();
    const el = document.querySelector('[data-opencli-salesforce-editor="1"]');
    if (!el) return false;
    el.focus();
    if ('value' in el) {
      el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return norm(el.value) === norm(text);
    }
    el.innerHTML = text.split('\\n').map((line) => '<p>' + (line || '<br>') + '</p>').join('');
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
    return norm(el.innerText || el.textContent || '') === norm(text);
  })()`);
  if (!fallback) {
    return { ok: false, stage: 'modal-verify-failed', nativeValue };
  }
  const fallbackValue = await page.evaluate(`(() => {
    const norm = (value) => (value || '').replace(/\\u200b/g, '').replace(/\\s+/g, ' ').trim();
    const el = document.querySelector('[data-opencli-salesforce-editor="1"]');
    if (!el) return '';
    return norm('value' in el ? el.value : (el.innerText || el.textContent || ''));
  })()`);
  return { ok: fallbackValue === text.replace(/\s+/g, ' ').trim(), stage: 'modal-fallback', value: fallbackValue };
}



async function setSubjectInModal(page: any, subjectValue: string): Promise<boolean> {
  // Get coordinates and current value of the Subject input field
  const inputCoords = await page.evaluate(`(()=>{
    const norm = (value) => (value || '').replace(/\u200b/g, '').replace(/\s+/g, ' ').trim();
    const modal = Array.from(document.querySelectorAll('.swal2-popup, .swal2-container.ceupdate-container, .swal2-container, [role="dialog"], .slds-modal, .modal, [class*="modal"], [id*="ceupdate"], [id*="caseupdate"]'))
      .find((el) => /case\s+\d+|ce update|case update|subject tag status|answer given-awaiting feedback/i.test(norm(el.innerText || el.textContent || '')));
    if (!modal) return null;
    const inputs = Array.from(modal.querySelectorAll('input[type="text"], input:not([type]), textarea'));
    for (const inp of inputs) {
      const rect = inp.getBoundingClientRect();
      if (rect.width === 0) continue;
      const placeholder = norm(inp.getAttribute('placeholder') || inp.getAttribute('data-placeholder') || '');
      if (placeholder.toLowerCase().includes('status')) continue;
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2), current: inp.value || '' };
    }
    return null;
  })()`);
  if (!inputCoords) return false;
  // Skip if value is already the same
  if ((inputCoords as any).current === subjectValue) return true;
  let finalValue = subjectValue;

  // Click to focus the Subject input field
  if (page.nativeClick) await page.nativeClick((inputCoords as any).x, (inputCoords as any).y);
  await page.wait(0.5);
  // Use execCommand to select all and replace - works with React/LWC
  await page.evaluate(`(()=>{
    const modal = Array.from(document.querySelectorAll('.swal2-popup, .swal2-container.ceupdate-container, .swal2-container, [role="dialog"], .slds-modal, .modal, [class*="modal"], [id*="ceupdate"], [id*="caseupdate"]'))
      .find((el) => /case|ce update|case update|subject tag status|answer given-awaiting feedback/i.test((el.innerText||el.textContent||'')));
    if (!modal) return;
    const inp = modal.querySelector('input[type="text"], input:not([type])');
    if (!inp) return;
    inp.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, ${JSON.stringify(finalValue)});
  })()`);
  await page.wait(0.5);
  return true;
}

async function setSelectById(page: any, id: string, targetText: string): Promise<string> {
  const result = await page.evaluate(`(()=>{
    const norm = (v) => (v||'').replace(/\u200b/g,'').replace(/\s+/g,' ').trim();
    const sel = document.getElementById(${JSON.stringify(id)});
    if (!sel) return 'NOT FOUND: ' + ${JSON.stringify(id)};
    const target = norm(${JSON.stringify(targetText)});
    for (const opt of sel.options) {
      if (norm(opt.text).toLowerCase().includes(target.toLowerCase()) || norm(opt.value).toLowerCase().includes(target.toLowerCase())) {
        sel.value = opt.value;
        ['focus','input','change','blur'].forEach(ev => sel.dispatchEvent(new Event(ev, { bubbles: true })));
        return 'ok:' + opt.text;
      }
    }
    return 'NO MATCH for ' + target + ' in [' + Array.from(sel.options).map(o=>o.text).join('|').substring(0,80) + ']';
  })()`);
  return String(result);
}

async function setStatusInModal(page: any, statusValue: string): Promise<boolean> {
  const result = await setSelectById(page, 'ID_STATUS_MASK_', statusValue);
  return result.startsWith('ok:');
}

// RCA shortcut map: key -> detail option text to match
const RCA_PRESETS: Record<string, string> = {
  pa:   'Picture Adjustment',
  pp:   'Post Processing Algorithms',
  qdcm: 'QDCM',
};

async function fillCrField(page: any, crNum: string): Promise<string> {
  // id_cr_list is a plain text input — click to focus then nativeType
  const coords = await page.evaluate(`(()=>{
    const inp = document.getElementById('id_cr_list');
    if (!inp) return null;
    const rect = inp.getBoundingClientRect();
    if (rect.width === 0) return null;
    return JSON.stringify({ x: Math.round(rect.left + rect.width/2), y: Math.round(rect.top + rect.height/2) });
  })()`);
  if (!coords) return 'cr: id_cr_list NOT FOUND';
  const c = JSON.parse(String(coords));
  if (page.nativeClick) { try { await page.nativeClick(c.x, c.y); } catch {} }
  await page.wait(0.3);
  // Clear existing value first
  await page.evaluate(`(()=>{
    const inp = document.getElementById('id_cr_list');
    if (!inp) return;
    inp.value = '';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  if (page.nativeType) { try { await page.nativeType(crNum); } catch {} }
  await page.wait(0.3);
  // Verify
  const val = await page.evaluate(`(()=>{
    const inp = document.getElementById('id_cr_list');
    return inp ? inp.value : '';
  })()`);
  return 'cr: ok (value=' + String(val) + ')';
}

async function fillRcaDefaults(page: any, opts: { rca?: string; complexity?: string; summary?: string } = {}): Promise<string> {
  const results: string[] = [];

  // Complexity: default 3-Medium
  const complexityMap: Record<string, string> = {
    '1': '1 - Easy', '2': '2 - Non-Trivial', '3': '3 - Medium',
    '4': '4 - High', '5': '5 - Very High',
  };
  const complexityTarget = complexityMap[opts.complexity || '3'] || '3 - Medium';
  results.push(await setSelectById(page, 'ID_CASE_COMPLEXITY_MASK_', complexityTarget));

  // RCA cascade: team=Multimedia → sub=Display → main=System KPI → detail
  results.push(await setSelectById(page, 'id_rca_team', 'Multimedia'));
  await page.wait(1);
  results.push(await setSelectById(page, 'id_rca_sub_team', 'Display'));
  await page.wait(1);
  results.push(await setSelectById(page, 'id_rca_main_root_cause', 'System KPI'));
  await page.wait(2);

  // Detail: pick from preset or default to Post Processing
  const rcaKey = (opts.rca || 'pp').toLowerCase();
  const detailTarget = RCA_PRESETS[rcaKey] || RCA_PRESETS['pp'];
  let detailResult = 'detail: timeout';
  for (let i = 0; i < 8; i++) {
    const hasOpts = await page.evaluate(`(()=>{
      const sel = document.getElementById('id_rca_detail_root_cause');
      return sel && sel.options.length > 1;
    })()`);
    if (hasOpts) {
      detailResult = await setSelectById(page, 'id_rca_detail_root_cause', detailTarget);
      break;
    }
    await page.wait(1);
  }
  results.push(detailResult);

  // Resolution Summary
  const summaryText = opts.summary || '';
  if (summaryText) {
    const summarySet = await page.evaluate(`(()=>{
      const el = document.getElementById('id_rca_resolution_summary');
      if (!el) return 'summary: NOT FOUND';
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, ${JSON.stringify(summaryText)});
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return 'summary: ok';
    })()`);
    results.push(String(summarySet));
  }

  return results.join(', ');
}

async function submitCeUpdate(page: any, replyText: string, dryRun = false, statusValue = '', rcaOpts: { rca?: string; complexity?: string; summary?: string } = {}, crNum = ''): Promise<any> {
  const modal = await inspectCeUpdateModal(page);
  if (!modal?.visible || !modal?.save) {
    return { ok: false, stage: 'save-missing' };
  }
  if (modal.save.disabled) {
    return { ok: false, stage: 'save-disabled' };
  }

  // 读取 modal 里 case 当前状态（比传入的 statusValue 更准确）
  const currentStatus = await page.evaluate(`(()=>{
    const sel = document.getElementById('ID_STATUS_MASK_');
    if (!sel) return '';
    return (sel.options[sel.selectedIndex] || {}).text || '';
  })()`);

  // 合并判断：当前状态 或 即将设置的状态 是 Closed/Close Pending 都需要填 RCA
  const effectiveStatus = (statusValue || String(currentStatus)).toLowerCase();
  const needsRca = effectiveStatus.includes('closed-pending') ||
                   effectiveStatus.includes('close pending') ||
                   effectiveStatus === 'closed';

  let rcaFilled = '';
  if (crNum && needsRca) {
    rcaFilled = await fillRcaDefaults(page, rcaOpts);
    await page.wait(1);
  } else if (statusValue && needsRca) {
    // 只改状态没有 CR 时也填 RCA
    rcaFilled = await fillRcaDefaults(page, rcaOpts);
    await page.wait(1);
  }

  // 填 CR
  let crFilled = '';
  if (crNum) {
    crFilled = await fillCrField(page, crNum);
  }

  if (dryRun) {
    await page.wait(30);
    return { ok: true, stage: 'dry-run-paused', currentStatus: String(currentStatus), needsRca, rcaFilled, crFilled };
  }

  await tryNativeClick(page, modal.save, 12);
  const after = await inspectCeUpdateModal(page);
  if (!after?.visible) {
    return { ok: true, stage: 'posted', currentStatus: String(currentStatus), needsRca, rcaFilled, crFilled };
  }
  return { ok: false, stage: 'modal-still-open', modalText: after.modalText || '' };
}

async function confirmPosted(page: any, replyText: string): Promise<boolean> {
  const snippet = replyText.replace(/\s+/g, ' ').trim().slice(0, 80);
  const state = await inspectComposer(page);
  const bodyText = await page.evaluate(`(() => (document.body?.innerText || '').replace(/\\u200b/g, '').replace(/\\s+/g, ' ').trim())()`);
  const editorStillHasSnippet = !!state?.editor?.value && state.editor.value.includes(snippet);
  return !!snippet && String(bodyText || '').includes(snippet) && !editorStillHasSnippet;
}

cli({
  site: 'salesforce',
  name: 'case-reply',
  description: '向指定 Salesforce Case 的 Feed 发送回复（默认 preview，需加 --execute 才真正发送）',
  domain: 'qualcomm-cdmatech-support.lightning.force.com',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'id', type: 'str', required: true, positional: true, help: 'Case 编号，如 08420970' },
    { name: 'text', type: 'str', required: false, positional: true, help: '回复内容' },
    { name: 'file', type: 'str', required: false, positional: false, help: '从文件读取回复内容' },
    { name: 'subject', type: 'str',  required: false, positional: false, help: '更新 Case Subject 正文' },
    { name: 'prefix',  type: 'bool', required: false, positional: false, help: '自动补 [Chipset][Project] 前缀（可与 --subject 组合，或单独用于只补前缀）' },
    { name: 'status',  type: 'str',  required: false, positional: false, help: '同时更新 Case 状态，如 "Research-Internal Support"' },
    { name: 'execute', type: 'bool', required: false, positional: false, help: '真正发送回复；默认仅预览' },
    { name: 'dryrun', type: 'bool', required: false, positional: false, help: '填完字段后暂停30s不点Save，用于观察填写结果' },
    { name: 'cr', type: 'str', required: false, positional: false, help: '关联 Orbit CR 号，如 4511149（Close Pending 状态会自动先填 RCA）' },
    { name: 'rca',        type: 'str',  required: false, positional: false, help: 'Close Pending RCA快捷模式: pp(默认,post processing) | pa(picture adjustment) | qdcm' },
    { name: 'complexity', type: 'str',  required: false, positional: false, help: 'Complexity等级 1-5，Close Pending默认3' },
    { name: 'summary',    type: 'str',  required: false, positional: false, help: 'Resolution Summary 内容' },
  ],
  columns: ['status', 'case', 'message', 'text'],
  func: async (page, kwargs) => {
    if (!page) throw new CommandExecutionError('Browser session required for salesforce case-reply');

    const caseNum = String(kwargs.id || '').replace(/\D/g, '');
    const replyText = resolveReplyText(kwargs);
    const STATUS_ALIASES: Record<string, string> = {
      'cu':  'Customer Updated Case',
      'r':   'Research-Internal Support',
      'h':   'Hold-Customer Information Required',
      'cp':  'Closed-Pending Your Approval',
      'o':   'Open',
    };
    const VALID_STATUSES = [
      'Customer Updated Case',
      'Research-Internal Support',
      'Hold-Customer Information Required',
      'Hold-Pending Action Item',
      'Hold-Pending Change Request',
      'Hold-Pending Document Release',
      'Closed-Pending Your Approval',
      'Closed-Customer Requested',
      'Open',
      'New',
      'Closed',
      'Resolved',
      'Pending',
      'Answer Given-Awaiting Feedback',
      'Research-General',
      'Research-Replicating in Lab',
    ];
    const subjectRaw = String(kwargs.subject || '').trim();
    const wantPrefix = kwargs.prefix === true || subjectRaw.toLowerCase() === 'auto';
    // 'auto' alone means prefix-only (no text change), treat as empty subject
    const subjectValue = subjectRaw.toLowerCase() === 'auto' ? '' : subjectRaw;
    const rawStatus = String(kwargs.status || '').trim();
    let statusValue = rawStatus ? (STATUS_ALIASES[rawStatus.toLowerCase()] || rawStatus) : '';
    // Normalize statusValue to match VALID_STATUSES (case-insensitive)
    if (statusValue) {
      const matched = VALID_STATUSES.find(s => s.toLowerCase() === statusValue.toLowerCase());
      if (matched) {
        statusValue = matched;
      } else {
      const aliases = Object.entries(STATUS_ALIASES).map(([k, v]) => `  ${k} -> ${v}`).join('\n');
        throw new Error(`Unknown status: "${statusValue}"\nValid aliases:\n${aliases}\nFull list: ${VALID_STATUSES.join(', ')}`);
      }
    }
    if (!replyText && !statusValue && !subjectValue && !wantPrefix && !kwargs.cr) throw new Error('Provide reply text, --status, --subject, --prefix, or --cr (or any combination).');

    if (!kwargs.execute) {
      const parts = [];
      if (subjectValue || wantPrefix) parts.push(`subject -> "${wantPrefix ? '[prefix] ' : ''}${subjectValue.substring(0, 40)}"`);
      if (replyText) parts.push(`reply: "${replyText.substring(0, 60)}"`);
      if (statusValue) parts.push(`status -> "${statusValue}"`);
      return [{
        status: 'preview',
        case: caseNum,
        message: `Re-run with --execute to post. (${parts.join(', ')})`,
        text: replyText || '(no text)',
      }];
    }

    const caseUrl = await resolveCaseUrl(page, caseNum);
    await page.goto(caseUrl);
    await page.wait(8);
    await refreshMappingFromPage(page, caseNum);

    // Auto-prefix subject with [Chipset] [Project] if --subject is set but lacks the prefix
    // Auto-prefix subject with [Chipset] [Project] if --prefix is set
    // Auto-prefix subject with [Chipset] [Project] if --prefix is set
    // resolvedSubject will be finalized in setSubjectInModal if wantPrefix+isAuto
    let resolvedSubject = subjectValue;
    if (wantPrefix) {
      const isAuto = !subjectValue;
      // Read Subject/Chipset/Project from cases-internal list view (same logic as case.ts)
      const LIST_URL_INTERNAL_WP = `${SF_BASE}/lightning/o/Case/list?filterName=Copy_of_My_Open_Cases_Internal52`;
      await page.goto(LIST_URL_INTERNAL_WP);
      await page.wait(8);
      for (let r = 0; r < 10; r++) {
        const n = await page.evaluate(`(()=>{ if(!document.body) return 0; var t=document.body.innerText; return t.split('\t').filter(function(p){return /^\d{8}$/.test(p.trim());}).length; })()`);
        if ((n as number) >= 1) break;
        await page.wait(2);
      }
      const wpRaw = await page.evaluate(`(()=>{
        if (!document.body) return null;
        var text = document.body.innerText;
        var dataStart = text.lastIndexOf('Show Account Name column actions');
        if (dataStart === -1) dataStart = text.lastIndexOf('Account Name');
        var dataText = dataStart > -1 ? text.substring(dataStart) : text;
        var parts = dataText.split('\\t').map(function(s){ return s.trim(); }).filter(Boolean);
        var statusKeywords = ['Customer Updated Case','Research-Internal Support','Hold-Customer Information Required','Closed-Pending Your Approval','Open','New','Closed','Resolved','Pending'];
        var i = 0;
        while (i < parts.length) {
          if (/^\\d{8}$/.test(parts[i]) && parts[i] === ${JSON.stringify(caseNum)}) {
            var subjectRaw = (parts[i+2] || '').split('\\n')[0].trim();
            var showActionsIdx = -1;
            for (var s = i+3; s < Math.min(i+35, parts.length); s++) {
              if (parts[s].indexOf('Show Actions') === 0) { showActionsIdx = s; break; }
            }
            var chipset = '';
            if (showActionsIdx > 0) {
              var j = showActionsIdx - 1;
              var k = j - 2;
              if (/^\\d{5,}$/.test((parts[k] || '').trim())) k--;
              if (/^\\[/.test((parts[k] || '').trim()) || (parts[k] || '').trim().length > 30) k--;
              chipset = (parts[k] || '').split('\\n')[0].trim();
            }
            var chipM = subjectRaw.match(/^\\[([^\\]]+)\\]/);
            if (chipM && !chipset) chipset = chipM[1];
            return JSON.stringify({ subject: subjectRaw, chip: chipset, proj: parts[i+1] || '' });
          }
          i++;
        }
        return null;
      })()`);
      try {
        const lf = JSON.parse(String(wpRaw || 'null'));
        if (lf) {
          const chip = lf.chip || '';
          const proj = lf.proj || '';
          const prefix = [chip ? `[${chip}]` : '', proj ? `[${proj}]` : ''].filter(Boolean).join(' ');
          if (isAuto) {
            const bare = String(lf.subject || '').replace(/^(\[[^\]]+\]\s*)+/, '').trim();
            resolvedSubject = prefix ? `${prefix} ${bare}` : bare;
          } else if (prefix) {
            resolvedSubject = `${prefix} ${resolvedSubject}`;
          }
        }
      } catch {}
      // Navigate back to case page
      await page.goto(caseUrl);
      await page.wait(8);
    }

    let actualCaseNum: string | null = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      actualCaseNum = await page.evaluate(`(() => {
        const bodyText = document.body ? (document.body.innerText || '') : '';
        const wanted = ${JSON.stringify(caseNum)};
        const expectedId = ${JSON.stringify((caseUrl.match(/\/Case\/([^/]+)\/view/) || [])[1] || '')};
        if (new RegExp('\\\\b' + wanted + '\\\\b').test(bodyText)) return wanted;
        if (expectedId && String(location.href || '').includes(expectedId)) return null;
        const patterns = [
          /Case\\s+Number\\s*[:#]?\\s*(\\d{8})/i,
          /Case\\s*#\\s*(\\d{8})/i,
          /Case\\s*[:#]\\s*(\\d{8})/i,
        ];
        for (const pattern of patterns) {
          const match = bodyText.match(pattern);
          if (match) return match[1];
        }
        return null;
      })()`);
      if (actualCaseNum === caseNum) break;
      await page.wait(2);
    }
    if (actualCaseNum && actualCaseNum !== caseNum) {
      return [{
        status: 'failed',
        case: caseNum,
        message: `Opened wrong case (got ${actualCaseNum}, wanted ${caseNum}).`,
        text: replyText,
      }];
    }

    await page.evaluate(`(() => {
      const norm = (value) => (value || '').replace(/\\u200b/g, '').replace(/\\s+/g, ' ').trim();
      const labels = new Set(['Chatter', 'Feed']);
      const nodes = Array.from(document.querySelectorAll('a, button, [role="tab"], span'));
      for (const node of nodes) {
        const text = norm(node.innerText || node.textContent || '');
        if (!labels.has(text)) continue;
        node.click();
        return text;
      }
      return null;
    })()`);
    await page.wait(1.2);

    // EasyWork shortcut: pressing "u" opens the CE Update modal. Keep it as the primary path.
    let ceUpdateModal = await openCeUpdateModal(page);
    if (!ceUpdateModal?.visible) {
      // Fallback to the original direct EasyWork button click if the shortcut did not open it.
      await page.evaluate(`(() => {
        const btn = document.querySelector('a.ew_ceupdate_button, .ew_ceupdate_button');
        if (btn) { btn.click(); return true; }
        return false;
      })()`);
      ceUpdateModal = await waitForCeUpdateModalAfterTrigger(page);
    }

    if (ceUpdateModal?.visible) {
      // Insert reply text (skip if text is empty - status-only update)
      if (replyText) {
        const inserted = await insertCeUpdateText(page, replyText);
        if (!inserted?.ok) {
          const details = [
            inserted?.stage ? `stage=${inserted.stage}` : '',
            inserted?.nativeValue !== undefined ? `native="${inserted.nativeValue}"` : '',
            inserted?.value !== undefined ? `value="${inserted.value}"` : '',
          ].filter(Boolean).join(' ');
          return [{
            status: 'failed',
            case: caseNum,
            message: `CE Update editor verification failed.${details ? ' ' + details : ''}`,
            text: replyText,
          }];
        }
      }

      // Set subject if requested
      if (resolvedSubject) {
        const subjectSet = await setSubjectInModal(page, resolvedSubject);
        if (!subjectSet) {
          return [{
            status: 'failed',
            case: caseNum,
            message: 'Subject field not found in CE Update modal.',
            text: replyText,
          }];
        }
      }

      // Set status if requested
      if (statusValue) {
        const statusSet = await setStatusInModal(page, statusValue);
        if (!statusSet) {
          return [{
            status: 'failed',
            case: caseNum,
            message: `Status "${statusValue}" not found in dropdown. Check the exact status name.`,
            text: replyText,
          }];
        }
      }

      const submitResult = await submitCeUpdate(page, replyText, !!kwargs.dryrun, statusValue, { rca: String(kwargs.rca||''), complexity: String(kwargs.complexity||''), summary: String(kwargs.summary||'') }, String(kwargs.cr||'').replace(/\D/g,''));
      if (!submitResult?.ok) {
        const details = [
          submitResult?.stage ? `stage=${submitResult.stage}` : '',
          submitResult?.modalText ? `modal="${String(submitResult.modalText).slice(0, 220)}"` : '',
        ].filter(Boolean).join(' ');
        return [{
          status: 'failed',
          case: caseNum,
          message: `CE Update save not confirmed.${details ? ' ' + details : ''}`,
          text: replyText,
        }];
      }

      const successParts = [];
      if (resolvedSubject) successParts.push(`subject updated to "${resolvedSubject.substring(0,50)}"`);
      if (replyText) successParts.push('reply posted');
      if (statusValue) successParts.push(`status set to "${statusValue}"`);
      return [{
        status: 'success',
        case: caseNum,
        message: successParts.join(', ') + '.',
        text: replyText || '(status only)',
      }];
    }

    return [{
      status: 'failed',
      case: caseNum,
      message: 'CE Update modal did not open.',
      text: replyText,
    }];
  },
});

