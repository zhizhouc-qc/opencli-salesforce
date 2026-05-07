import { cli, Strategy } from '@jackwener/opencli/registry';
import * as fs from 'fs';

const SF_BASE = 'https://qualcomm-cdmatech-support.lightning.force.com';
const NO_RCA_URL = `${SF_BASE}/lightning/o/Case/list?filterName=Opencli_My_Closed_Cases_Without_RCA`;
const MAPPING_FILE = 'C:/Users/zhizhouc/Documents/sf_case_id_mapping.json';

function loadMapping(): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(MAPPING_FILE, 'utf-8')); } catch { return {}; }
}
function saveMapping(m: Record<string, string>) {
  try { fs.writeFileSync(MAPPING_FILE, JSON.stringify(m, null, 2)); } catch {}
}

cli({
  site: 'salesforce',
  name: 'cases-no-rca',
  description: '列出所有已关闭但缺少 RCA 的 case',
  domain: 'qualcomm-cdmatech-support.lightning.force.com',
  strategy: Strategy.UI,
  browser: true,
  defaultFormat: 'table',
  args: [],
  columns: ['#', 'case', 'chip', 'subject', 'status', 'closed'],
  func: async (page, kwargs) => {
    await page.goto(NO_RCA_URL);
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
        var dataStart = text.lastIndexOf('Show Case Number column actions');
        if (dataStart === -1) dataStart = text.lastIndexOf('Case Number');
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
      var dataStart = text.lastIndexOf('Show Case Number column actions');
      if (dataStart === -1) dataStart = text.lastIndexOf('Case Number');
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
      // No RCA 列表无 customerProject 列，字段整体偏移一位
      const realSubject = (r.customerProject || '').split('\n')[0].replace(/\s*Preview$/, '').trim();
      const realStatus  = (r.subject || '').split('\n')[0].trim();
      const realClosed  = (r.status || '').split('\n')[0].trim();
      let subj = realSubject.replace(/^\[([^\]]+)\]\s*/g, '').trim();
      if (subj.length > 50) subj = subj.substring(0, 48) + '..';
      const chipM = realSubject.match(/^\[([^\]]+)\]/);
      return {
        '#': i + 1,
        case: r.caseNum,
        chip: chipM ? chipM[1] : '',
        subject: subj,
        status: realStatus,
        closed: realClosed,
      };
    });
  },
});
