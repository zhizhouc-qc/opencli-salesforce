import { cli, Strategy } from '@jackwener/opencli/registry';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fetch as undiciFetch, Agent } from 'file:///C:/Users/zhizhouc/AppData/Roaming/npm/node_modules/@jackwener/opencli/node_modules/undici/index.js';

const SF_BASE = 'https://qualcomm-cdmatech-support.lightning.force.com';
const LIST_URL = `${SF_BASE}/lightning/o/Case/list?filterName=Copy_of_My_Open_Cases_Internal52`;
const MAPPING_FILE = 'C:/Users/zhizhouc/Documents/sf_case_id_mapping.json';

const SKIP_STATUSES = ['Closed', 'Closed-Pending Your Approval', 'Closed-Customer Requested', 'Resolved'];

function loadMapping(): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(MAPPING_FILE, 'utf-8')); } catch { return {}; }
}
function saveMapping(m: Record<string, string>) {
  try { fs.writeFileSync(MAPPING_FILE, JSON.stringify(m, null, 2)); } catch {}
}

function getApiKey(): string {
  let key = process.env.QGENIE_API_KEY || '';
  if (!key) {
    try {
      const cfg = fs.readFileSync(path.join(os.homedir(), 'AppData', 'Roaming', 'qgenie-cli', 'config.toml'), 'utf-8');
      const m = cfg.match(/api_key\s*=\s*["']([^"']+)["']/);
      if (m) key = m[1];
    } catch {}
  }
  return key;
}

async function askAI(prompt: string): Promise<string> {
  const apiKey = getApiKey();
  const bodyObj = { model: 'anthropic::claude-4-6-sonnet', messages: [{ role: 'user', content: prompt }], max_tokens: 300, stream: true };
  const agent = new Agent({ connect: { rejectUnauthorized: false } });
  const endpoints = ['https://qgenie-api.qualcomm.com/v1/chat/completions', 'https://qpilot-api.qualcomm.com/v1/chat/completions'];
  let lastErr = '';
  for (const url of endpoints) {
    try {
      const res = await undiciFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey }, body: JSON.stringify(bodyObj), dispatcher: agent } as any);
      if (!res.ok) { lastErr = 'HTTP ' + res.status; continue; }
      const text = await res.text();
      let fullText = '';
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;
        try { const j = JSON.parse(data); const delta = j?.choices?.[0]?.delta?.content; if (delta) fullText += delta; } catch {}
      }
      if (fullText.trim()) return fullText.trim();
      lastErr = 'empty response';
    } catch (e: any) { lastErr = e?.message || String(e); }
  }
  throw new Error(lastErr || 'all endpoints failed');
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
    const modals = Array.from(document.querySelectorAll('.swal2-popup, .swal2-container.ceupdate-container, .swal2-container'))
      .filter((el) => isRenderable(el) && /case\\s+\\d+|ce update|latest qualcomm progress update/i.test(norm(el.innerText || el.textContent || '')));
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

