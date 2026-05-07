import { cli, Strategy } from '@jackwener/opencli/registry';
import * as fs from 'fs';
import * as path from 'path';

const SF_BASE = 'https://qualcomm-cdmatech-support.lightning.force.com';
const MAPPING_FILE = 'C:/Users/zhizhouc/Documents/sf_case_id_mapping.json';
const CONFIG_FILE  = 'C:/Users/zhizhouc/Documents/sf_config.json';

function loadConfig(): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')); } catch { return {}; }
}

function loadMapping(): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(MAPPING_FILE, 'utf-8')); } catch { return {}; }
}

cli({
  site: 'salesforce',
  name: 'case-attachments',
  description: '列出或下载指定 Case 的附件',
  domain: 'qualcomm-cdmatech-support.lightning.force.com',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'id',       type: 'str',  required: true,  positional: true,  help: 'Case 编号，如 08442793' },
    { name: 'download', type: 'bool', required: false, positional: false, help: '下载所有附件' },
    { name: 'file',     type: 'str',  required: false, positional: false, help: '只下载指定文件名（模糊匹配）' },
    { name: 'out_dir',  type: 'str',  required: false, positional: false, help: '指定下载目标目录（默认 Downloads/case-attachments/<caseNum>）' },
    { name: 'force',    type: 'bool', required: false, positional: false, help: '强制重新下载，覆盖已存在的文件' },
  ],
  columns: ['#', 'name', 'size', 'url'],
  func: async (page, kwargs) => {
    const caseNum = String(kwargs.id || '').replace(/\D/g, '');
    const mapping = loadMapping();
    if (!mapping[caseNum]) {
      throw new Error(`Case ${caseNum} not found in mapping. Run "opencli salesforce map-case ${caseNum} check" first.`);
    }

    const sfId = mapping[caseNum];
    await page.goto(`${SF_BASE}/lightning/r/Case/${sfId}/related/File_Attachments__r/view?ws=%2Flightning%2Fr%2FCase%2F${sfId}%2Fview`);
    await page.wait(8);

    for (let i = 0; i < 10; i++) {
      const ready = await page.evaluate(`(()=>{ const t=document.body?document.body.innerText:''; return t.includes('File Attachments')||t.includes('File Name'); })()`);
      if (ready) break;
      await page.wait(2);
    }

    const filesRaw = await page.evaluate(`(()=>{
      const text = document.body ? document.body.innerText : '';
      const results = [];
      const start = text.indexOf('File Attachments');
      if (start < 0) return JSON.stringify([]);
      const section = text.substring(start, start + 8000);
      const lines = section.split('\\n').map(function(l){ return l.trim(); }).filter(Boolean);
      for (var i = 0; i < lines.length; i++) {
        if (!/^Select Item \\d+$/.test(lines[i])) continue;
        var name = lines[i+1] || '';
        if (!name || name.length < 2) continue;
        if (/^(File Name|Description|Visible|File Size|Customer|Uploaded|Import|Show Actions|Navigation|Choose|Sort by)/.test(name)) continue;
        var size = '';
        for (var j = i+2; j < Math.min(i+8, lines.length); j++) {
          if (/^\\d+(\\.\\d+)?\\s*(KB|MB|GB|B)$/i.test(lines[j])) { size = lines[j]; break; }
        }
        results.push({ name: name, size: size });
      }
      return JSON.stringify(results);
    })()`);

    let files: any[] = [];
    try {
      const raw = JSON.parse(String(filesRaw || '[]'));
      // Deduplicate by name, keep first occurrence with size
      const seen = new Set<string>();
      for (const f of raw) {
        if (seen.has(f.name)) continue;
        seen.add(f.name);
        files.push(f);
      }
    } catch {}

    const downloadLinks = await page.evaluate(`(()=>{ const allRoots=[]; const walk=(root)=>{ if(!root||allRoots.includes(root)) return; allRoots.push(root); const nodes=root.querySelectorAll?root.querySelectorAll('*'):[]; for(const node of nodes){ if(node.shadowRoot) walk(node.shadowRoot); } }; walk(document); const links={}; for(const root of allRoots){ if(!root.querySelectorAll) continue; for(const a of root.querySelectorAll('a[href]')){ const href=a.getAttribute('href')||''; const name=(a.getAttribute('title')||a.textContent||'').trim(); if((href.includes('shepherd')&&href.includes('download'))||href.includes('sfc/servlet')){ links[name]=href; } } } return JSON.stringify(links); })()`);

    let dlMap: Record<string, string> = {};
    try { dlMap = JSON.parse(String(downloadLinks || '{}')); } catch {}

    const doDownload = kwargs.download === true;
    const forceDownload = kwargs.force === true;
    const fileFilter = String(kwargs.file || '').toLowerCase();
    const config = loadConfig();
    const easyworkRoot = config['easywork-dir'] || '';
    const outDir = kwargs.out_dir
      ? path.join(String(kwargs.out_dir), caseNum)
      : path.join(process.env.USERPROFILE || '.', 'Downloads', 'case-attachments', caseNum);

    // Scan EasyWork directory for already-downloaded files:
    // pattern: <easyworkRoot>/<account>/<caseNum>/<filename>
    const findInEasywork = (fileName: string): string | null => {
      if (!easyworkRoot) return null;
      try {
        for (const account of fs.readdirSync(easyworkRoot)) {
          const candidate = path.join(easyworkRoot, account, caseNum, fileName);
          if (fs.existsSync(candidate)) return candidate;
        }
      } catch (_) {}
      return null;
    };

    const findAllInEasywork = (): Array<{name: string, full: string}> => {
      if (!easyworkRoot) return [];
      const found: Array<{name: string, full: string}> = [];
      try {
        for (const account of fs.readdirSync(easyworkRoot)) {
          const dir = path.join(easyworkRoot, account, caseNum);
          try {
            for (const e of fs.readdirSync(dir)) {
              const full = path.join(dir, e);
              if (fs.statSync(full).isFile()) found.push({ name: e, full });
            }
          } catch (_) {}
        }
      } catch (_) {}
      return found;
    };

    if (files.length === 0) {
      return [{ '#': 0, name: '(no attachments found)', size: '', url: '' }];
    }

    const toShow = fileFilter
      ? files.filter((f: any) => (f.name || '').toLowerCase().includes(fileFilter))
      : files;

    if (fileFilter && toShow.length === 0) {
      const allNames = files.map((f: any) => f.name).join(', ');
      return [{ '#': 0, name: `no files matching "${fileFilter}"`, size: '', url: `available: ${allNames}` }];
    }

    if (!doDownload) {
      return toShow.map((f: any, i: number) => {
        const inOutDir   = fs.existsSync(path.join(outDir, f.name));
        const inEasywork = findInEasywork(f.name);
        const location   = inEasywork ? inEasywork : inOutDir ? path.join(outDir, f.name) : null;
        return {
          '#': i + 1,
          name: f.name,
          size: f.size,
          url: location ? `already at ${location}` : '(use --download to download)',
        };
      });
    }

    // Skip files already downloaded unless --force
    const toDownload = toShow.filter((f: any) => forceDownload || (!fs.existsSync(path.join(outDir, f.name)) && !findInEasywork(f.name)));
    if (toDownload.length === 0) {
      return toShow.map((f: any, i: number) => {
        const inEasywork = findInEasywork(f.name);
        const location   = inEasywork ? inEasywork : path.join(outDir, f.name);
        return { '#': i + 1, name: f.name, size: f.size, url: `already at ${location} (use --force to re-download)` };
      });
    }

    const defaultDownloadDir = path.join(process.env.USERPROFILE || '.', 'Downloads');
    const easyworkCaseDir = easyworkRoot
      ? (() => {
          try {
            for (const account of fs.readdirSync(easyworkRoot)) {
              const d = path.join(easyworkRoot, account, caseNum);
              if (fs.existsSync(d)) return d;
            }
          } catch (_) {}
          return null;
        })()
      : null;

    // Get checkbox coordinates for each file row
    const cbMap = await page.evaluate(`(()=>{
      const allRoots = [];
      const walk = (root) => {
        if (!root || allRoots.includes(root)) return;
        allRoots.push(root);
        const nodes = root.querySelectorAll ? root.querySelectorAll('*') : [];
        for (const node of nodes) { if (node.shadowRoot) walk(node.shadowRoot); }
      };
      walk(document);
      const result = [];
      for (const root of allRoots) {
        if (!root.querySelectorAll) continue;
        for (const cb of root.querySelectorAll('input[type="checkbox"]')) {
          const rect = cb.getBoundingClientRect();
          if (rect.top === 0 && rect.left === 0 && rect.width === 0) continue;
          const row = cb.closest('tr, [role="row"]') || cb.parentElement;
          const rowText = (row ? (row.innerText || row.textContent || '') : '').trim();
          result.push({ x: Math.round(rect.left) + 1, y: Math.round(rect.top) + 1, row: rowText });
        }
      }
      return JSON.stringify(result);
    })()`);

    // Click only the checkboxes for files that need downloading
    const needNames = (toDownload as any[]).map((f: any) => f.name);
    try {
      const cbList: Array<{x: number, y: number, row: string}> = JSON.parse(String(cbMap || '[]'));
      if (page.nativeClick) {
        for (const cb of cbList) {
          const matched = needNames.some((n: string) => cb.row.includes(n));
          if (matched) {
            await page.nativeClick(cb.x, cb.y);
            await page.wait(0.5);
          }
        }
      }

    } catch {}

    // Click the Download button (select all checkboxes first)
    const clicked = await page.evaluate(`(()=>{
      const norm = (v) => (v || '').replace(/\u200b/g, '').replace(/\s+/g, ' ').trim();
      const allRoots = [];
      const walk = (root) => {
        if (!root || allRoots.includes(root)) return;
        allRoots.push(root);
        const nodes = root.querySelectorAll ? root.querySelectorAll('*') : [];
        for (const node of nodes) { if (node.shadowRoot) walk(node.shadowRoot); }
      };
      walk(document);
      for (const root of allRoots) {
        if (!root.querySelectorAll) continue;
        for (const btn of root.querySelectorAll('button, a')) {
          if (norm(btn.innerText || btn.textContent) === 'Download') { btn.click(); return true; }
        }
      }
      return false;
    })()`);

    if (!clicked) {
      return toDownload.map((f: any, i: number) => ({
        '#': i + 1, name: f.name, size: f.size, url: 'Download button not found',
      }));
    }

    // Wait for EasyWork to save files, then return their actual paths
    const before = Date.now() - 10000;
    const waitForFiles = async (): Promise<Array<{name: string, full: string}>> => {
      const found: Array<{name: string, full: string}> = [];
      // Check EasyWork directory (preferred)
      if (easyworkRoot) {
        try {
          for (const account of fs.readdirSync(easyworkRoot)) {
            const caseDir = path.join(easyworkRoot, account, caseNum);
            try {
              for (const e of fs.readdirSync(caseDir)) {
                if (e.endsWith('.crdownload') || e.endsWith('.tmp')) continue;
                const full = path.join(caseDir, e);
                const s = fs.statSync(full);
                // Match by name against files we need to download
                const needsDownload = (toDownload as any[]).some((f: any) => f.name === e || e.replace(/\s*\(\d+\)/, '') === f.name);
                if (s.isFile() && needsDownload) found.push({ name: e, full });
              }
            } catch (_) {}
          }
        } catch (_) {}
      }
      // Fallback: check default Downloads dir for new files
      if (found.length === 0) {
        try {
          for (const e of fs.readdirSync(defaultDownloadDir)) {
            if (e.endsWith('.crdownload') || e.endsWith('.tmp')) continue;
            const full = path.join(defaultDownloadDir, e);
            const s = fs.statSync(full);
            if (s.isFile() && s.mtimeMs > before) found.push({ name: e, full });
          }
        } catch (_) {}
      }
      return found;
    };

    // Poll until all expected files appear (up to 60s)
    let downloadedFiles: Array<{name: string, full: string}> = [];
    for (let w = 0; w < 40; w++) {
      await page.wait(3);
      downloadedFiles = await waitForFiles();
      if (downloadedFiles.length >= toDownload.length) break;
    }

    return toDownload.map((f: any, i: number) => {
      const match = downloadedFiles.find(d => d.name === f.name || d.name.replace(/\s*\(\d+\)/, '') === f.name);
      return {
        '#': i + 1,
        name: f.name,
        size: f.size,
        url: match ? match.full : 'download may still be in progress',
      };
    });
  },
});
