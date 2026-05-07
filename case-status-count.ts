import { cli, Strategy } from '@jackwener/opencli/registry';

const SF_BASE = 'https://qualcomm-cdmatech-support.lightning.force.com';
const LIST_URL = SF_BASE + '/lightning/o/Case/list?filterName=Copy_of_My_Open_Cases_Internal52';

cli({
  site: 'salesforce',
  name: 'case-status-count',
  description: 'Count open cases grouped by status (shows Closed-Pending, Hold, Research, etc.)',
  domain: 'qualcomm-cdmatech-support.lightning.force.com',
  strategy: Strategy.UI,
  browser: true,
  args: [],
  defaultFormat: 'table',
  columns: ['status', 'count'],
  func: async (page, _kwargs) => {
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

    const result = await page.evaluate(`(()=>{
      if (!document.body) return {};
      var parts = document.body.innerText.split('\\t').map(function(s){ return s.trim(); }).filter(Boolean);
      var statusKeywords = [
        'Closed-Pending Your Approval',
        'Customer Updated Case',
        'Hold-Customer Information Required',
        'Research-Internal Support',
        'Open', 'New', 'Closed', 'Resolved', 'Pending'
      ];
      var counts = {};
      parts.forEach(function(p) {
        for (var k = 0; k < statusKeywords.length; k++) {
          if (p.indexOf(statusKeywords[k]) === 0) {
            var key = p.split('\\n')[0].trim();
            counts[key] = (counts[key] || 0) + 1;
            break;
          }
        }
      });
      return counts;
    })()`);

    const counts = result as Record<string, number>;

    const STATUS_LABEL: Record<string, string> = {
      'Closed-Pending Your Approval':       'Closed-Pending',
      'Customer Updated Case':              'Customer Updated',
      'Hold-Customer Information Required': 'Hold',
      'Research-Internal Support':          'Research',
      'Open':     'Open',
      'New':      'New',
      'Closed':   'Closed',
      'Resolved': 'Resolved',
      'Pending':  'Pending',
    };

    const ORDER = [
      'Closed-Pending Your Approval',
      'Customer Updated Case',
      'Hold-Customer Information Required',
      'Research-Internal Support',
      'Open', 'New', 'Closed', 'Resolved', 'Pending',
    ];

    const rows: { status: string; count: number }[] = [];
    let total = 0;
    for (const key of ORDER) {
      if (counts[key]) {
        rows.push({ status: STATUS_LABEL[key] || key, count: counts[key] });
        total += counts[key];
      }
    }
    // Any unexpected statuses
    for (const [key, val] of Object.entries(counts)) {
      if (!ORDER.includes(key)) {
        rows.push({ status: key, count: val });
        total += val;
      }
    }
    rows.push({ status: '── TOTAL', count: total });
    return rows;
  },
});
