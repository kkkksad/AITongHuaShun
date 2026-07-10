# React Workbench Rebuild

**状态：** 完成
**日期：** 2026-07-11

## 目标

使用 React + TypeScript 恢复缺失的 `src/`，让 KAIROS Quant 原型重新具备可运行、可测试和可构建的前端。

## 实施记录

- [x] 安装 npm 依赖并复现 `src/` 缺失导致的构建失败。
- [x] 建立领域类型、统一模拟数据和确定性回测内核。
- [x] 建立总览、策略、市场、账户和研究管线五个视图。
- [x] 增加参数滑块、策略切换、回测运行和账户暂停交互。
- [x] 使用 Recharts 绘制净值、分时、成交量和资金流图表。
- [x] 完成桌面、平板和手机断点样式。
- [x] 增加回测确定性和最大回撤测试。
- [x] 运行测试、生产构建和本地页面结构检查。

## 验证结果

```text
npm test
4 tests passed

npm run build
build passed
application chunk: about 210 kB
charts chunk: about 420 kB
icons chunk: about 22 kB

http://127.0.0.1:4173/
page loaded
```

## 提交范围

- React + TypeScript 应用源码与响应式样式。
- 确定性回测逻辑、模拟数据和单元测试。
- 项目地图、架构、安全、运行、状态和路线图文档。
- `.gitignore` 及生成文件清理。

建议提交标题：

```text
feat: rebuild React quant research workbench
```

## 已知后续

- 为 React 组件增加浏览器交互测试。
- 使用动态导入按视图延迟加载 Recharts。
- 接入外部数据前实现文档中规定的来源追踪和权限隔离。
