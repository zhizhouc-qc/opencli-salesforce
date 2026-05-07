# opencli-salesforce

> Qualcomm Salesforce 自定义 OpenCLI Adapter 集合。
>
> Custom OpenCLI adapters for Qualcomm Salesforce case management — list, view, reply, close, and analyze cases from the terminal.

这些 adapter 安装在 `~/.opencli/clis/salesforce/`，通过 `opencli salesforce <command>` 调用，底层使用 Chrome CDP 自动化操作 Salesforce Lightning UI。

---

## 前置条件 / Prerequisites

- [OpenCLI](https://github.com/jackwener/opencli) 已安装：`npm install -g @jackwener/opencli`
- Chrome 以 CDP 模式运行（端口 9222）：
  ```
  chrome.exe --remote-debugging-port=9222
  ```
- Salesforce 已在 Chrome 中登录（`qualcomm-cdmatech-support.lightning.force.com`）
- `C:\Users\zhizhouc\Documents\sf_case_id_mapping.json`（Case 号 → SF ID 映射，首次运行 `cases-internal` 后自动生成）

---

## 安装 / Installation

将 `.ts` 文件复制到 OpenCLI adapter 目录：

```powershell
Copy-Item *.ts "$env:USERPROFILE\.opencli\clis\salesforce\"
```

---

## 命令列表 / Commands

### 查询类 / Query

| 命令 | 说明 |
|---|---|
| `opencli salesforce cases` | 列出所有 Open Cases（紧凑表格，含 chip/project/status） |
| `opencli salesforce cases-internal` | 列出 Open Cases 内部视图（含 progress、related_crs、scrum_l2、tam_l1） |
| `opencli salesforce case <caseNum>` | 查看单个 Case 详情（所有字段） |
| `opencli salesforce case-summary` | 周报统计：新增/关闭/在途数量及分类 |
| `opencli salesforce closed-cases` | 列出近期已关闭的 Cases |
| `opencli salesforce cases-no-rca` | 列出已关闭但缺少 RCA 的 Cases |
| `opencli salesforce case-status-count` | 按状态统计 Case 数量 |

### 操作类 / Actions

| 命令 | 说明 |
|---|---|
| `opencli salesforce case-reply <caseNum> "<text>"` | 向 Case 发送回复（可同时更新状态） |
| `opencli salesforce case-reply <caseNum> --status "<status>"` | 仅更新 Case 状态，不发回复 |
| `opencli salesforce case-reply <caseNum> --prefix` | 自动补齐 Subject 前缀 `[Chipset][Project]` |
| `opencli salesforce case-attachments <caseNum>` | 列出 Case 附件 |
| `opencli salesforce case-attachments <caseNum> --download` | 下载所有附件 |
| `opencli salesforce case-close-ai <caseNum>` | AI 辅助关闭 Case（生成 RCA + 关闭回复） |
| `opencli salesforce case-close-ai-batch` | 批量 AI 关闭多个 Cases |
| `opencli salesforce case-holiday-close` | 节假日批量关闭 Cases |

### 映射管理 / Mapping

| 命令 | 说明 |
|---|---|
| `opencli salesforce map-case <caseNum> check` | 查询 Case 号对应的 Salesforce ID |
| `opencli salesforce map-case <caseNum> <sfId>` | 手动写入 Case → SF ID 映射 |
| `opencli salesforce config set easywork-dir <path>` | 设置附件下载根目录 |
| `opencli salesforce config list` | 查看当前配置 |

---

## 常用示例 / Examples

```bash
# 列出所有 open cases（表格格式）
opencli salesforce cases -f table

# 获取内部视图（含 L1/L2 escalation 标记）
opencli salesforce cases-internal -f json

# 查看单个 case 详情
opencli salesforce case 08447631

# 发送回复并更新状态
opencli salesforce case-reply 08447631 "Please find the analysis below." --status "Hold-Customer Information Required" --execute

# 下载附件
opencli salesforce case-attachments 08447631 --download

# 周报统计
opencli salesforce case-summary -f table

# 查看 Case → SF ID 映射
opencli salesforce map-case 08447631 check
```

---

## 文件说明 / File Reference

| 文件 | 命令 | 说明 |
|---|---|---|
| `cases.ts` | `cases` | Open Cases 列表（公开视图） |
| `cases-internal.ts` | `cases-internal` | Open Cases 列表（内部视图，含更多字段） |
| `case.ts` | `case` | 单个 Case 详情 |
| `case-reply.ts` | `case-reply` | 发送回复 / 更新状态 / 更新 Subject |
| `case-attachments.ts` | `case-attachments` | 附件列表与下载 |
| `case-attachments-debug.ts` | — | 附件调试版本 |
| `case-summary.ts` | `case-summary` | 周报统计 |
| `case-status-count.ts` | `case-status-count` | 按状态统计 |
| `closed-cases.ts` | `closed-cases` | 已关闭 Cases |
| `cases-no-rca.ts` | `cases-no-rca` | 缺少 RCA 的已关闭 Cases |
| `case-close-ai.ts` | `case-close-ai` | AI 辅助关闭单个 Case |
| `case-close-ai-batch.ts` | `case-close-ai-batch` | AI 辅助批量关闭 |
| `case-holiday-close.ts` | `case-holiday-close` | 节假日批量关闭 |
| `map-case.ts` | `map-case` | Case 号 ↔ SF ID 映射管理 |
| `map-case-check.ts` | — | 映射查询辅助 |
| `config.ts` | `config` | 插件配置管理 |

---

## 数据文件 / Data Files

| 文件 | 说明 |
|---|---|
| `C:\Users\zhizhouc\Documents\sf_case_id_mapping.json` | Case 号 → Salesforce ID 映射缓存，首次运行 `cases-internal` 后自动生成 |
| `C:\Users\zhizhouc\Documents\sf_config.json` | 插件配置（如附件下载目录 `easywork-dir`） |

---

## 注意事项 / Notes

- 所有 UI 操作类命令（`cases`、`case-reply` 等）需要 Chrome CDP 在端口 9222 运行
- `map-case` 和 `config` 不需要浏览器（`Strategy.PUBLIC`）
- `case-reply --execute` 参数才会真正提交，不加则为预览模式
- `cases-internal` 会自动刷新 `sf_case_id_mapping.json`，建议每次操作前先运行一次
