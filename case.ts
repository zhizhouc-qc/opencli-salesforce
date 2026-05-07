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
    throw new Error(`No Salesforce ID mapping for case ${caseNum}. Update ${MAPPING_FILE} first.`);
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

cli({
  site: 'salesforce',
  name: 'case',
  description: '查看单个 Case 详情（基础字段 + Description + 结构化 Feed）',
  domain: 'qualcomm-cdmatech-support.lightning.force.com',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'id', type: 'str', required: true, positional: true, help: 'Case 编号，如 08420970' },
    { name: 'field', type: 'str', required: false, positional: true, help: '可选：指定字段名，如 Chipset / Status / CR / L1 / L2 / LastUpdate' },
  ],
  columns: ['field', 'value'],
  func: async (page, kwargs) => {
    const caseNum = String(kwargs.id || '').replace(/\D/g, '');
    const fieldQuery = String(kwargs.field || '').trim();

    // Alias map for short field names
    const FIELD_ALIASES: Record<string, string> = {
      'lastupdate': 'Latest Qualcomm Progress Update',
      'cr':         'Related CRs',
      'l2':         'Daily SCRUM (L2)',
      'l1':         'TAM Escalate (L1)',
    };
    if (fieldQuery && FIELD_ALIASES[fieldQuery.toLowerCase()]) {
      (kwargs as any).field = FIELD_ALIASES[fieldQuery.toLowerCase()];
    }
    const resolvedField = FIELD_ALIASES[fieldQuery.toLowerCase()] || fieldQuery;

    // Short-circuit: list-only fields don't need the case detail page
    const LIST_ONLY_FIELDS = ['last case comment','latest qualcomm comment','latest qualcomm progress update','related crs','daily scrum (l2)','tam escalate (l1)'];
    if (fieldQuery && LIST_ONLY_FIELDS.some(f => f === resolvedField.toLowerCase())) {
      const LIST_URL_INTERNAL = `${SF_BASE}/lightning/o/Case/list?filterName=Copy_of_My_Open_Cases_Internal52`;
      await page.goto(LIST_URL_INTERNAL);
      await page.wait(10);
      for (let r = 0; r < 15; r++) {
        const n = await page.evaluate(`(()=>{ if(!document.body) return 0; var t=document.body.innerText; return t.split('\t').filter(function(p){return /^\d{8}$/.test(p.trim());}).length; })()`);
        if ((n as number) >= 1) break;
        await page.wait(2);
      }
      const listRaw = await page.evaluate(`(()=>{
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
            var statusIdx = -1;
            for (var s = i+3; s < Math.min(i+8, parts.length); s++) {
              for (var k = 0; k < statusKeywords.length; k++) {
                if (parts[s].indexOf(statusKeywords[k]) === 0) { statusIdx = s; break; }
              }
              if (statusIdx !== -1) break;
            }
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
              if (/^\\d{5,}$/.test((parts[k] || '').trim())) { relatedCRs = parts[k].trim(); k--; }
              if (/^\\[/.test((parts[k] || '').trim()) || (parts[k] || '').trim().length > 30) { progressUpdate = (parts[k] || '').split('\\n')[0].trim(); k--; }
              chipset      = (parts[k] || '').split('\\n')[0].trim();
              lastQcom     = (parts[k-1] || '').split('\\n')[0].trim();
              lastCustomer = (parts[k-2] || '').split('\\n')[0].trim();
              account      = (parts[k-3] || '').split('\\n')[0].trim();
            }
            return JSON.stringify({
              'Last Case Comment': lastCustomer,
              'Latest Qualcomm Comment': lastQcom,
              'Latest Qualcomm Progress Update': progressUpdate,
              'Related CRs': relatedCRs,
              'Daily SCRUM (L2)': dailyScrum,
              'TAM Escalate (L1)': tamEscalate,
              'Date/Time Opened': dateOpened,
              'Problem Area 3': problemArea,
              'Chipset': chipset,
              'Account Name': account
            });
          }
          i++;
        }
        return null;
      })()`)
      if (listRaw) {
        const lf = JSON.parse(String(listRaw));
        const lkey = Object.keys(lf).find(k => k.toLowerCase() === resolvedField.toLowerCase());
        if (lkey !== undefined) return [{ field: lkey, value: String(lf[lkey] || '(empty)') }];
      }
      return [{ field: 'error', value: `Case ${caseNum} not found in list view, or field "${resolvedField}" unavailable.` }];
    }

    const caseUrl = await resolveCaseUrl(page, caseNum);

    await page.goto(caseUrl);
    await page.wait(8);
    await refreshMappingFromPage(page, caseNum);

    const DETAIL_FAST_FIELDS = new Set([
      'case number', 'subject', 'status', 'priority', 'description', 'chipset',
      'customer project', 'account name', 'problem area', 'problem area 3',
      'case owner', 'tam', 'severity', 'contact name', 'category', 'sub area',
      'date/time opened'
    ]);
    if (fieldQuery && DETAIL_FAST_FIELDS.has(resolvedField.toLowerCase())) {
      const fastRaw = await page.evaluate(`(()=>{ const target=${JSON.stringify(caseNum)}; const norm=(value)=>(value||'').replace(/\\u200b/g,'').replace(/\\s+/g,' ').trim(); const bodyText=document.body?(document.body.innerText||''):''; const lines=bodyText.split('\\n').map((line)=>norm(line)).filter(Boolean); const labels=['Case Number','Subject','Status','Priority','Description','Chipset','Account Name','Customer Project','Problem Area','Problem Area 3','Case Owner','TAM','Severity','Contact Name','Category','Sub Area','Date/Time Opened']; const out={}; out['Case Number']=target; for(let i=0;i<lines.length;i++){ const label=lines[i]; if(!labels.includes(label)) continue; for(let j=i+1;j<lines.length;j++){ const value=lines[j]; if(!value) continue; if(labels.includes(value)) break; out[label]=value; break; } } if(!out['Subject']){ for(const line of lines){ if(/^\\d{8}\\s*\\[/.test(line)){ out['Subject']=line.replace(/^\\d{8}\\s*/,'').trim(); break; } } } return JSON.stringify(out); })()`);
      try {
        const fastFields = JSON.parse(String(fastRaw || '{}'));
        const fastKey = Object.keys(fastFields).find((k) => k.toLowerCase() === resolvedField.toLowerCase());
        if (fastKey && fastFields[fastKey]) {
          return [{ field: fastKey, value: String(fastFields[fastKey]) }];
        }
      } catch {}
    }

    let actualCaseNum: string | null = null;
    let pagePreview = '';
    for (let attempt = 0; attempt < 6; attempt++) {
      const readiness = await page.evaluate(`(() => {
        const text = document.body.innerText || '';
        const match = text.match(/\\b(\\d{8})\\b/);
        return {
          caseNum: match ? match[1] : null,
          preview: text.replace(/\\s+/g, ' ').trim().slice(0, 200),
        };
      })()`) as any;
      actualCaseNum = readiness?.caseNum || null;
      pagePreview = readiness?.preview || '';
      if (actualCaseNum === caseNum) break;
      await page.wait(2);
    }

    if (actualCaseNum && actualCaseNum !== caseNum) {
      return [{ field: 'error', value: `Opened wrong case (got ${actualCaseNum}, wanted ${caseNum}). URL: ${caseUrl}` }];
    }

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
    try {
      parsed = JSON.parse(String(detailsRaw));
    } catch {
      return [{ field: 'error', value: String(detailsRaw).slice(0, 300) }];
    }

    const fields = parsed.fields || {};
    const feed = Array.isArray(parsed.feed) ? parsed.feed : [];
    const extractedCaseNum = String(fields['Case Number'] || '').replace(/\D/g, '');
    if (extractedCaseNum && extractedCaseNum !== caseNum) {
      return [{ field: 'error', value: `Opened wrong case (got ${extractedCaseNum}, wanted ${caseNum}). URL: ${caseUrl}` }];
    }
    // fieldQuery already declared above
    if (!fields['Subject'] && !fields['Description'] && feed.length === 0) {
      if (!fieldQuery) {
        return [{ field: 'error', value: `Case page did not finish loading. URL: ${caseUrl}. Preview: ${pagePreview || '(empty)'}` }];
      }
      // fieldQuery set: skip to list-view fallback below
    }
    const orderedFields = [
      'Case Number',
      'Subject',
      'Status',
      'Priority',
      'Description',
      'Chipset',
      'Customer Project',
      'Account Name',
      'Problem Area',
      'Problem Area 3',
      'Case Owner',
      'TAM',
      'Severity',
      'Contact Name',
      'Category',
      'Sub Area',
      'Date/Time Opened',
      'Latest Qualcomm Progress Update',
    ];

    const rows: Array<{ field: string; value: string }> = [];
    for (const fieldName of orderedFields) {
      if (fields[fieldName]) rows.push({ field: fieldName, value: String(fields[fieldName]) });
    }
    for (const [fieldName, value] of Object.entries(fields)) {
      if (!orderedFields.includes(fieldName)) rows.push({ field: fieldName, value: String(value) });
    }

    if (feed.length > 0) {
      rows.push({ field: '─── Feed ───', value: '' });
      feed.forEach((item: any, index: number) => {
        if (item.author) rows.push({ field: `Feed[${index + 1}] Author`, value: String(item.author) });
        if (item.timestamp) rows.push({ field: `Feed[${index + 1}] Time`, value: String(item.timestamp) });
        if (item.body) rows.push({ field: `Feed[${index + 1}] Body`, value: String(item.body) });
      });
    }

    // If a specific field was requested, return just that value
    if (fieldQuery) {
      // 1. Try detail-page fields first
      const key = Object.keys(fields).find(
        k => k.toLowerCase() === resolvedField.toLowerCase()
      );
      if (key) return [{ field: key, value: String(fields[key]) }];

      // 2. Try feed rows
      const feedMatch = rows.filter(r => r.field.toLowerCase().includes(resolvedField.toLowerCase()));
      if (feedMatch.length > 0) return feedMatch;

      // 3. Fallback: fetch from list view (for list-only fields like Last Case Comment)
      const LIST_ONLY = [
        'last case comment', 'latest qualcomm comment',
        'latest qualcomm progress update', 'date/time opened', 'problem area 3',
      ];
      const fqLower = fieldQuery.toLowerCase();
      const isListOnly = LIST_ONLY.some(f => f === fqLower || fqLower.includes(f.split(' ')[0].toLowerCase()));
      if (isListOnly || true) {
        const LIST_URL_INTERNAL = `${SF_BASE}/lightning/o/Case/list?filterName=Copy_of_My_Open_Cases_Internal52`;
        await page.goto(LIST_URL_INTERNAL);
        await page.wait(8);
        for (let r = 0; r < 10; r++) {
          const n = await page.evaluate(`(()=>{ if(!document.body) return 0; var t=document.body.innerText; return t.split('\t').filter(function(p){return /^\d{8}$/.test(p.trim());}).length; })()`);
          if ((n as number) >= 1) break;
          await page.wait(2);
        }
        const listRaw = await page.evaluate(`(()=>{ if(!document.body) return null; var text=document.body.innerText; var dataStart=text.lastIndexOf('Show Account Name column actions'); if(dataStart===-1) dataStart=text.lastIndexOf('Account Name'); var dataText=dataStart>-1?text.substring(dataStart):text; var parts=dataText.split('\\t').map(function(s){return s.trim();}).filter(Boolean); var statusKeywords=['Customer Updated Case','Research-Internal Support','Hold-Customer Information Required','Closed-Pending Your Approval','Open','New','Closed','Resolved','Pending']; var i=0; while(i<parts.length){  if(/^\\d{8}$/.test(parts[i])&&parts[i]===${JSON.stringify(caseNum)}){   var statusIdx=-1;   for(var s=i+3;s<Math.min(i+8,parts.length);s++){for(var k=0;k<statusKeywords.length;k++){if(parts[s].indexOf(statusKeywords[k])===0){statusIdx=s;break;}}if(statusIdx!==-1)break;}   var dateOpened=statusIdx!==-1?(parts[statusIdx+1]||''):'';   dateOpened=dateOpened.split('\\n')[0].trim();   if(!/\\d{1,2}\\/\\d{1,2}\\/\\d{4}/.test(dateOpened)) dateOpened='';   var problemArea='';   if(dateOpened&&statusIdx!==-1){problemArea=(parts[statusIdx+2]||'').split('\\n')[0].trim();}   var showActionsIdx=-1;   for(var s=i+3;s<Math.min(i+35,parts.length);s++){if(parts[s].indexOf('Show Actions')===0){showActionsIdx=s;break;}}   var tamEscalate='',dailyScrum='',relatedCRs='',progressUpdate='',chipset='',lastQcom='',lastCustomer='',account='';   if(showActionsIdx>0){    var j=showActionsIdx-1;    tamEscalate=(parts[j]||'').split('\\n')[0].trim();    dailyScrum=(parts[j-1]||'').split('\\n')[0].trim();    var k=j-2;    if(/^\\d{5,}$/.test((parts[k]||'').trim())){relatedCRs=parts[k].trim();k--;}    if(/^\\[/.test((parts[k]||'').trim())||(parts[k]||'').trim().length>30){progressUpdate=(parts[k]||'').split('\\n')[0].trim();k--;}    chipset=(parts[k]||'').split('\\n')[0].trim();    lastQcom=(parts[k-1]||'').split('\\n')[0].trim();    lastCustomer=(parts[k-2]||'').split('\\n')[0].trim();    account=(parts[k-3]||'').split('\\n')[0].trim();   }   return JSON.stringify({    'Last Case Comment':lastCustomer,    'Latest Qualcomm Comment':lastQcom,    'Latest Qualcomm Progress Update':progressUpdate,    'Related CRs':relatedCRs,    'Daily SCRUM (L2)':dailyScrum,    'TAM Escalate (L1)':tamEscalate,    'Date/Time Opened':dateOpened,    'Problem Area 3':problemArea,    'Chipset':chipset,    'Account Name':account   });  }  i++; } return null;})()`);

        if (listRaw) {
          const listFields = JSON.parse(String(listRaw));
          const lkey = Object.keys(listFields).find(
            k => k.toLowerCase() === fieldQuery.toLowerCase()
          );
          if (lkey && listFields[lkey]) return [{ field: lkey, value: String(listFields[lkey]) }];
          if (lkey) return [{ field: lkey, value: '(empty)' }];
        }
      }

      return [{ field: 'error', value: `Field "${resolvedField}" not found. Available: ${Object.keys(fields).join(', ')}` }];
    }

    return rows;
  },
});
