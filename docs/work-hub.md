# MESSS 工作管理

四个常驻圆形入口：日程、文件、素材库、技能。替换旧的长按品牌旋转占位菜单；保留原有品牌按钮的布局恢复行为。

## 可用功能

- 日程：月历、按月时间线、交付清单；开始/交付日期、负责人、状态、进度、关联画布、里程碑、交付说明；逾期与近期交付统计；变更记录；归档/恢复；导出 ICS 全日历事件。
- 文件：复用本地文件导入与预览，搜索、类型筛选、加入素材库、放入当前画布。
- 素材库：导入本机文件、从已有文件收藏；标签、收藏与筛选；复用原有缩略图和画布插入。移出素材库不删除原文件。
- 技能：编写、导入、编辑、导出 SKILL.md；用安全 YAML schema 校验 name/description；查看正文后选择主聊天或画布 Agent，将技能与本次任务应用到输入框。用户发送后走既有 Agent、计费和权限流程，不自动发送。

## 存储与实际范围

排期和技能、素材元数据使用主进程 Store 的原子持久化，按当前账号隔离，未登录使用本机分区。多窗口更新采用 revision 冲突检查，拒绝静默覆盖；写入失败不会在界面报告保存成功。切换账号关闭旧账号的管理界面。

这版是本机项目管理，不含团队邀请、云同步、角色权限分配或在线网盘。素材文件沿用软件本地资料库；日程、技能不会自动上传服务器。技能当前支持指令型 SKILL.md，不导入附属 scripts/references/assets，也不执行外部技能脚本。项目进度为手动登记，非自动推算的工作完成率。交付日期是本地日历日期，不是跨时区会议时间。

## GitHub 参考（2026-09-08 已阅读项目 README）

- [FullCalendar](https://github.com/fullcalendar/fullcalendar)：月历、日期导航与事件呈现。
- [Frappe Gantt](https://github.com/frappe/gantt)：项目起止日期、进度条、月尺度时间线与里程碑设计。
- [Uppy](https://github.com/transloadit/uppy)：本地文件选择、预览、元数据编辑的素材导入流程。
- [Agent Skills](https://github.com/agentskills/agentskills)：SKILL.md 的 YAML 元数据与 Markdown 正文格式、按需调用。

界面和日程逻辑按 MESSS 原生 DOM 与主题变量实现；未直接嵌入上述日历或上传库、未加载远程 CDN。SKILL.md 使用正式生产依赖 js-yaml 4.3.0 的 JSON_SCHEMA 解析，不启用 JavaScript YAML 类型。参考说明不意味着实现了这些项目的全部功能。

## 验证

`npm run test:work-hub` 检查日期、闰日、里程碑范围、进度、账号隔离、并发冲突、实际 Store 重启恢复、归档恢复、写盘错误和 YAML 校验。

`scripts/test-work-hub-ui.cjs` 使用本地测试数据检查四个入口、创建排期、月历/时间线、明暗主题、窄窗口、素材标签收藏、技能创建及两个 Agent 目标。截图位于 `test-artifacts/work-hub/`，均为测试数据，不写入用户项目。
