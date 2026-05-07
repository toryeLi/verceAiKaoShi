# 多模板 Excel 自动导入下单系统

基于 `Next.js App Router + TypeScript` 实现，支持多模板 Excel 导入、映射记忆、在线预览编辑、全量校验、导出 Excel、提交入库和历史运单查询。

## 功能概览

- 支持 `.xlsx / .xls` 上传与拖拽导入
- 自动识别不同表头命名、列顺序、说明行、多 Sheet、英文模板、分组表头
- 支持手动列映射，映射关系写入本地模板记忆
- 导入后进入类 Excel 预览表格，支持直接编辑、删除行、新增空行
- 实时校验必填项、手机号、重量、件数、温层
- 一次性展示全部错误信息
- 支持当前预览数据导出为 Excel
- 提交时写入 PostgreSQL 数据库
- 支持历史运单列表、关键词搜索、日期筛选、分页

## 技术栈

- Next.js 16 App Router
- TypeScript
- React 19
- `xlsx`
- `zod`
- `postgres`

## 本地启动

1. 安装依赖

```bash
npm install
```

2. 配置环境变量

复制 `.env.example` 为 `.env.local`，填入你自己的数据库连接串。

推荐至少配置一个：

```bash
DATABASE_URL=...
```

系统也兼容：

```bash
POSTGRES_URL=...
PRISMA_DATABASE_URL=...
```

3. 启动开发环境

```bash
npm run dev
```

4. 构建生产版本

```bash
npm run build
```

## 数据库说明

项目首次调用接口时会自动执行建表逻辑，创建：

- `orders` 表
- `orders_external_code_unique` 唯一索引
- `orders_submitted_at_idx` 时间索引

说明：

- `external_code` 允许为空
- 非空 `external_code` 会做唯一约束

## 主要目录

- `src/components/order-workbench.tsx`
  前端工作台界面
- `src/lib/excel.ts`
  Excel 解析与导出
- `src/lib/orders.ts`
  字段定义、自动映射、校验逻辑
- `src/lib/orders-repository.ts`
  数据库读写
- `src/app/api/orders/route.ts`
  提交下单接口
- `src/app/api/orders/duplicates/route.ts`
  数据库重复编码检测接口
- `src/app/api/history/route.ts`
  历史记录查询接口

## Vercel 部署

1. 将项目推送到 GitHub / GitLab / Gitee
2. 在 Vercel 导入仓库
3. 在 Vercel 项目环境变量中配置：

```bash
DATABASE_URL=你的数据库连接串
```

也可以只配：

```bash
POSTGRES_URL=你的数据库连接串
```

或：

```bash
PRISMA_DATABASE_URL=你的数据库连接串
```

4. 执行部署

## 考试反思题参考

### 1. 这个需求里最容易被忽略的 3 个细节点

1. 模板并不一定从第 1 行开始就是表头。
原因：很多人默认第一行就是列名，但实际模板可能前面有说明文字、标题行、合并单元格。

2. 外部编码重复不只要检查当前批次，还要检查数据库历史数据。
原因：只做前端本批次去重很常见，但题目明确要求和已存在数据比较。

3. 错误提示必须一次性列出全部问题，而不是一次只报一个。
原因：很多表单校验天然是逐项提示，放到批量导入场景就会严重影响修正效率。

### 2. 如果纯人工编码，不借助 AI，大概需要多久

如果从零开始，包含需求拆解、项目搭建、Excel 模板适配、前后端联调、数据库接入、部署和自测，合理预估是 `1.5 到 2.5 天`。

理由：

- Excel 多模板解析和表头识别本身就需要反复测试
- 在线表格编辑和错误高亮有较多交互细节
- 数据库、接口、分页、筛选、部署都需要额外时间
- 真正耗时的不是写页面，而是覆盖边界情况和验收细节

## 当前状态

- `npm run lint` 已通过
- `npm run build` 已通过
- 尚未包含真实线上 URL 和仓库地址，这两项需要在你实际部署后补充
