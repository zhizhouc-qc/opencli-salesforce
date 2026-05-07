import { cli, Strategy } from '@jackwener/opencli/registry';
import * as fs from 'fs';

const SF_BASE = 'https://qualcomm-cdmatech-support.lightning.force.com';
const MAPPING_FILE = 'C:/Users/zhizhouc/Documents/sf_case_id_mapping.json';

function loadMapping(): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(MAPPING_FILE, 'utf-8')); } catch { return {}; }
}

cli({
  site: 'salesforce',
  name: 'case-attachments-debug',
  description: '打开 Case 后触发 a 快捷键，输出 attachments 页面可见文本和链接调试信息',
  domain: 'qualcomm-cdmatech-support.lightning.force.com',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'id', type: 'str', required: true, positional: true, help: 'Case 编号，如 08457593' },
  ],
  columns: ['key', 'value'],
  func: async (page, kwargs) => {
    const caseNum = String(kwargs.id || '').replace(/\D/g, '');
    const mapping = loadMapping();
    if (!mapping[caseNum]) {
      throw new Error(`Case ${caseNum} not found in mapping. Run "opencli salesforce map-case ${caseNum} check" first.`);
    }

    await page.goto(`${SF_BASE}/lightning/r/Case/${mapping[caseNum]}/view`);
    await page.wait(10);

    if (page.nativeClick) {
      try { await page.nativeClick(960, 500); } catch {}
      await page.wait(0.5);
    }
    if (page.nativeKeyPress) {
      try { await page.nativeKeyPress('a'); } catch {}
      await page.wait(8);
    }

    const textSnippet = await page.evaluate(`(()=>{ return (document.body ? document.body.innerText : '').substring(0, 3000); })()`);
    const linksSnippet = await page.evaluate(`(()=>{
      var allRoots=[document]; var ri=0;
      while(ri<allRoots.length){
        var root=allRoots[ri++];
        if(!root||!root.querySelectorAll) continue;
        root.querySelectorAll('*').forEach(function(el){ if(el.shadowRoot) allRoots.push(el.shadowRoot); });
      }
      var out=[];
      for(var i=0;i<allRoots.length;i++){
        if(!allRoots[i].querySelectorAll) continue;
        Array.from(allRoots[i].querySelectorAll('a[href]')).forEach(function(a){
          var txt=(a.textContent||'').trim().substring(0,30);
          var href=(a.getAttribute('href')||'').substring(0,120);
          if(href && href.indexOf('javascript')<0) out.push(txt + '=' + href);
        });
      }
      return out.slice(0, 40).join(' | ');
    })()`);

    return [
      { key: 'case', value: caseNum },
      { key: 'url', value: String(await page.evaluate('location.href')) },
      { key: 'text', value: String(textSnippet) },
      { key: 'links', value: String(linksSnippet) },
    ];
  },
});