async function fetchCaseFields(
  page: any, caseNum: string, sfId: string
): Promise<{ fields: Record<string,string>; feed: any[]; feedSummary: string }> {
    await page.goto(`${SF_BASE}/lightning/r/Case/${sfId}/view`);
    await page.wait(8);
    for (let i = 0; i < 10; i++) {
      const found = await page.evaluate(`(()=>{ return (document.body ? document.body.innerText : '').includes('${caseNum}'); })()`);
      if (found) break;
      await page.wait(2);
    }

    // 2. 点击 Details tab，等待字段加载
    await page.evaluate(`(()=>{
      for (const el of document.querySelectorAll('a,button,[role="tab"],span')) {
        const t = (el.innerText||el.textContent||'').trim();
        if ((t === 'Details' || t === 'Detail') && el.offsetParent !== null) { el.click(); break; }
      }
    })()`);
    await page.wait(3);

    // 3. 用 case.ts 相同的完整字段抓取逻辑读取字段
    const detailsRaw = await page.evaluate(`(() => {
      const LABELS = [
        'Case Number', 'Subject', 'Status', 'Priority', 'Description', 'Chipset',
        'Account Name', 'Customer Project', 'Problem Area', 'Case Owner',
        'TAM', 'Severity', 'Contact Name', 'Category', 'Sub Area',
        'Latest Qualcomm Progress Update', 'Problem Area 3', 'Date/Time Opened'
      ];
      const LABEL_SET = new Set(LABELS);
      const MONTH_RE = /(January|February|March|April|May|June|July|August|September|October|November|December)\\s+\\d{1,2},\\s+\\d{4}\\s+at\\s+\\d{1,2}:\\d{2}\\s+[AP]M/i;
      const norm = (value) => (value || '').replace(/\\u200b/g, '').replace(/\\s+/g, ' ').trim();
      const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
      const allRoots = [];
      const walk = (root) => {
        if (!root || allRoots.includes(root)) return;
        allRoots.push(root);
        const nodes = root.querySelectorAll ? root.querySelectorAll('*') : [];
        for (const node of nodes) {
          if (node.shadowRoot) walk(node.shadowRoot);
        }
      };
      const queryAllDeep = (selector) => {
        const out = [];
        for (const root of allRoots) {
          if (!root.querySelectorAll) continue;
          out.push(...Array.from(root.querySelectorAll(selector)));
        }
        return out;
      };
      const clickTab = (labels) => {
        for (const root of allRoots) {
          if (!root.querySelectorAll) continue;
          const candidates = Array.from(root.querySelectorAll('a, button, [role="tab"], span'));
          for (const el of candidates) {
            const text = norm(el.innerText || el.textContent || '');
            if (!visible(el)) continue;
            if (!labels.includes(text)) continue;
            el.click();
            return text;
          }
        }
        return null;
      };
      const expandButtons = (patterns, limit) => {
        let clicked = 0;
        for (const root of allRoots) {
          if (!root.querySelectorAll) continue;
          const candidates = Array.from(root.querySelectorAll('button, a, span[role="button"]'));
          for (const el of candidates) {
            const text = norm(el.innerText || el.textContent || '');
            if (!visible(el)) continue;
            if (!text) continue;
            if (!patterns.some((pattern) => pattern.test(text))) continue;
            el.click();
            clicked += 1;
            if (clicked >= limit) return clicked;
          }
        }
        return clicked;
      };
      const extractSubject = (lines) => {
        for (const line of lines) {
          if (!line) continue;
          if (/^\\d{8}\\s*\\[/.test(line)) return line.replace(/^\\d{8}\\s*/, '').trim();
        }
        for (const line of lines) {
          if (!line) continue;
          if (line.includes('[') && line.length > 8 && !LABEL_SET.has(line)) return line.replace(/^\\d{8}\\s*/, '').trim();
        }
        return '';
      };
      const readField = (lines, label) => {
        for (let i = 0; i < lines.length; i++) {
          if (lines[i] !== label) continue;
          const values = [];
          for (let j = i + 1; j < lines.length; j++) {
            const value = lines[j];
            if (!value) continue;
            if (LABEL_SET.has(value)) break;
            if (MONTH_RE.test(value) && label === 'Description') break;
            if (/^(Feed|Related|Chatter|Activity|Details)$/.test(value)) break;
            values.push(value);
            if (label !== 'Description') break;
            if (values.length >= 12) break;
          }
          if (values.length > 0) return values.join('\\n');
        }
        return '';
      };
      const parseFeedArticles = (articles) => {
        const items = [];
        const seen = new Set();
        for (const article of articles) {
          if (!visible(article)) continue;
          const lines = (article.innerText || '')
            .split('\\n')
            .map((line) => norm(line))
            .filter(Boolean)
            .filter((line) => !/^(Click to (collapse|expand) post|Actions for this Feed Item|Like|Comment|CE Update|Share|Edit|Delete)$/i.test(line))
            .filter((line) => !/Actions for this Feed Item/i.test(line))
            .filter((line) => !/^Comment on .* at \\d{4}-\\d{2}-\\d{2}T/.test(line))
            .filter((line) => !/^Show actions for /i.test(line));
          if (lines.length === 0) continue;
          const raw = norm(article.innerText || '');
          let author = '';
          let timestamp = '';
          let bodyStart = 0;
          for (let i = 0; i < lines.length; i++) {
            if (MONTH_RE.test(lines[i])) {
              timestamp = lines[i];
              author = norm(lines.slice(0, i).join(' ')).replace(/^Click to (collapse|expand) post\\s*/i, '');
              bodyStart = i + 1;
              break;
            }
          }
          if (!timestamp) {
            const tsMatch = raw.match(MONTH_RE);
            if (tsMatch) timestamp = tsMatch[0];
          }
          if (!author && lines.length > 0) author = lines[0].replace(/^Click to (collapse|expand) post\\s*/i, '');
          const body = lines
            .slice(bodyStart)
            .filter((line) => !/^To:\\s*/.test(line))
            .join('\\n')
            .replace(/\\n{3,}/g, '\\n\\n')
            .trim();
          if (/CE Activity Tracker/i.test(author || raw) && !timestamp) continue;
          if (!author && !body && !raw) continue;
          const dedupeKey = [author, timestamp, body || raw].join('|');
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          items.push({
            author,
            timestamp,
            body: body || raw,
            raw,
          });
          if (items.length >= 8) break;
        }
        return items;
      };

      walk(document);
      const initialFeed = parseFeedArticles(queryAllDeep('article'));
      const initialArticleRaw = queryAllDeep('article')
        .map((article) => norm(article.innerText || ''))
        .filter((text) => text.length > 20)
        .filter((text) => MONTH_RE.test(text) || /Actions for this Feed Item|Click to (collapse|expand) post/i.test(text))
        .slice(0, 5);
      clickTab(['Details', 'Detail']);
      expandButtons([/show more/i, /view more/i, /more details/i], 8);

      const bodyText = document.body.innerText || '';
      const lines = bodyText
        .split('\\n')
        .map((line) => norm(line))
        .filter(Boolean);

      const fields = {};
      fields['Case Number'] = (${JSON.stringify(caseNum)});
      fields['Subject'] = extractSubject(lines);
      for (const label of LABELS) {
        if (label === 'Case Number' || label === 'Subject') continue;
        const value = readField(lines, label);
        if (value) fields[label] = value;
      }

      const fieldContainers = queryAllDeep('records-record-layout-item, .slds-form-element, lightning-output-field, .forceOutputFieldText, .field-container');
      for (const container of fieldContainers) {
        if (!visible(container)) continue;
        const text = (container.innerText || '').split('\\n').map((line) => norm(line)).filter(Boolean);
        if (text.length < 2) continue;
        const label = text[0];
        if (!LABEL_SET.has(label)) continue;
        const value = text.slice(1).join('\\n');
        if (value && (!fields[label] || label === 'Description')) fields[label] = value;
      }

      if (fields['Description']) {
        fields['Description'] = fields['Description'].replace(/\\n?Edit Description$/i, '').trim();
      }
      // Remove tooltip artifacts: values like "Help <FieldName>" or value equals label
      for (const lbl of LABELS) {
        if (!fields[lbl]) continue;
        const v = String(fields[lbl]);
        if (v === lbl || v === 'Help ' + lbl || (/^Help\\s+/i.test(v) && v.length < lbl.length + 10)) {
          delete fields[lbl];
        }
      }
      if (!fields['Priority'] || (/priority/i.test(fields['Priority']) && !/^\\d\\s*-/.test(fields['Priority']))) {
        const priMatch = bodyText.match(/\\b([1-4]\\s*-\\s*(Critical|High|Medium|Low))\\b/i);
        if (priMatch) fields['Priority'] = priMatch[1];
      }
      if (fields['Priority'] && /priority/i.test(fields['Priority']) && !/^\\d\\s*-/.test(fields['Priority'])) {
        delete fields['Priority'];
      }

      const detailFeed = parseFeedArticles(queryAllDeep('article'));

      clickTab(['Chatter', 'Feed']);
      expandButtons([/show more/i, /view more/i, /more comments/i, /more/i], 12);
      const tabFeed = parseFeedArticles(queryAllDeep('article'));
      const feedCandidates = [initialFeed, detailFeed, tabFeed].sort((a, b) => b.length - a.length);
      let feed = feedCandidates[0] || [];
      if (feed.length === 0 && initialArticleRaw.length > 0) {
        feed = initialArticleRaw.map((raw) => ({ author: '', timestamp: '', body: raw, raw }));
      }

      return JSON.stringify({ fields, feed });
    })()`);

    let parsed: any;
    try { parsed = JSON.parse(String(detailsRaw)); } catch {
      return results;
    }

    const fields = parsed.fields || {};
    const feed: Array<any> = Array.isArray(parsed.feed) ? parsed.feed : [];

    const subject      = fields['Subject'] || '';
    const chipset      = fields['Chipset'] || '';
    const pa3          = fields['Problem Area 3'] || '';
    const description  = fields['Description'] || '';
    const latestUpdate = fields['Latest Qualcomm Progress Update'] || '';
  const feedSummary = feed.slice(0, 5).map((f: any) => f.body || '').filter(Boolean).join(' | ');
  return { fields, feed, feedSummary };
}

