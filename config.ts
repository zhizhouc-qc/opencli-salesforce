import { cli, Strategy } from '@jackwener/opencli/registry';
import * as fs from 'fs';
import * as path from 'path';

const CONFIG_FILE = 'C:/Users/zhizhouc/Documents/sf_config.json';

function loadConfig(): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')); } catch { return {}; }
}
function saveConfig(c: Record<string, string>) {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2)); } catch {}
}

const KNOWN_KEYS = ['easywork-dir'];

cli({
  site: 'salesforce',
  name: 'config',
  description: 'salesforce 插件配置管理。用法: config set <key> <value> | config get <key> | config list',
  domain: 'qualcomm-cdmatech-support.lightning.force.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'action', type: 'str', required: true,  positional: true, help: 'set / get / list' },
    { name: 'key',    type: 'str', required: false, positional: true, help: '配置项名称，如 easywork-dir' },
    { name: 'value',  type: 'str', required: false, positional: true, help: '配置项值' },
  ],
  columns: ['key', 'value'],
  func: async (_page, kwargs) => {
    const action = String(kwargs.action || '').trim().toLowerCase();
    const key    = String(kwargs.key   || '').trim();
    const value  = String(kwargs.value || '').trim();
    const config = loadConfig();

    if (action === 'list') {
      if (Object.keys(config).length === 0) return [{ key: '(empty)', value: '' }];
      return Object.entries(config).map(([k, v]) => ({ key: k, value: v }));
    }

    if (action === 'get') {
      if (!key) return [{ key: 'error', value: 'usage: config get <key>' }];
      return [{ key, value: config[key] ?? '(not set)' }];
    }

    if (action === 'set') {
      if (!key || !value) return [{ key: 'error', value: 'usage: config set <key> <value>' }];
      config[key] = value;
      saveConfig(config);
      return [{ key, value: `saved: ${value}` }];
    }

    if (action === 'unset') {
      if (!key) return [{ key: 'error', value: 'usage: config unset <key>' }];
      delete config[key];
      saveConfig(config);
      return [{ key, value: 'removed' }];
    }

    return [{ key: 'error', value: `unknown action "${action}". Use: set / get / list / unset` }];
  },
});
