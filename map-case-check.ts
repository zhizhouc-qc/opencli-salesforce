import { cli, Strategy } from '@jackwener/opencli/registry';
import * as fs from 'fs';

const SF_BASE = 'https://qualcomm-cdmatech-support.lightning.force.com';
const LIST_URL = `${SF_BASE}/lightning/o/Case/list?filterName=Copy_of_My_Open_Cases_Internal52`;
const MAPPING_FILE = 'C:/Users/zhizhouc/Documents/sf_case_id_mapping.json';

function loadMapping(): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(MAPPING_FILE, 'utf-8')); } catch { return {}; }
}

cli({
  site: 'salesforce',
  name: 'map-case-check',
  description: '检查当前 Internal 列表里哪些 case 有 SF ID 映射、哪些缺失',
  domain: 'qualcomm-cdmatech-support.lightning.force.com',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'missing_only', type: 'bool', required: false, positional: false, help: '只显示缺失映射的 case' },
  ],
  defaultFormat: 'table',
  columns: ['case', 'subject', 'status', 'sfId', 'mapped'],
  func: async (page, kwargs) => {
    const missingOnly = kwargs.missing_only === true;
    await page.goto(LIST_URL);
    await page.wait(8);
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
        var parts = text.split('\\t').map(function(s){ return s.trim(); }).filter(Boolean);
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
          var subject = (parts[i+2] || '').split('\\n')[0].trim();
          var statusIdx = -1;
          for (var s = i+3; s < Math.min(i+8, parts.length); s++) {
            for (var k = 0; k < statusKeywords.length; k++) {
              if (parts[s].indexOf(statusKeywords[k]) === 0) { statusIdx = s; break; }
            }
            if (statusIdx !== -1) break;
          }
          var status = statusIdx !== -1 ? parts[statusIdx].split('\\n')[0].trim() : '';
          var showActionsIdx = -1;
          for (var s = i+3; s < Math.min(i+35, parts.length); s++) {
            if (parts[s].indexOf('Show Actions') === 0) { showActionsIdx = s; break; }
          }
          rows.push({ caseNum, subject, status });
          if (showActionsIdx !== -1) { i = showActionsIdx + 1; }
          else { i += 18; }
          while (i < parts.length && !/^\\d{8}$/.test(parts[i])) i++;
        } else { i++; }
      }
      return { linkMap, rows };
    })()`);

    const { linkMap, rows } = raw as any;
    const mapping = loadMapping();
    for (const [n, sfId] of Object.entries(linkMap as Record<string, string>)) {
      if (!mapping[n]) mapping[n] = sfId as string;
    }

    const STATUS_SHORT: Record<string, string> = {
      'Customer Updated Case': 'Customer',
      'Research-Internal Support': 'Research',
      'Hold-Customer Information Required': 'Hold',
      'Closed-Pending Your Approval': 'Closed-PA',
    };

    return (rows as any[])
      .filter((r: any) => !missingOnly || !mapping[r.caseNum])
      .map((r: any) => {
        const sfId = mapping[r.caseNum] || '';
        let subj = r.subject.replace(/^\[([^\]]+)\]\s*/g, '').trim();
        if (subj.length > 40) subj = subj.substring(0, 38) + '..';
        return {
          case: r.caseNum,
          subject: subj,
          status: STATUS_SHORT[r.status] || r.status,
          sfId: sfId ? sfId.substring(0, 18) : '(MISSING)',
          mapped: sfId ? 'YES' : 'NO',
        };
      });
  },
});
