import { cli, Strategy } from '@jackwener/opencli/registry';

const SF_BASE = 'https://qualcomm-cdmatech-support.lightning.force.com';
const LIST_URL = SF_BASE + '/lightning/o/Case/list?filterName=Copy_of_My_Closed_Cases_Internal46';

const STATUS_SHORT: Record<string, string> = {
  'Closed': 'Closed',
  'Closed-Customer Requested': 'Cust-Req',
  'Closed-Pending Your Approval': 'Pend-Appr',
  'Resolved': 'Resolved',
};

const PRIORITY_SHORT: Record<string, string> = {
  '1 - Critical': 'P1',
  '2 - High':     'P2',
  '3 - Medium':   'P3',
  '4 - Low':      'P4',
};

function fmtDt(s: string): string {
  if (!s) return '';
  const m = s.match(/(\d+)\/(\d+)\/(\d+),\s*(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return s;
  let h = parseInt(m[4]);
  const min = m[5];
  const ampm = m[6].toUpperCase();
  if (ampm === 'PM' && h !== 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return m[1].padStart(2, '0') + '/' + m[2].padStart(2, '0') + ' ' + String(h).padStart(2, '0') + ':' + min;
}

cli({
  site: 'salesforce',
  name: 'closed-cases',
  description: 'List/count my Closed Cases with optional date-range filter (e.g. --days 7 for last week)',
  domain: 'qualcomm-cdmatech-support.lightning.force.com',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'days',  type: 'int',  required: false, positional: false, help: 'Filter cases closed in the last N days (e.g. 7=last week, 30=last month)' },
    { name: 'count', type: 'bool', required: false, positional: false, help: 'Only print the count, no table' },
    { name: 'full',  type: 'bool', required: false, positional: false, help: 'Show full subject' },
  ],
  defaultFormat: 'table',
  columns: ['#', 'case', 'project', 'subject', 'status', 'pri', 'opened', 'closed'],
  func: async (page, kwargs) => {
    const daysBack: number = kwargs.days ? Number(kwargs.days) : 0;
    const countOnly: boolean = kwargs.count === true;
    const showFull: boolean  = kwargs.full  === true;

    await page.goto(LIST_URL);
    await page.wait(8);

    try {
      await page.cdp('Emulation.setDeviceMetricsOverride', {
        width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false,
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
        var parts = document.body.innerText.split('\\t').map(function(s){ return s.trim(); }).filter(Boolean);
        return parts.filter(function(p){ return /^\\d{8}$/.test(p); }).length;
      })()`);
      if ((n as number) >= 1) break;
      await page.wait(2);
    }

    const rows = await page.evaluate(`(()=>{
      if (!document.body) return [];
      var text = document.body.innerText;
      var dataStart = text.lastIndexOf('Show Date/Time Closed column actions');
      if (dataStart === -1) dataStart = text.lastIndexOf('Date/Time Closed');
      var dataText = dataStart > -1 ? text.substring(dataStart) : text;
      var parts = dataText.split('\\t').map(function(s){ return s.trim(); }).filter(Boolean);
      var statusKeywords = ['Closed-Customer Requested','Closed-Pending Your Approval','Closed','Resolved','Open','New','Pending'];
      var rows = [];
      var i = 0;
      while (i < parts.length) {
        if (/^\\d{8}$/.test(parts[i])) {
          var caseNum = parts[i];
          var customerProject = (parts[i+1] || '').split('\\n')[0].trim();
          var subject = (parts[i+2] || '').split('\\n')[0].trim();
          subject = subject.replace(/\\s*Open .* Preview\\s*$/, '').trim();
          var statusIdx = -1;
          for (var s = i+3; s < Math.min(i+10, parts.length); s++) {
            for (var k = 0; k < statusKeywords.length; k++) {
              if (parts[s].indexOf(statusKeywords[k]) === 0) { statusIdx = s; break; }
            }
            if (statusIdx !== -1) break;
          }
          var status   = statusIdx !== -1 ? parts[statusIdx].split('\\n')[0].trim() : '';
          var priority = statusIdx !== -1 ? (parts[statusIdx+1] || '').split('\\n')[0].trim() : '';
          var dtOpened = statusIdx !== -1 ? (parts[statusIdx+3] || '').split('\\n')[0].trim() : '';
          var dtClosed = statusIdx !== -1 ? (parts[statusIdx+4] || '').split('\\n')[0].trim() : '';
          if (!/\\d{1,2}\\/\\d{1,2}\\/\\d{4}/.test(dtOpened)) dtOpened = '';
          if (!/\\d{1,2}\\/\\d{1,2}\\/\\d{4}/.test(dtClosed))  dtClosed  = '';
          var showActionsIdx = -1;
          for (var s = i+3; s < Math.min(i+30, parts.length); s++) {
            if (parts[s].indexOf('Show Actions') === 0) { showActionsIdx = s; break; }
          }
          rows.push({ caseNum, customerProject, subject, status, priority, dtOpened, dtClosed });
          if (showActionsIdx !== -1) { i = showActionsIdx + 1; }
          else { i += 10; }
          while (i < parts.length && !/^\\d{8}$/.test(parts[i])) i++;
        } else { i++; }
      }
      return rows;
    })()`);

    let results = rows as any[];

    if (daysBack > 0) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - daysBack);
      cutoff.setHours(0, 0, 0, 0);
      results = results.filter((r: any) => {
        if (!r.dtClosed) return false;
        const d = new Date(r.dtClosed);
        return !isNaN(d.getTime()) && d >= cutoff;
      });
    }

    if (countOnly) {
      const label = daysBack > 0
        ? 'Closed cases in last ' + daysBack + ' day(s): ' + results.length
        : 'Total closed cases: ' + results.length;
      process.stdout.write(label + '\n');
      process.exit(0);
    }

    return results.map((r: any, idx: number) => {
      const statusShort = STATUS_SHORT[r.status] || r.status;
      const priShort    = PRIORITY_SHORT[r.priority] || r.priority;
      let subj = r.subject.replace(/^\[([^\]]+)\]\s*/g, '').trim();
      if (!showFull && subj.length > 48) subj = subj.substring(0, 46) + '..';
      const proj = r.customerProject.length > 18
        ? r.customerProject.substring(0, 17) + '..' : r.customerProject;
      return {
        '#': idx + 1,
        case: r.caseNum,
        project: proj,
        subject: subj,
        status: statusShort,
        pri: priShort,
        opened: fmtDt(r.dtOpened),
        closed: fmtDt(r.dtClosed),
      };
    });
  },
});
