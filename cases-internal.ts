import { cli, Strategy } from '@jackwener/opencli/registry';
import * as fs from 'fs';

const SF_BASE = 'https://qualcomm-cdmatech-support.lightning.force.com';
const LIST_URL = `${SF_BASE}/lightning/o/Case/list?filterName=Copy_of_My_Open_Cases_Internal52`;
const MAPPING_FILE = 'C:/Users/zhizhouc/Documents/sf_case_id_mapping.json';

const STATUS_SHORT: Record<string, string> = {
  'Customer Updated Case':           'Customer',
  'Research-Internal Support':        'Research',
  'Hold-Customer Information Required': 'Hold',
  'Closed-Pending Your Approval':    'Closed',
  'Open':    'Open',
  'New':     'New',
  'Closed':  'Closed',
  'Resolved':'Resolved',
  'Pending': 'Pending',
};

const PRIORITY_SHORT: Record<string, string> = {
  '1 - Critical': 'P1',
  '2 - High':     'P2',
  '3 - Medium':   'P3',
  '4 - Low':      'P4',
};

function loadMapping(): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(MAPPING_FILE, 'utf-8')); } catch { return {}; }
}
function saveMapping(m: Record<string, string>) {
  try { fs.writeFileSync(MAPPING_FILE, JSON.stringify(m, null, 2)); } catch {}
}

cli({
  site: 'salesforce',
  name: 'cases-internal',
  description: 'List my Open Cases - Internal view (with date, problem area, last comments)',
  domain: 'qualcomm-cdmatech-support.lightning.force.com',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'full', type: 'bool', required: false, positional: false, help: 'Show full subject and href' },
  ],
  defaultFormat: 'table',
  columns: ['#', 'case', 'chip', 'project', 'subject', 'status', 'opened', 'area', 'account', 'last_customer', 'last_qcom', 'progress', 'related_crs', 'scrum_l2', 'tam_l1'],
  func: async (page, kwargs) => {
    const showFull = kwargs.full === true;
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
    const mapping = loadMapping();
    let cacheUpdated = false;
    for (const [n, sfId] of Object.entries(linkMap as Record<string, string>)) {
      if (mapping[n] !== sfId) {
        mapping[n] = sfId as string;
        cacheUpdated = true;
      }
    }
    if (cacheUpdated) saveMapping(mapping);


    return (rows as any[]).map((r: any, i: number) => {
      const sfId = mapping[r.caseNum] || (linkMap as any)[r.caseNum];
      const href = sfId ? `${SF_BASE}/lightning/r/Case/${sfId}/view` : `${SF_BASE}/lightning/r/Case/${r.caseNum}/view`;
      const statusShort = STATUS_SHORT[r.status] || r.status;

      let subj = r.subject.replace(/^\[([^\]]+)\]\s*/g, '').trim();
      if (!showFull && subj.length > 45) subj = subj.substring(0, 43) + '..';

      const proj = r.customerProject.length > 18 ? r.customerProject.substring(0, 17) + '...' : r.customerProject;
      const acct = r.account
        .replace(' Co., Ltd.', '').replace(' Company Limited', '').replace(' Corporation', '')
        .replace(' Communications', ' Comm').replace('Technology', 'Tech').replace('Guangdong ', '');
      const acctShort = acct.length > 20 ? acct.substring(0, 19) + '...' : acct;

      const dateShort = r.dateOpened ? r.dateOpened.replace(/(\d+)\/(\d+)\/\d+,.*/,
        (_: string, m: string, d: string) => `${m.padStart(2,'0')}/${d.padStart(2,'0')}`) : '';

      const maxComment = showFull ? 200 : 60;
      const lastCust = r.lastCustomer.length > maxComment ? r.lastCustomer.substring(0, maxComment - 2) + '..' : r.lastCustomer;
      const lastQc = r.lastQcom.length > maxComment ? r.lastQcom.substring(0, maxComment - 2) + '..' : r.lastQcom;

      const maxProgress = showFull ? 300 : 80;
      const progress = r.progressUpdate && r.progressUpdate.length > maxProgress
        ? r.progressUpdate.substring(0, maxProgress - 2) + '..' : (r.progressUpdate || '');

      const scrum = r.dailyScrum === 'True' ? 'Y' : '';
      const tam   = r.tamEscalate === 'True' ? 'Y' : '';
      const crs   = r.relatedCRs || '';

      const row: any = {
        '#': i + 1,
        case: r.caseNum,
        chip: r.chipset,
        project: proj,
        subject: subj,
        status: statusShort,
        opened: dateShort,
        area: r.problemArea,
        account: acctShort,
        last_customer: lastCust,
        last_qcom: lastQc,
        progress,
        related_crs: crs,
        scrum_l2: scrum,
        tam_l1: tam,
      };
      if (showFull) row.href = href;
      return row;
    });
  },
});
