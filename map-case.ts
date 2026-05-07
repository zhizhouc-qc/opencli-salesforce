import { cli, Strategy } from '@jackwener/opencli/registry';
import * as fs from 'fs';

const SF_BASE = 'https://qualcomm-cdmatech-support.lightning.force.com';
const MAPPING_FILE = 'C:/Users/zhizhouc/Documents/sf_case_id_mapping.json';

function loadMapping(): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(MAPPING_FILE, 'utf-8')); } catch { return {}; }
}
function saveMapping(m: Record<string, string>) {
  try { fs.writeFileSync(MAPPING_FILE, JSON.stringify(m, null, 2)); } catch {}
}

cli({
  site: 'salesforce',
  name: 'map-case',
  description: '查询或写入 Case -> Salesforce ID 映射。用法: map-case <caseNum> [check|<sfId>]',
  domain: 'qualcomm-cdmatech-support.lightning.force.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'caseNum', type: 'str', required: true,  positional: true, help: 'Case 编号，如 08420962' },
    { name: 'sfId',    type: 'str', required: false, positional: true, help: '"check" 查询当前映射，或填入 SF ID / 完整链接写入映射' },
  ],
  columns: ['case', 'sfId', 'status', 'url'],
  func: async (_page, kwargs) => {
    const caseNum = String(kwargs.caseNum || '').replace(/\D/g, '');
    if (!/^\d{8}$/.test(caseNum)) {
      return [{ case: caseNum, sfId: '', status: 'error: case number must be 8 digits', url: '' }];
    }

    const mapping = loadMapping();
    const second = String(kwargs.sfId || '').trim();

    if (!second || second.toLowerCase() === 'check') {
      const sfId = mapping[caseNum] || '';
      const url = sfId ? `${SF_BASE}/lightning/r/Case/${sfId}/view` : '';
      return [{ case: caseNum, sfId: sfId || '(MISSING)', status: sfId ? 'mapped' : 'not mapped', url }];
    }

    let sfId = second;
    const urlMatch = sfId.match(/\/(500[a-zA-Z0-9]{12,15})/);
    if (urlMatch) sfId = urlMatch[1];
    if (!/^500[a-zA-Z0-9]{12,15}$/.test(sfId)) {
      return [{ case: caseNum, sfId, status: 'error: SF ID must start with 500 and be 15-18 chars', url: '' }];
    }

    const prev = mapping[caseNum];
    mapping[caseNum] = sfId;
    saveMapping(mapping);

    const url = `${SF_BASE}/lightning/r/Case/${sfId}/view`;
    const statusMsg = prev && prev !== sfId ? `updated (was ${prev})` : prev === sfId ? 'unchanged' : 'added';
    return [{ case: caseNum, sfId, status: statusMsg, url }];
  },
});
