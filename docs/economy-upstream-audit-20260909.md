# 跨上游低价路由核查（2026-09-09，未上线）

目标：同模型、同功能、满足当前尺寸和参考素材要求的最低成本通道优先。不能把相同 API 协议当成相同模型，也不能把 Lite、Fast、超分输出替换为原生同尺寸输出。

## 实际配置的供应商

Railway 只读取变量名核对配置，未将密钥写入本报告：AI Reiter、302、AtlasCloud、FAL、QuickRouter、Legnext。没有发现 OpenRouter 密钥配置。

| 上游 | 本轮核查结果 | 尚不能作为最终报价的部分 |
| --- | --- | --- |
| AI Reiter | Nano Banana 2 默认档：1K/2K $0.03，4K $0.035；Pro 默认档：1K/2K $0.05，4K $0.06。文档包含默认、Plus、Max 等档位 | 视频各档位的实际可用性与全部参考素材计费仍需逐项核对 |
| QuickRouter | 公开价格接口提供多组倍率，发现 Discounted-Banana-1/2、GPT Image 1K 与 2K/4K 分组 | 现有 Railway 密钥请求 `/v1/models` 返回 401；账号可用组、最终币种/充值换算、尺寸附加系数、参考图与质量限制尚未验证 |
| 302 | 已有 Nano Banana 2 适配；公开报价还出现 H3/Seedance 等低价入口 | 起价不能当全尺寸单价；H3 与 H3-Max 不自动视为同一模型；Seedance token 单位须核实 |
| AtlasCloud | Nano Banana 2 公开表格为 1K $0.08、2K $0.12、4K $0.16；已有 Seedance 多尺寸能力矩阵 | 文生图和编辑是不同接口；视频页面基础 per-run 数值不能直接当任意时长任务成本 |
| FAL | 已有 Nano/GPT 适配与历史任务恢复；Nano 2 公开单价高于新默认档 | 新 Nano 低价报价不能无条件承受 FAL 回退；GPT 质量合同单独保留，尚非全模型成本路由 |
| Legnext | 当前官方文档明确为 Midjourney 图像/视频及编辑 API | 不是 Nano Banana/Seedance 的等价替代；需比较同版本 Midjourney、速度和操作类型 |

## 新发现的 QuickRouter 候选

公开 JSON 中 `model_price × group_ratio` 的算术结果如下。**这些只是公开字段相乘，不是已验证的实际美元结算价，不用于当前积分收费。** 特供组不代表本账号有权限。

| 模型 | 分组 | 字段乘积 |
| --- | --- | ---: |
| gemini-3.1-flash-image-preview | Discounted-Banana-1 | 0.012169215 |
| gemini-3.1-flash-image-preview | Discounted-Banana-2 | 0.017038225 |
| gemini-3-pro-image-preview | Discounted-Banana-1 | 0.0242649 |
| gemini-3-pro-image-preview | Discounted-Banana-2 | 0.0339735 |
| gpt-image-2-c | Gpt-Image-1 | 0.0088236 |
| gpt-image-2-c | Gpt-Image-2 | 0.0110304 |

`gpt-image-2-c` 的描述明确存在组与尺寸的关系，且不支持 n 参数；不能直接替代现有 GPT Image 2 low/medium/high 合同。

## 本地实现与限制

- Nano 两款的本地价格已按 AI Reiter 默认档调整；数据库迁移尚未应用，网关尚未部署，不能称为线上价格。
- 候选过滤检查同模型、尺寸、比例、参考图数量、编辑能力和已声明输出格式，再按已核实成本排序；使用共享汇率、运营成本和成本缓冲常量。
- 目前实际成本过滤仅覆盖 Nano 两款及已有 FAL 候选，**不是全部供应商、全部模型已接入**。更便宜的 QuickRouter 组仍待认证和合同核实。
- 费用预算计入 8.1% 支付费分摊、共享运营分摊、10% 成本缓冲，并保留至少 10% 预算利润；运营费为估计分摊，不能承诺任何实际情况下绝不亏损。
- 不在预算内的昂贵备用通道排除；不能声称所有请求一定成功。若某尺寸只有更贵的兼容通道，应在提交前重新给出该尺寸报价，不能后台偷换尺寸或低价收款后高价执行。
- 已受理任务仍按原通道恢复，不重新提交。测试覆盖降价后历史 FAL 任务恢复、超预算禁止回退、缺少低价密钥时禁止转高价通道。

## 并发保护补充

本地图片提交已接入 `MediaRouteCapacity`：同一上游域名与凭据配置名共享进程内容量，默认同时 8 个任务、每用户 2 个，队列最多 96 个、等待最多 60 秒。这些是本地保护值，不代表上游承诺额度。候选先经原有兼容性和已实现的价格保护筛选，再选择有空位的候选；全部繁忙则在已有候选上排队，不添加昂贵通道。取消及队列溢出不调用上游，错误后释放进程内槽位。

新增测试覆盖共享别名容量、预算内候选分流、排队取消、队列溢出和错误释放。全网关测试通过。尚未上线；视频持久任务、跨实例共享容量、上游已受理但本地失去连接的长期占额、全部模型的成本保护仍需后续完成，不能声称大并发问题已彻底解决。

## 来源链接

- https://aireiter.com/image/nano-banana-v2
- https://aireiter.com/image/nano-banana-pro
- https://docs.aireiter.com/en/api-reference/images/nano-banana-v2/generation.md
- https://docs.aireiter.com/zh/api-reference/images/gemini-3-pro/generation.md
- https://api.quickrouter.ai/api/pricing
- https://api.quickrouter.ai/api/ratio_config
- https://302.ai/pricing/
- https://www.atlascloud.ai/models/google/nano-banana-2/text-to-image
- https://www.atlascloud.ai/models/bytedance/seedance-2.5/image-to-video
- https://fal.ai/models/fal-ai/nano-banana-2
- https://docs.legnext.ai/llms.txt
- https://www.creem.io/pricing
