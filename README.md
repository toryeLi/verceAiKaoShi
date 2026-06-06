# AI 出库单规则导入工作台

基于 `Next.js App Router + TypeScript` 实现，围绕考试题要求提供：

- 规则驱动导入
- `Excel / Word / PDF` 多格式上传
- AI/启发式规则建议
- 试解析预览与在线编辑
- 全量校验、导出、提交入库
- 历史运单查询

## 当前实现范围

这版已经完成题目主链：

- 规则管理：创建、编辑、删除、服务端持久化
- 多格式入口：`.xlsx / .xls / .docx / .pdf`
- 规则建议：优先调用大模型，未配置时自动回退到启发式
- 试解析：按规则输出结构化明细
- 在线预览：表格编辑、全量错误展示、导出 Excel
- 提交下单：批量写入 PostgreSQL
- 历史列表：搜索、日期筛选、分页、清空

## 样例预设规则

已内置一批更贴近 `doc/demos` 的预设规则：

- `样例预设 - 湖南仓汇总单`
- `样例预设 - 黎明屯配送发货单`
- `样例预设 - 欢乐牧场矩阵模板`
- `样例预设 - 黔寨寨 PDF 配送单`
- `多 Sheet 门店出库单`
- `卡片式调拨单`

这些规则不是把文件名硬编码进解析逻辑，而是把样例中的结构规律沉淀为规则配置：

- 表头行位置
- 多 Sheet 遍历
- 矩阵列展开
- 卡片边界拆分
- PDF/纯文本正则提取
- 顶部/尾部共享信息抽取

## 大模型接入

系统会优先读取以下配置：

```bash
LLM_API_KEY=
LLM_API_URL=
LLM_MODEL=
```

也兼容：

```bash
OPENAI_API_KEY=
OPENAI_BASE_URL=
OPENAI_MODEL=
```

或：

```bash
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=
DEEPSEEK_MODEL=
```

前端页面会显示当前规则建议引擎状态：

- `LLM 已接入`
- `当前使用启发式`

并展示：

- provider
- model
- base URL

## 环境变量

数据库至少配置一个：

```bash
DATABASE_URL=
```

也支持：

```bash
POSTGRES_URL=
PRISMA_DATABASE_URL=
```

完整示例见 `.env.example`。

## 本地启动

1. 安装依赖

```bash
npm install
```

2. 配置环境变量

```bash
copy .env.example .env.local
```

3. 启动开发环境

```bash
npm run dev
```

4. 生产构建

```bash
npm run build
```

## 数据库表

项目会自动创建：

- `import_orders`
- `import_rules`

其中：

- `import_orders` 保存导入后的结构化明细
- `import_rules` 保存规则配置 JSON

## 主要目录

- `src/components/order-workbench.tsx`
  前端主工作台
- `src/lib/import-parser.ts`
  统一文档抽取与规则解析
- `src/lib/import-rules.ts`
  规则预设与规则仓储
- `src/lib/ai-rule-suggester.ts`
  大模型规则建议
- `src/lib/orders.ts`
  字段定义与校验
- `src/lib/orders-repository.ts`
  数据入库与历史查询
- `src/app/api/import-rules/*`
  规则管理与规则建议接口
- `src/app/api/import-preview/route.ts`
  按规则试解析接口

## 当前验证结果

- `npm run lint` 已通过
- `npm run build` 已通过

## 说明

当前版本已经补上你刚才要求的两类内容：

1. `doc/demos` 的样例级规则预设
2. 正式的大模型接入配置、状态展示和启发式回退

如果还要继续往前推，下一步最有价值的是：

- 针对每个 demo 做更细的命中测试和规则微调
- 增加“规则试解析对比视图”，方便人工确认 AI 生成规则是否可靠