async function writeSummary(page: any, caseNum: string, sfId: string, summary: string, crToAppend: string, kwargs: any): Promise<string> {
  await page.goto(`${SF_BASE}/lightning/r/Case/${sfId}/view`);
  await page.wait(10);
  for (let i = 0; i < 15; i++) {
    const found = await page.evaluate(`(()=>{ return (document.body ? document.body.innerText : '').includes('${caseNum}'); })()`);
    if (found) break;
    await page.wait(2);
  }
  // 确保没有残留 modal
  await page.evaluate(`(()=>{ const m = document.querySelector('.swal2-popup'); if(m) m.remove(); })()`);
  await page.wait(1);

  // 按 u 打开 CE Update
  if (page.nativeClick) { try { await page.nativeClick(960, 500); } catch {} await page.wait(0.5); }
  if (page.nativeKeyPress) { try { await page.nativeKeyPress('u'); } catch {} await page.wait(6); }

  // 如果当前不是 Closed 状态，设置为 Closed-Pending Your Approval
  await page.evaluate(`(()=>{
    const sel = document.getElementById('ID_STATUS_MASK_');
    if (!sel) return;
    const cur = sel.options[sel.selectedIndex]?.text || '';
    if (/^Closed/i.test(cur)) return;
    for (const opt of sel.options) {
      if (opt.text.includes('Closed-Pending')) {
        sel.value = opt.value;
        ['focus','input','change','blur'].forEach(ev => sel.dispatchEvent(new Event(ev, {bubbles:true})));
        return;
      }
    }
  })()`);
  await page.wait(2);

  // Complexity
  const complexityMap: Record<string, string> = { '1':'1 - Easy','2':'2 - Non-Trivial','3':'3 - Medium','4':'4 - High','5':'5 - Very High' };
  const complexityTarget = complexityMap[String(kwargs.complexity || '3')] || '3 - Medium';
  await page.evaluate(`(()=>{
    const sel = document.getElementById('ID_CASE_COMPLEXITY_MASK_');
    if (!sel) return;
    for (const opt of sel.options) {
      if (opt.text.includes(${JSON.stringify(complexityTarget)})) {
        sel.value = opt.value;
        ['input','change'].forEach(ev => sel.dispatchEvent(new Event(ev,{bubbles:true})));
        return;
      }
    }
  })()`);

  // RCA cascade
  const rcaPresets: Record<string, string> = { pa: 'Picture Adjustment', pp: 'Post Processing Algorithms', qdcm: 'QDCM' };
  const detailTarget = rcaPresets[String(kwargs.rca || 'pp').toLowerCase()] || rcaPresets['pp'];
  for (const [selId, val] of [['id_rca_team','Multimedia'],['id_rca_sub_team','Display'],['id_rca_main_root_cause','System KPI']] as [string,string][]) {
    await page.evaluate(`(()=>{
      const sel = document.getElementById(${JSON.stringify(selId)});
      if (!sel) return;
      for (const opt of sel.options) {
        if (opt.text.includes(${JSON.stringify(val)})) { sel.value = opt.value; ['input','change'].forEach(ev => sel.dispatchEvent(new Event(ev,{bubbles:true}))); return; }
      }
    })()`);
    await page.wait(1);
  }
  await page.wait(2);
  await page.evaluate(`(()=>{
    const sel = document.getElementById('id_rca_detail_root_cause');
    if (!sel) return;
    for (const opt of sel.options) {
      if (opt.text.includes(${JSON.stringify(detailTarget)})) { sel.value = opt.value; ['input','change'].forEach(ev => sel.dispatchEvent(new Event(ev,{bubbles:true}))); return; }
    }
  })()`);

  // Resolution Summary
  await page.evaluate(`(()=>{
    const el = document.getElementById('id_rca_resolution_summary');
    if (!el) return;
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;
    setter.call(el, ${JSON.stringify(summary)});
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);

  // CR field
  if (crToAppend) {
    const crCoords = await page.evaluate(`(()=>{
      const inp = document.getElementById('id_cr_list');
      if (!inp) return null;
      const rect = inp.getBoundingClientRect();
      return rect.width > 0 ? JSON.stringify({x:Math.round(rect.left+rect.width/2),y:Math.round(rect.top+rect.height/2)}) : null;
    })()`);
    if (crCoords) {
      const c = JSON.parse(String(crCoords));
      if (page.nativeClick) { try { await page.nativeClick(c.x, c.y); } catch {} await page.wait(0.3); }
      if (page.nativeType)  { try { await page.nativeType(crToAppend); } catch {} }
    }
  }

  // Save：直接点 .swal2-confirm
  await page.evaluate(`(()=>{
    const norm = v => (v||'').replace(/\u200b/g,'').replace(/\s+/g,' ').trim();
    const btn = document.querySelector('.swal2-confirm') ||
      Array.from(document.querySelectorAll('button')).find(b => norm(b.innerText||b.textContent||'') === 'Save');
    if (btn) btn.click();
  })()`);
  await page.wait(8);

  const modalGone = await page.evaluate(`(()=>{ return document.querySelectorAll('.swal2-popup').length === 0; })()`);
  return modalGone ? 'done' : 'save-failed';
}

async function getHolidayName(): Promise<string> {
  const today = new Date();
  const prompt = (
    `Today is ${today.toISOString().slice(0,10)}. ` +
    `What is the upcoming or current Chinese public holiday (within the next 7 days)? ` +
    `Reply with ONLY the holiday name in English, e.g. "Labor Day", "National Day", "Spring Festival". ` +
    `If no holiday is upcoming, reply "holiday".`
  );
  try {
    const name = await askAI(prompt);
    return name.replace(/['".,*]/g, '').trim() || 'holiday';
  } catch {
    return 'holiday';
  }
}

function buildComment(holidayName: string): string {
  return (
    `Due to the ${holidayName} holiday, we will need to close this case for now.\n` +
    `If you have any further questions or the issue persists, please feel free to submit a new case after the holiday and we will be happy to help with further analysis.\n` +
    `Wishing you a happy holiday, and thank you very much for your understanding.`
  );
}

async function replyCase(page: any, caseNum: string, sfId: string, comment: string): Promise<string> {
  await page.goto(`${SF_BASE}/lightning/r/Case/${sfId}/view`);
  await page.wait(8);
  for (let i = 0; i < 10; i++) {
    const found = await page.evaluate(`(()=>{ return (document.body ? document.body.innerText : '').includes('${caseNum}'); })()`);
    if (found) break;
    await page.wait(2);
  }

  // 打开 CE Update modal
  await page.evaluate(`(() => {
    const btn = document.querySelector('a.ew_ceupdate_button, .ew_ceupdate_button');
    if (btn) { btn.click(); }
  })()`);
  await page.wait(3);

  let ceModal = await inspectCeUpdateModal(page);
  if (!ceModal?.visible) {
    await page.evaluate(`(() => {
      const btn = document.querySelector('a.ew_ceupdate_button, .ew_ceupdate_button');
      if (btn) { btn.click(); }
    })()`);
    await page.wait(2);
    ceModal = await inspectCeUpdateModal(page);
  }
  if (!ceModal?.visible) return 'modal-not-found';

  const inserted = await insertCeUpdateText(page, comment);
  if (!inserted?.ok) return `insert-failed: stage=${inserted?.stage}`;

  const submitted = await submitCeUpdate(page, comment, false, '', { rca: '', complexity: '', summary: '' }, '');
  if (!submitted?.ok) return `submit-failed: stage=${submitted?.stage}`;

  return 'replied';
}

async function runCaseCloseAI(
  page: any, caseNum: string, sfId: string, kwargs: any
): Promise<string> {
  const results: Array<{ step: string; status: string }> = [];

  // 打开 case 页面，等待加载
  await page.goto(`${SF_BASE}/lightning/r/Case/${sfId}/view`);
  await page.wait(8);
  for (let i = 0; i < 10; i++) {
    const found = await page.evaluate(`(()=>{ return (document.body ? document.body.innerText : '').includes('${caseNum}'); })()`);
    if (found) break;
    await page.wait(2);
  }

  // 2. 点击 Details tab，等待字段加载
  await page.evaluate(`(()=>{
    for (const el of document.querySelectorAll('a,button,[role="tab"],span')) {
      const t = (el.innerText||el.textContent||'').trim();
      if ((t === 'Details' || t === 'Detail') && el.offsetParent !== null) { el.click(); break; }
    }
  })()`);
  await page.wait(3);

  // 3. 用 case.ts 相同的完整字段抓取逻辑读取字段
  const detailsRaw = await page.evaluate(`(() => {
    const LABELS = [
      'Case Number', 'Subject', 'Status', 'Priority', 'Description', 'Chipset',
      'Account Name', 'Customer Project', 'Problem Area', 'Case Owner',
      'TAM', 'Severity', 'Contact Name', 'Category', 'Sub Area',
      'Latest Qualcomm Progress Update', 'Problem Area 3', 'Date/Time Opened'
    ];
    const LABEL_SET = new Set(LABELS);
    const MONTH_RE = /(January|February|March|April|May|June|July|August|September|October|November|December)\\s+\\d{1,2},\\s+\\d{4}\\s+at\\s+\\d{1,2}:\\d{2}\\s+[AP]M/i;
    const norm = (value) => (value || '').replace(/\\u200b/g, '').replace(/\\s+/g, ' ').trim();
    const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
    const allRoots = [];
    const walk = (root) => {
      if (!root || allRoots.includes(root)) return;
      allRoots.push(root);
      const nodes = root.querySelectorAll ? root.querySelectorAll('*') : [];
      for (const node of nodes) {
        if (node.shadowRoot) walk(node.shadowRoot);
      }
    };
    const queryAllDeep = (selector) => {
      const out = [];
      for (const root of allRoots) {
        if (!root.querySelectorAll) continue;
        out.push(...Array.from(root.querySelectorAll(selector)));
      }
      return out;
    };
    const clickTab = (labels) => {
      for (const root of allRoots) {
        if (!root.querySelectorAll) continue;
        const candidates = Array.from(root.querySelectorAll('a, button, [role="tab"], span'));
        for (const el of candidates) {
          const text = norm(el.innerText || el.textContent || '');
          if (!visible(el)) continue;
          if (!labels.includes(text)) continue;
          el.click();
          return text;
        }
      }
      return null;
    };
    const expandButtons = (patterns, limit) => {
      let clicked = 0;
      for (const root of allRoots) {
        if (!root.querySelectorAll) continue;
        const candidates = Array.from(root.querySelectorAll('button, a, span[role="button"]'));
        for (const el of candidates) {
          const text = norm(el.innerText || el.textContent || '');
          if (!visible(el)) continue;
          if (!text) continue;
          if (!patterns.some((pattern) => pattern.test(text))) continue;
          el.click();
          clicked += 1;
          if (clicked >= limit) return clicked;
        }
      }
      return clicked;
    };
    const extractSubject = (lines) => {
      for (const line of lines) {
        if (!line) continue;
        if (/^\\d{8}\\s*\\[/.test(line)) return line.replace(/^\\d{8}\\s*/, '').trim();
      }
      for (const line of lines) {
        if (!line) continue;
        if (line.includes('[') && line.length > 8 && !LABEL_SET.has(line)) return line.replace(/^\\d{8}\\s*/, '').trim();
      }
      return '';
    };
    const readField = (lines, label) => {
      for (let i = 0; i < lines.length; i++) {
        if (lines[i] !== label) continue;
        const values = [];
        for (let j = i + 1; j < lines.length; j++) {
          const value = lines[j];
          if (!value) continue;
          if (LABEL_SET.has(value)) break;
          if (MONTH_RE.test(value) && label === 'Description') break;
          if (/^(Feed|Related|Chatter|Activity|Details)$/.test(value)) break;
          values.push(value);
          if (label !== 'Description') break;
          if (values.length >= 12) break;
        }
        if (values.length > 0) return values.join('\\n');
      }
      return '';
    };
    const parseFeedArticles = (articles) => {
      const items = [];
      const seen = new Set();
      for (const article of articles) {
        if (!visible(article)) continue;
        const lines = (article.innerText || '')
          .split('\\n')
          .map((line) => norm(line))
          .filter(Boolean)
          .filter((line) => !/^(Click to (collapse|expand) post|Actions for this Feed Item|Like|Comment|CE Update|Share|Edit|Delete)$/i.test(line))
          .filter((line) => !/Actions for this Feed Item/i.test(line))
          .filter((line) => !/^Comment on .* at \\d{4}-\\d{2}-\\d{2}T/.test(line))
          .filter((line) => !/^Show actions for /i.test(line));
        if (lines.length === 0) continue;
        const raw = norm(article.innerText || '');
        let author = '';
        let timestamp = '';
        let bodyStart = 0;
        for (let i = 0; i < lines.length; i++) {
          if (MONTH_RE.test(lines[i])) {
            timestamp = lines[i];
            author = norm(lines.slice(0, i).join(' ')).replace(/^Click to (collapse|expand) post\\s*/i, '');
            bodyStart = i + 1;
            break;
          }
        }
        if (!timestamp) {
          const tsMatch = raw.match(MONTH_RE);
          if (tsMatch) timestamp = tsMatch[0];
        }
        if (!author && lines.length > 0) author = lines[0].replace(/^Click to (collapse|expand) post\\s*/i, '');
        const body = lines
          .slice(bodyStart)
          .filter((line) => !/^To:\\s*/.test(line))
          .join('\\n')
          .replace(/\\n{3,}/g, '\\n\\n')
          .trim();
        if (/CE Activity Tracker/i.test(author || raw) && !timestamp) continue;
        if (!author && !body && !raw) continue;
        const dedupeKey = [author, timestamp, body || raw].join('|');
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        items.push({
          author,
          timestamp,
          body: body || raw,
          raw,
        });
        if (items.length >= 8) break;
      }
      return items;
    };

    walk(document);
    const initialFeed = parseFeedArticles(queryAllDeep('article'));
    const initialArticleRaw = queryAllDeep('article')
      .map((article) => norm(article.innerText || ''))
      .filter((text) => text.length > 20)
      .filter((text) => MONTH_RE.test(text) || /Actions for this Feed Item|Click to (collapse|expand) post/i.test(text))
      .slice(0, 5);
    clickTab(['Details', 'Detail']);
    expandButtons([/show more/i, /view more/i, /more details/i], 8);

    const bodyText = document.body.innerText || '';
    const lines = bodyText
      .split('\\n')
      .map((line) => norm(line))
      .filter(Boolean);

    const fields = {};
    fields['Case Number'] = (${JSON.stringify(caseNum)});
    fields['Subject'] = extractSubject(lines);
    for (const label of LABELS) {
      if (label === 'Case Number' || label === 'Subject') continue;
      const value = readField(lines, label);
      if (value) fields[label] = value;
    }

    const fieldContainers = queryAllDeep('records-record-layout-item, .slds-form-element, lightning-output-field, .forceOutputFieldText, .field-container');
    for (const container of fieldContainers) {
      if (!visible(container)) continue;
      const text = (container.innerText || '').split('\\n').map((line) => norm(line)).filter(Boolean);
      if (text.length < 2) continue;
      const label = text[0];
      if (!LABEL_SET.has(label)) continue;
      const value = text.slice(1).join('\\n');
      if (value && (!fields[label] || label === 'Description')) fields[label] = value;
    }

    if (fields['Description']) {
      fields['Description'] = fields['Description'].replace(/\\n?Edit Description$/i, '').trim();
    }
    // Remove tooltip artifacts: values like "Help <FieldName>" or value equals label
    for (const lbl of LABELS) {
      if (!fields[lbl]) continue;
      const v = String(fields[lbl]);
      if (v === lbl || v === 'Help ' + lbl || (/^Help\\s+/i.test(v) && v.length < lbl.length + 10)) {
        delete fields[lbl];
      }
    }
    if (!fields['Priority'] || (/priority/i.test(fields['Priority']) && !/^\\d\\s*-/.test(fields['Priority']))) {
      const priMatch = bodyText.match(/\\b([1-4]\\s*-\\s*(Critical|High|Medium|Low))\\b/i);
      if (priMatch) fields['Priority'] = priMatch[1];
    }
    if (fields['Priority'] && /priority/i.test(fields['Priority']) && !/^\\d\\s*-/.test(fields['Priority'])) {
      delete fields['Priority'];
    }

    const detailFeed = parseFeedArticles(queryAllDeep('article'));

    clickTab(['Chatter', 'Feed']);
    expandButtons([/show more/i, /view more/i, /more comments/i, /more/i], 12);
    const tabFeed = parseFeedArticles(queryAllDeep('article'));
    const feedCandidates = [initialFeed, detailFeed, tabFeed].sort((a, b) => b.length - a.length);
    let feed = feedCandidates[0] || [];
    if (feed.length === 0 && initialArticleRaw.length > 0) {
      feed = initialArticleRaw.map((raw) => ({ author: '', timestamp: '', body: raw, raw }));
    }

    return JSON.stringify({ fields, feed });
  })()`);

  let parsed: any;
  try { parsed = JSON.parse(String(detailsRaw)); } catch {
    results.push({ step: 'fetch case info', status: 'FAILED – parse error: ' + String(detailsRaw).slice(0, 100) });
    return results;
  }

  const fields = parsed.fields || {};
  const feed: Array<any> = Array.isArray(parsed.feed) ? parsed.feed : [];

  const subject      = fields['Subject'] || '';
  const chipset      = fields['Chipset'] || '';
  const pa3          = fields['Problem Area 3'] || '';
  const description  = fields['Description'] || '';
  const latestUpdate = fields['Latest Qualcomm Progress Update'] || '';
  const feedSummary  = feed.slice(0, 3).map((f: any) => f.body || '').filter(Boolean).join(' | ');

  results.push({ step: 'fetch case info', status: 'ok – ' + (subject || '(no subject)').substring(0, 60) });

  // 从字段里提取 CR 号
  const crInCase = (() => {
    const allText = [description, latestUpdate, fields['Related CRs'] || '', feedSummary].join(' ');
    const m = allText.match(/\bCR\s*(\d{6,8})\b/i);
    return m ? m[1] : '';
  })();

  // 3. 调 AI 生成 summary
  const prompt = [
    'Write a single concise sentence describing how this Qualcomm support case was resolved.',
    'Focus on the solution/fix, not the root cause. Do NOT include the CR number.',
    'Output only the sentence, no extra explanation.',
    '',
    'Subject: ' + subject,
    'Chipset: ' + chipset,
    'Description: ' + description.substring(0, 300),
    'Resolution: ' + (latestUpdate || feedSummary).substring(0, 400),
  ].join('\n');

  let summary = '';
  try {
    summary = await askAI(prompt);
  } catch (e: any) {
    results.push({ step: 'call AI', status: 'FAILED – ' + (e?.message || String(e)) });
    return results;
  }
  summary = summary.replace(/^["']|["']$/g, '').trim();
  if (!summary) {
    results.push({ step: 'call AI', status: 'FAILED – empty response' });
    return results;
  }

  // CR 号单独附在末尾
  const crToAppend = String(kwargs.cr || '').replace(/\D/g, '') || crInCase;
  summary = summary.replace(/\.?\s*$/, '.');
  if (crToAppend) summary += ' Related CR: ' + crToAppend;
  results.push({ step: 'call AI', status: 'ok: "' + summary.substring(0, 100) + (summary.length > 100 ? '...' : '') + '"' });

  // 4. 预览模式
  if (!kwargs.execute) {
    results.push({ step: 'preview', status: 'Add --execute to close. Full summary: ' + summary });
    return results;
  }

  // 5. 执行关闭：按 u 打开 CE Update
  if (page.nativeClick) { try { await page.nativeClick(960, 500); } catch {} await page.wait(0.5); }
  if (page.nativeKeyPress) { try { await page.nativeKeyPress('u'); } catch {} await page.wait(5); }

  // 如果当前不是 Closed 状态，设置为 Closed-Pending Your Approval
  await page.evaluate(`(()=>{
    const sel = document.getElementById('ID_STATUS_MASK_');
    if (!sel) return;
    const cur = sel.options[sel.selectedIndex]?.text || '';
    if (/^Closed/i.test(cur)) return;
    for (const opt of sel.options) {
      if (opt.text.includes('Closed-Pending')) {
        sel.value = opt.value;
        ['focus','input','change','blur'].forEach(ev => sel.dispatchEvent(new Event(ev, {bubbles:true})));
        return;
      }
    }
  })()`);
  await page.wait(2);

  // 填 Complexity
  const complexityMap: Record<string, string> = {
    '1': '1 - Easy', '2': '2 - Non-Trivial', '3': '3 - Medium', '4': '4 - High', '5': '5 - Very High',
  };
  const complexityTarget = complexityMap[String(kwargs.complexity || '3')] || '3 - Medium';
  await page.evaluate(`(()=>{
    const sel = document.getElementById('ID_CASE_COMPLEXITY_MASK_');
    if (!sel) return;
    for (const opt of sel.options) {
      if (opt.text.includes(${JSON.stringify(complexityTarget)})) {
        sel.value = opt.value;
        ['input','change'].forEach(ev => sel.dispatchEvent(new Event(ev, {bubbles:true})));
        return;
      }
    }
  })()`);

  // 填 RCA cascade
  const rcaPresets: Record<string, string> = {
    pa: 'Picture Adjustment', pp: 'Post Processing Algorithms', qdcm: 'QDCM',
  };
  const detailTarget = rcaPresets[String(kwargs.rca || 'pp').toLowerCase()] || rcaPresets['pp'];
  for (const [selId, val] of [
    ['id_rca_team', 'Multimedia'],
    ['id_rca_sub_team', 'Display'],
    ['id_rca_main_root_cause', 'System KPI'],
  ] as [string, string][]) {
    await page.evaluate(`(()=>{
      const sel = document.getElementById(${JSON.stringify(selId)});
      if (!sel) return;
      for (const opt of sel.options) {
        if (opt.text.includes(${JSON.stringify(val)})) {
          sel.value = opt.value;
          ['input','change'].forEach(ev => sel.dispatchEvent(new Event(ev, {bubbles:true})));
          return;
        }
      }
    })()`);
    await page.wait(1);
  }
  await page.wait(2);
  await page.evaluate(`(()=>{
    const sel = document.getElementById('id_rca_detail_root_cause');
    if (!sel) return;
    for (const opt of sel.options) {
      if (opt.text.includes(${JSON.stringify(detailTarget)})) {
        sel.value = opt.value;
        ['input','change'].forEach(ev => sel.dispatchEvent(new Event(ev, {bubbles:true})));
        return;
      }
    }
  })()`);

  // 填 Resolution Summary
  await page.evaluate(`(()=>{
    const el = document.getElementById('id_rca_resolution_summary');
    if (!el) return;
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(summary)});
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);

  // 填 CR
  if (crToAppend) {
    const crCoords = await page.evaluate(`(()=>{
      const inp = document.getElementById('id_cr_list');
      if (!inp) return null;
      const rect = inp.getBoundingClientRect();
      return rect.width > 0 ? JSON.stringify({x: Math.round(rect.left + rect.width/2), y: Math.round(rect.top + rect.height/2)}) : null;
    })()`);
    if (crCoords) {
      const c = JSON.parse(String(crCoords));
      if (page.nativeClick) { try { await page.nativeClick(c.x, c.y); } catch {} await page.wait(0.3); }
      if (page.nativeType)  { try { await page.nativeType(crToAppend); } catch {} }
    }
  }
  results.push({ step: 'fill CE Update', status: 'status + RCA + summary' + (crToAppend ? ' + CR ' + crToAppend : '') + ' filled' });

  // 点 Save
  const saveResult = await page.evaluate(`(()=>{
    const norm = v => (v||'').replace(/\\u200b/g,'').replace(/\\s+/g,' ').trim();
    const btn = document.querySelector('.swal2-confirm') ||
      Array.from(document.querySelectorAll('button')).find(b => norm(b.innerText||b.textContent||'') === 'Save');
    if (!btn) return 'no save btn';
    btn.click(); return 'clicked';
  })()`);
  await page.wait(8);

  const modalGone = await page.evaluate(`(()=>{ return document.querySelectorAll('.swal2-popup').length === 0; })()`);

  results.push({ step: 'save', status: modalGone ? 'ok' : 'FAILED (save=' + saveResult + ')' });
  if (modalGone) results.push({ step: 'done', status: 'Case ' + caseNum + ' closed with AI summary' });
  const last = results[results.length - 1];
  return (last?.step === 'done') ? 'done' : ('failed: ' + (last?.status || 'unknown'));
}


cli({
  site: 'salesforce',
  name: 'case-holiday-close',
  description: '节假日批量回复并关闭所有 open case（默认预览，--execute 执行）',
  domain: 'qualcomm-cdmatech-support.lightning.force.com',
  strategy: Strategy.UI,
  browser: true,
  timeoutSeconds: 600,
  defaultFormat: 'plain',
  args: [
    { name: 'execute',    type: 'bool', required: false, positional: false, help: '真正执行，默认仅预览' },
    { name: 'rca',        type: 'str',  required: false, positional: false, help: 'RCA 快捷模式: pp(默认) | pa | qdcm' },
    { name: 'complexity', type: 'str',  required: false, positional: false, help: 'Complexity 1-5，默认 3' },
  ],
  columns: ['case', 'subject', 'action', 'detail'],
  func: async (page, kwargs) => {
    process.env.OPENCLI_BROWSER_COMMAND_TIMEOUT = '600';
    const mapping = loadMapping();
    const results: Array<{ case: string; subject: string; action: string; detail: string }> = [];

    // 1. 获取节日名称
    const holidayName = await getHolidayName();
    const comment = buildComment(holidayName);
    results.push({ case: '──', subject: '', action: 'holiday', detail: holidayName });
    results.push({ case: '──', subject: '', action: 'comment preview', detail: comment.split('\n')[0] + '...' });

    // 2. 抓取 open case 列表
    await page.goto(LIST_URL);
    await page.wait(8);
    // Force SF virtual-scroll to render all rows by repeatedly firing resize
    try {
      await page.cdp('Emulation.setDeviceMetricsOverride', {
        width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false
      });
    } catch (_) {}
    for (let r = 0; r < 5; r++) {
      await page.evaluate(`window.dispatchEvent(new Event('resize'))`);
      await page.wait(1);
    }
    await page.wait(3);

    for (let i = 0; i < 15; i++) {
      const n = await page.evaluate(`(()=>{
        if (!document || !document.body) return 0;
        var text = document.body.innerText;
        var dataStart = text.lastIndexOf('Show Account Name column actions');
        if (dataStart === -1) dataStart = text.lastIndexOf('Account Name');
        var dataText = dataStart > -1 ? text.substring(dataStart) : text;
        var parts = dataText.split('\\t').map(function(s){ return s.trim(); }).filter(Boolean);
        return parts.filter(function(p){ return /^\\d{8}$/.test(p); }).length;
      })()`);
      if ((n as number) >= 1) break;
      await page.wait(2);
    }

    const raw = await page.evaluate(`(()=>{
      if (!document.body) return { linkMap: {}, rows: [] };
      var linkMap = {};
      var allRoots = [document];
      var rootIdx = 0;
      while (rootIdx < allRoots.length) {
        var root = allRoots[rootIdx++];
        if (!root || !root.querySelectorAll) continue;
        root.querySelectorAll('*').forEach(function(el) {
          if (el.shadowRoot) allRoots.push(el.shadowRoot);
        });
        root.querySelectorAll('a[href*="/Case/"][href*="/view"]').forEach(function(a) {
          var text = a.textContent.trim();
          var caseM = text.match(/\\d{8}/);
          var sfM = a.href.match(/\\/Case\\/([a-zA-Z0-9]{15,18})\\/view/);
          if (caseM && sfM && sfM[1] !== caseM[0]) linkMap[caseM[0]] = sfM[1];
        });
      }
      var text = document.body.innerText;
      var dataStart = text.lastIndexOf('Show Account Name column actions');
      if (dataStart === -1) dataStart = text.lastIndexOf('Account Name');
      var dataText = dataStart > -1 ? text.substring(dataStart) : text;
      var parts = dataText.split('\\t').map(function(s){ return s.trim(); }).filter(Boolean);
      var statusKeywords = ['Customer Updated Case','Research-Internal Support','Hold-Customer Information Required','Closed-Pending Your Approval','Open','New','Closed','Resolved','Pending'];
      var rows = [];
      var i = 0;
      while (i < parts.length) {
        if (/^\\d{8}$/.test(parts[i])) {
          var caseNum = parts[i];
          var customerProject = parts[i+1] || '';
          var subject = (parts[i+2] || '').split('\\n')[0].trim();
          var statusIdx = -1;
          for (var s = i+3; s < Math.min(i+8, parts.length); s++) {
            for (var k = 0; k < statusKeywords.length; k++) {
              if (parts[s].indexOf(statusKeywords[k]) === 0) { statusIdx = s; break; }
            }
            if (statusIdx !== -1) break;
          }
          var status = statusIdx !== -1 ? parts[statusIdx].split('\\n')[0].trim() : (parts[i+3] || '');
          var dateOpened = statusIdx !== -1 ? (parts[statusIdx+1] || '') : '';
          dateOpened = dateOpened.split('\\n')[0].trim();
          if (!/\\d{1,2}\\/\\d{1,2}\\/\\d{4}/.test(dateOpened)) dateOpened = '';
          var problemArea = '';
          if (dateOpened && statusIdx !== -1) { problemArea = (parts[statusIdx+2] || '').split('\\n')[0].trim(); }
          var showActionsIdx = -1;
          for (var s = i+3; s < Math.min(i+35, parts.length); s++) {
            if (parts[s].indexOf('Show Actions') === 0) { showActionsIdx = s; break; }
          }
          var tamEscalate = '', dailyScrum = '', relatedCRs = '', progressUpdate = '', chipset = '', lastQcom = '', lastCustomer = '', account = '';
          if (showActionsIdx > 0) {
            var j = showActionsIdx - 1;
            tamEscalate = (parts[j] || '').split('\\n')[0].trim();
            dailyScrum  = (parts[j-1] || '').split('\\n')[0].trim();
            var k = j - 2;
            if (/^\\d{5,}$/.test((parts[k] || '').trim())) {
              relatedCRs = parts[k].trim();
              k--;
            }
            if (/^\\[/.test((parts[k] || '').trim()) || (parts[k] || '').trim().length > 30) {
              progressUpdate = (parts[k] || '').split('\\n')[0].trim();
              k--;
            }
            chipset      = (parts[k] || '').split('\\n')[0].trim();
            lastQcom     = (parts[k-1] || '').split('\\n')[0].trim();
            lastCustomer = (parts[k-2] || '').split('\\n')[0].trim();
            account      = (parts[k-3] || '').split('\\n')[0].trim();
          }
          var chipM = subject.match(/^\\[([^\\]]+)\\]/);
          if (chipM && !chipset) chipset = chipM[1];
          rows.push({ caseNum, customerProject, chipset, subject, status, dateOpened, problemArea, account, lastCustomer, lastQcom, progressUpdate, relatedCRs, dailyScrum, tamEscalate });
          if (showActionsIdx !== -1) { i = showActionsIdx + 1; }
          else { i += 18; }
          while (i < parts.length && !/^\\d{8}$/.test(parts[i])) i++;
        } else { i++; }
      }
      return { linkMap, rows };
    })()`)


    const { linkMap, rows } = raw as any;

    let cacheUpdated = false;
    for (const [n, sfId] of Object.entries(linkMap as Record<string, string>)) {
      if (!mapping[n]) { mapping[n] = sfId as string; cacheUpdated = true; }
    }
    if (cacheUpdated) saveMapping(mapping);

    // 3. 过滤出需要处理的 case
    const targetCases = (rows as any[]).filter((r: any) =>
      !SKIP_STATUSES.some(s => String(r.status || '').startsWith(s))
    );

    if (targetCases.length === 0) {
      results.push({ case: '──', subject: '', action: 'info', detail: 'No open cases to process' });
      return results;
    }

    for (const r of targetCases) {
      results.push({ case: r.caseNum, subject: (r.subject || '').substring(0, 50), action: 'pending', detail: `status: ${r.status}` });
    }

    if (!kwargs.execute) {
      results.push({ case: '──', subject: '', action: 'info', detail: `${targetCases.length} cases to process. Add --execute to run.` });
      return results;
    }

    // 4. 执行：逐个 reply + close
    const execResults: Array<{ case: string; subject: string; action: string; detail: string }> = [];
    execResults.push({ case: '──', subject: '', action: 'holiday', detail: holidayName });

    for (const r of targetCases) {
      const caseNum = r.caseNum;
      const sfId = mapping[caseNum];
      const subj = (r.subject || '').substring(0, 50);

      if (!sfId) {
        execResults.push({ case: caseNum, subject: subj, action: 'SKIP', detail: 'no SF ID in mapping' });
        continue;
      }

      // 4a. 发送节日 comment
      try {
        const replyStatus = await replyCase(page, caseNum, sfId, comment);
        execResults.push({ case: caseNum, subject: subj, action: replyStatus === 'replied' ? 'replied' : 'reply-failed', detail: replyStatus });
      } catch (e: any) {
        execResults.push({ case: caseNum, subject: subj, action: 'reply-failed', detail: (e?.message || String(e)).substring(0, 80) });
      }

      // 4b. AI 生成 summary 并关闭（等待 reply modal 完全消失）
      await page.wait(5);
      try {
        const closeStatus = await runCaseCloseAI(page, caseNum, sfId, kwargs);
        execResults.push({ case: caseNum, subject: subj, action: closeStatus, detail: 'closed with AI summary' });
      } catch (e: any) {
        execResults.push({ case: caseNum, subject: subj, action: 'close-failed', detail: (e?.message || String(e)).substring(0, 300) });
      }
    }

    return execResults;
  },
});
