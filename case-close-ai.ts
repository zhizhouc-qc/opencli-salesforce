import { fetch as undiciFetch, Agent } from 'file:///C:/Users/zhizhouc/AppData/Roaming/npm/node_modules/@jackwener/opencli/node_modules/undici/index.js';
import * as os from 'os';
import * as path from 'path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import * as fs from 'fs';

const SF_BASE = 'https://qualcomm-cdmatech-support.lightning.force.com';
const MAPPING_FILE = 'C:/Users/zhizhouc/Documents/sf_case_id_mapping.json';

function loadMapping(): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(MAPPING_FILE, 'utf-8')); } catch { return {}; }
}

async function askAI(prompt: string): Promise<string> {
  // 优先用环境变量，fallback 从 qgenie config.toml 读取
  let apiKey = process.env.QGENIE_API_KEY || '';
  if (!apiKey) {
    try {
      const cfgPath = path.join(os.homedir(), 'AppData', 'Roaming', 'qgenie-cli', 'config.toml');
      const cfg = fs.readFileSync(cfgPath, 'utf-8');
      const m = cfg.match(/api_key\s*=\s*["']([^"']+)["']/);
      if (m) apiKey = m[1];
    } catch {}
  }
  const bodyObj = {
    model: 'anthropic::claude-4-6-sonnet',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 300,
    stream: true,
  };
  const agent = new Agent({ connect: { rejectUnauthorized: false } });
  const endpoints = [
    'https://qgenie-api.qualcomm.com/v1/chat/completions',
    'https://qpilot-api.qualcomm.com/v1/chat/completions',
  ];
  let lastErr = '';
  for (const url of endpoints) {
    try {
      const res = await undiciFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify(bodyObj),
        dispatcher: agent,
      } as any);
      if (!res.ok) { lastErr = 'HTTP ' + res.status; continue; }
      const text = await res.text();
      let fullText = '';
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const j = JSON.parse(data);
          const delta = j?.choices?.[0]?.delta?.content;
          if (delta) fullText += delta;
        } catch {}
      }
      if (fullText.trim()) return fullText.trim();
      lastErr = 'empty response from ' + url;
    } catch (e: any) { lastErr = (e?.message || String(e)) + ' [' + url + ']'; }
  }
  throw new Error(lastErr || 'all endpoints failed');
}

cli({
  site: 'salesforce',
  name: 'case-close-ai',
  description: 'AI 自动总结 case root cause，生成 Resolution Summary，关闭 case（Close Pending）',
  domain: 'qualcomm-cdmatech-support.lightning.force.com',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'id',         type: 'str',  required: true,  positional: true,  help: 'Case 编号，如 08452617' },
    { name: 'cr',         type: 'str',  required: false, positional: false, help: '关联 CR 号（可选）' },
    { name: 'rca',        type: 'str',  required: false, positional: false, help: 'RCA 快捷模式: pp(默认) | pa | qdcm' },
    { name: 'complexity', type: 'str',  required: false, positional: false, help: 'Complexity 1-5，默认 3' },
    { name: 'execute',    type: 'bool', required: false, positional: false, help: '真正执行关闭，默认仅预览' },
  ],
  columns: ['step', 'status'],
  func: async (page, kwargs) => {
    const caseNum = String(kwargs.id || '').replace(/\D/g, '');
    const mapping = loadMapping();
    if (!mapping[caseNum]) throw new Error(`Case ${caseNum} not found in mapping.`);
    const results: Array<{ step: string; status: string }> = [];

    // 1. 打开 case 页面，等待加载
    await page.goto(`${SF_BASE}/lightning/r/Case/${mapping[caseNum]}/view`);
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
      if (/^Closed/i.test(cur)) return; // 已是 Closed，跳过
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
    return results;
  },
});