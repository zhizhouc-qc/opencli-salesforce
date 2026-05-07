import { cli, Strategy } from '@jackwener/opencli/registry';

const SF_BASE = 'https://qualcomm-cdmatech-support.lightning.force.com';
const OPEN_URL   = SF_BASE + '/lightning/o/Case/list?filterName=Copy_of_My_Open_Cases_Internal52';
const CLOSED_URL = SF_BASE + '/lightning/o/Case/list?filterName=Copy_of_My_Closed_Cases_Internal46';

cli({
  site: 'salesforce',
  name: 'case-summary',
  description: 'Weekly summary: closed count, closed-pending, on-going breakdown, open-age stats',
  domain: 'qualcomm-cdmatech-support.lightning.force.com',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'days', type: 'int', required: false, positional: false, help: 'Days back for closed filter (default: 7)' },
  ],
  defaultFormat: 'table',
  columns: ['metric', 'value'],
  func: async (page, kwargs) => {
    const daysBack: number = kwargs.days ? Number(kwargs.days) : 7;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysBack);
    cutoff.setHours(0, 0, 0, 0);

    async function forceRender() {
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
    }

    async function waitForRows() {
      for (let i = 0; i < 15; i++) {
        const n = await page.evaluate(`(()=>{
          if (!document || !document.body) return 0;
          var parts = document.body.innerText.split('\\t').map(function(s){ return s.trim(); }).filter(Boolean);
          return parts.filter(function(p){ return /^\\d{8}$/.test(p); }).length;
        })()`);
        if ((n as number) >= 1) break;
        await page.wait(2);
      }
    }

    // Extract rows from open-cases list: status + dtOpened
    async function extractOpenRows(): Promise<Array<{caseNum:string; status:string; dtOpened:string}>> {
      const rows = await page.evaluate(`(()=>{
        if (!document.body) return [];
        var parts = document.body.innerText.split('\\t').map(function(s){ return s.trim(); }).filter(Boolean);
        var statusKeywords = [
          'Closed-Pending Your Approval','Customer Updated Case',
          'Hold-Customer Information Required','Research-Internal Support',
          'Open','New','Closed','Resolved','Pending'
        ];
        var rows = [];
        var i = 0;
        while (i < parts.length) {
          if (/^\\d{8}$/.test(parts[i])) {
            var caseNum = parts[i];
            var statusIdx = -1;
            for (var s = i+2; s < Math.min(i+8, parts.length); s++) {
              for (var k = 0; k < statusKeywords.length; k++) {
                if (parts[s].indexOf(statusKeywords[k]) === 0) { statusIdx = s; break; }
              }
              if (statusIdx !== -1) break;
            }
            var status   = statusIdx !== -1 ? parts[statusIdx].split('\\n')[0].trim() : '';
            var dtOpened = statusIdx !== -1 ? (parts[statusIdx+1] || '').split('\\n')[0].trim() : '';
            if (!/\\d{1,2}\\/\\d{1,2}\\/\\d{4}/.test(dtOpened)) dtOpened = '';
            var showActionsIdx = -1;
            for (var s = i+2; s < Math.min(i+30, parts.length); s++) {
              if (parts[s].indexOf('Show Actions') === 0) { showActionsIdx = s; break; }
            }
            rows.push({ caseNum, status, dtOpened });
            if (showActionsIdx !== -1) { i = showActionsIdx + 1; }
            else { i += 10; }
            while (i < parts.length && !/^\\d{8}$/.test(parts[i])) i++;
          } else { i++; }
        }
        return rows;
      })()`);
      return rows as any[];
    }

    // Extract rows from closed-cases list: dtOpened + dtClosed
    async function extractClosedRows(): Promise<Array<{caseNum:string; dtOpened:string; dtClosed:string}>> {
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
            var statusIdx = -1;
            for (var s = i+3; s < Math.min(i+10, parts.length); s++) {
              for (var k = 0; k < statusKeywords.length; k++) {
                if (parts[s].indexOf(statusKeywords[k]) === 0) { statusIdx = s; break; }
              }
              if (statusIdx !== -1) break;
            }
            var dtOpened = statusIdx !== -1 ? (parts[statusIdx+3] || '').split('\\n')[0].trim() : '';
            var dtClosed = statusIdx !== -1 ? (parts[statusIdx+4] || '').split('\\n')[0].trim() : '';
            if (!/\\d{1,2}\\/\\d{1,2}\\/\\d{4}/.test(dtOpened)) dtOpened = '';
            if (!/\\d{1,2}\\/\\d{1,2}\\/\\d{4}/.test(dtClosed))  dtClosed  = '';
            var showActionsIdx = -1;
            for (var s = i+3; s < Math.min(i+30, parts.length); s++) {
              if (parts[s].indexOf('Show Actions') === 0) { showActionsIdx = s; break; }
            }
            rows.push({ caseNum, dtOpened, dtClosed });
            if (showActionsIdx !== -1) { i = showActionsIdx + 1; }
            else { i += 10; }
            while (i < parts.length && !/^\\d{8}$/.test(parts[i])) i++;
          } else { i++; }
        }
        return rows;
      })()`);
      return rows as any[];
    }

    // ── PAGE 1: Open cases list ───────────────────────────────────────────
    await page.goto(OPEN_URL);
    await page.wait(8);
    await forceRender();
    await waitForRows();
    const openRows = await extractOpenRows();

    // ── PAGE 2: Closed cases list ─────────────────────────────────────────
    await page.goto(CLOSED_URL);
    await page.wait(8);
    await forceRender();
    await waitForRows();
    const closedRows = await extractClosedRows();

    // Filter closed by dtClosed within last N days
    const recentlyClosed = closedRows.filter(r => {
      if (!r.dtClosed) return false;
      const d = new Date(r.dtClosed);
      return !isNaN(d.getTime()) && d >= cutoff;
    });

    // Categorise open-list rows
    const closedPending = openRows.filter(r => r.status === 'Closed-Pending Your Approval');
    const onGoing       = openRows.filter(r => r.status !== 'Closed-Pending Your Approval');

    // Status breakdown for on-going
    const statusBreakdown: Record<string, number> = {};
    for (const r of onGoing) {
      const s = r.status || 'Unknown';
      statusBreakdown[s] = (statusBreakdown[s] || 0) + 1;
    }

    // Open-age stats: combine open-list cases + recently closed cases
    // Use dtOpened from both lists
    const allForAge = [
      ...openRows.map(r => r.dtOpened),
      ...recentlyClosed.map(r => r.dtOpened),
    ];
    const now = new Date();
    const ages: number[] = allForAge
      .filter(dt => !!dt)
      .map(dt => Math.floor((now.getTime() - new Date(dt).getTime()) / 86400000))
      .filter(d => d >= 0)
      .sort((a, b) => a - b);

    function median(arr: number[]) {
      if (!arr.length) return 0;
      const mid = Math.floor(arr.length / 2);
      return arr.length % 2 ? arr[mid] : Math.round((arr[mid-1] + arr[mid]) / 2);
    }
    const avgAge = ages.length ? Math.round(ages.reduce((a,b)=>a+b,0) / ages.length) : 0;
    const medAge = median(ages);
    const maxAge = ages.length ? ages[ages.length-1] : 0;

    const STATUS_SHORT: Record<string,string> = {
      'Customer Updated Case':              'Customer Updated',
      'Hold-Customer Information Required': 'Hold',
      'Research-Internal Support':          'Research',
      'Open': 'Open', 'New': 'New', 'Pending': 'Pending',
    };

    // Count cases opened within last N days (from both lists)
    const newlyOpened = [
      ...openRows.filter(r => {
        if (!r.dtOpened) return false;
        const d = new Date(r.dtOpened);
        return !isNaN(d.getTime()) && d >= cutoff;
      }),
      ...recentlyClosed,
    ].length;

    const out: {metric: string; value: string|number}[] = [
      { metric: '🆕 Newly opened (last ' + daysBack + 'd)', value: newlyOpened },
      { metric: '📋 Closed (last ' + daysBack + 'd)',  value: recentlyClosed.length },
      { metric: '⏳ Closed-Pending Approval',          value: closedPending.length },
      { metric: '✅ Closed Total',                     value: recentlyClosed.length + closedPending.length },
      { metric: '─────────────────────',               value: '─────' },
    ];
    for (const [status, cnt] of Object.entries(statusBreakdown).sort((a,b)=>b[1]-a[1])) {
      out.push({ metric: '  ' + (STATUS_SHORT[status] || status), value: cnt });
    }
    out.push({ metric: '🔄 On-going Total',            value: onGoing.length });
    out.push({ metric: '─────────────────────',        value: '─────' });
    out.push({ metric: '📅 Cases tracked (total)',     value: openRows.length + recentlyClosed.length });
    out.push({ metric: '📅 Avg open age (days)',       value: avgAge });
    out.push({ metric: '📅 Median open age (days)',    value: medAge });
    out.push({ metric: '📅 Max open age (days)',       value: maxAge });

    return out;
  },
});
