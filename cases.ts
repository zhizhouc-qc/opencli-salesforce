import { cli, Strategy } from '@jackwener/opencli/registry';
import * as fs from 'fs';

const SF_BASE = 'https://qualcomm-cdmatech-support.lightning.force.com';
const LIST_URL = `${SF_BASE}/lightning/o/Case/list?filterName=My_Open_Casesx1`;
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
  name: 'cases',
  description: 'List my Open Cases (compact table)',
  domain: 'qualcomm-cdmatech-support.lightning.force.com',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'full', type: 'bool', required: false, positional: false, help: 'Show full subject and href' },
  ],
  defaultFormat: 'table',
  columns: ['#', 'case', 'chip', 'project', 'subject', 'status', 'pri', 'account'],
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
      document.querySelectorAll('a[href*="/Case/"][href*="/view"]').forEach(function(a) {
        var text = a.textContent.trim();
        var caseM = text.match(/\\d{8}/);
        var sfM = a.href.match(/\\/Case\\/([a-zA-Z0-9]{15,18})\\/view/);
        if (caseM && sfM && sfM[1] !== caseM[0]) linkMap[caseM[0]] = sfM[1];
      });
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
          var priority = statusIdx !== -1 ? (parts[statusIdx+1] || '') : (parts[i+4] || '');
          priority = priority.split('\\n')[0].trim();
          var account = '';
          var showActionsIdx = -1;
          for (var s = i+5; s < Math.min(i+20, parts.length); s++) {
            if (parts[s].indexOf('Show Actions') === 0) { showActionsIdx = s; break; }
          }
          if (showActionsIdx !== -1) account = parts[showActionsIdx - 1] || '';
          var chipset = '';
          var chipM = subject.match(/^\\[([^\\]]+)\\]/);
          if (chipM) chipset = chipM[1];
          rows.push({ caseNum, customerProject, chipset, subject, status, priority, account });
          if (showActionsIdx !== -1) { i = showActionsIdx + 1; }
          else { i += 12; }
          while (i < parts.length && !/^\\d{8}$/.test(parts[i])) i++;
        } else { i++; }
      }
      return { linkMap, rows };
    })()`);

    const { linkMap, rows } = raw as any;
    const mapping = loadMapping();
    let cacheUpdated = false;
    for (const [n, sfId] of Object.entries(linkMap as Record<string, string>)) {
      if (!mapping[n]) { mapping[n] = sfId as string; cacheUpdated = true; }
    }
    if (cacheUpdated) saveMapping(mapping);

    return (rows as any[]).map((r: any, i: number) => {
      const sfId = mapping[r.caseNum] || (linkMap as any)[r.caseNum];
      const href = sfId ? `${SF_BASE}/lightning/r/Case/${sfId}/view` : `${SF_BASE}/lightning/r/Case/${r.caseNum}/view`;
      const statusShort = STATUS_SHORT[r.status] || r.status;
      const priShort = PRIORITY_SHORT[r.priority] || r.priority;
      // Strip [Chipset] [Project] prefix from subject for compactness
      let subj = r.subject.replace(/^\[([^\]]+)\]\s*/g, '').trim();
      if (!showFull && subj.length > 50) subj = subj.substring(0, 48) + '..'
      // Truncate long fields to keep table compact
      const proj = r.customerProject.length > 16 ? r.customerProject.substring(0, 15) + '…' : r.customerProject;
      const acct = r.account.replace(' Co., Ltd.', '').replace(' Company Limited', '').replace(' Corporation', '').replace(' Communications', ' Comm').replace('Technology', 'Tech').replace('Guangdong ', '');
      const acctShort = acct.length > 22 ? acct.substring(0, 21) + '…' : acct;
      const row: any = {
        '#': i + 1,
        case: r.caseNum,
        chip: r.chipset,
        project: proj,
        subject: subj,
        status: statusShort,
        pri: priShort,
        account: acctShort,
      };
      if (showFull) row.href = href;
      return row;
    });
  },
});