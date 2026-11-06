---
order: 13
---

# 智能（AI）

智能模块接入兼容 OpenAI Chat Completions 协议的国产大模型（DeepSeek、通义千问、智谱 GLM、Kimi、豆包，以及私有化部署的兼容服务），提供四个功能：AI 问数、智能录入、数据整理、智能报告，另有 BI 预警的「AI 分析」和 Excel 导入的「AI 对应字段」。本页说明模块划分、大模型的调用方式、四个功能的实现机制以及安全与成本控制；在业务模块中扩展 AI 能力的步骤见 [AI 能力扩展开发](../guide/ai)，功能的使用方法见用户手册。

## 模块划分与依赖

| 位置 | 内容 |
| --- | --- |
| `lemon-framework` 的 `framework/ai` | 业务模块向 AI 提供能力的**契约**：`AiTool`（问数工具）、`AiExtractTarget` / `AiPrefill` / `AiPrefillBuilder`（智能录入）、`AiCleanseSource` / `AiCleanseRecord` / `AiCleanseChange` / `AiCleanseField` / `AiCleanseSupport`（数据整理）、`AiReportSource` / `AiReportPeriod` / `AiReportMetrics`（智能报告）、`AiAlertSource`（预警分析），以及 `AiSchema`（构造 JSON Schema）、`AiToolArgs`、`AiToolResult` |
| `lemon-modules/lemon-ai`（`modules/ai`） | 大模型客户端、按租户的「AI 设置」与用量、四个功能的 Service / Controller、契约的注册表；**只依赖 `lemon-framework`**（另依赖 openpdf 提取 PDF 文字） |
| 各业务模块的 `ai` 包 | 契约的实现：`wms/ai`、`scm/ai`、`mes/ai`、`fin/ai`、`hr/ai`、`crm/ai`、`pm/ai`、`bi/ai`，共 43 个问数工具、6 个录入目标、3 个整理来源、7 个报告来源、1 个预警来源 |
| 前端 | `views/ai`（chat、extract、cleanse、report、settings）、`components/ai`、`api/ai`、`composables/useAiPrefill.js`、`utils/sse.js`、`utils/markdown.js`、`utils/aiInput.js` |

```
lemon-modules/lemon-ai/src/main/java/com/lemon/erp/modules/ai
├── AiProperties、AiModuleConfig     平台级参数 lemon.ai.*
├── client       LlmClient 接口与 OpenAiCompatibleClient；LlmRequest / LlmMessage / LlmImage / LlmTool / LlmToolCall /
│                LlmResponse / LlmUsage / LlmEndpoint / LlmException / LlmStreamListener / LlmJsonResult；JsonSchemaValidator
├── registry     AiRegistry（基类）、AiToolRegistry、AiExtractRegistry、AiCleanseRegistry、AiReportRegistry、AiToolOutcome
├── service      AiModelService（调用模型的唯一入口）、AiConfigService、AiUsageService、AiAsyncContext、AiPrompts；
│                AiChatService / AiChatStreamService（问数）、AiExtractService / AiDocumentReader（录入）、
│                AiCleanseService / AiCleanseRunner / AiDuplicateFinder / AiImportMappingService（整理）、
│                AiReportService / AiReportCollector / AiReportPrompts / AiReportJobs / AiAlertAnalysisService（报告）
├── controller   AiConfigController、AiChatController、AiExtractController、AiCleanseController、AiImportController、AiReportController
└── entity / mapper / dto / model（AiProvider、AiFeature、AiMessageRole、AiCleanse*、AiReport*、AiSuggestionStatus）
```

### 为什么 ai 只依赖 framework

AI 问数要查询仓库、供应链、生产、财务、人事等几乎所有模块的数据，报告也要汇总各模块的指标。如果 ai 模块直接依赖业务模块，它就必须排在依赖链的最末端，并且每增加一类数据都要修改 ai 模块；反过来，业务模块也不能依赖 ai 模块（`bi`、`hr` 等已经在链的末端，再依赖 ai 容易形成环，而且会让业务代码直接接触模型、密钥和用量）。因此与 `workflow` 一样，ai 模块只依赖框架层：

- **框架层定义契约**（`framework/ai`），不涉及任何模型、协议、配置；
- **业务模块实现契约**并注册为 Spring Bean，在实现中调用本模块的 Service 查询数据——数据权限、租户条件、业务校验都由业务 Service 原样提供；
- **ai 模块收集契约 Bean**（构造函数注入 `List<AiTool>` 等），统一负责调用模型、权限过滤、参数校验、用量与上限；
- **业务模块不调用大模型**：不注入 `LlmClient`，也不自己发 HTTP 请求。所有模型调用都经过 `AiModelService`，这样功能开关、月度上限、用量统计、错误提示对所有功能一致。

业务模块编译时看不到 `modules/ai` 的任何类（Gradle 没有声明依赖），这条规则由构建强制。

### 注册表

`AiRegistry<T>` 是四个注册表的基类，启动时收集全部实现：

1. 检查标识的格式（问数工具 `AiTool.NAME_PATTERN`：小写字母开头，小写字母、数字、下划线，最长 64 位；录入目标、整理来源、报告来源 `KEY_PATTERN`：`模块.名称`，如 `scm.purchase-order`），不合格或重复时**启动失败**；
2. 按标识排序（`TreeMap`）：发送给模型的工具列表顺序固定，服务商的提示词缓存才能命中；
3. 使用时按当前用户的权限过滤：`available()` 返回有权限的，`find` 找不到或没有权限时为空，`require` 不存在时抛 `ai.error.capabilityNotFound`、没有权限时抛 403。权限为 `null` 表示登录即可，判断用 `PermissionService.hasPerm`。

| 注册表 | 权限 | 额外规则 |
| --- | --- | --- |
| `AiToolRegistry` | `AiTool.permission()` | `llmTools()` 生成发送给模型的函数定义；`execute` 执行一次调用 |
| `AiExtractRegistry` | `AiExtractTarget.permission()` | 无 |
| `AiCleanseRegistry` | `viewPermission()` | `canApply` / `apply` / `disable` 另外检查 `applyPermission()` 和可修改字段 |
| `AiReportRegistry` | `permission()` | `requiresAllData()` 为 true 的来源还要求当前用户的数据权限为「全部数据」；`available()` 按 `order()` 排序 |

## 调用大模型

### AiModelService

业务功能调用模型的唯一入口（问数、录入、整理、报告都通过它）：

1. 读取当前租户的「AI 设置」（`AiConfigService.find`），依次检查已配置（服务商、API Key、对话模型、接口地址都不为空）、总开关已打开、该功能（`AiFeature`）的开关已打开、本月用量未达上限，不满足时抛出对应的 `BizException`（`ai.error.notConfigured`、`disabled`、`featureDisabled`、`monthlyLimitReached`）；
2. 由配置生成 `LlmEndpoint`（接口地址、API Key、模型、温度、最大输出 token）；请求中带图片时换成识图模型，未配置识图模型时提示 `ai.error.visionModelRequired`；
3. 调用 `LlmClient`，成功后记录用量；失败时如果已有消耗（如 JSON 重试后仍不合格）也记录。

| 方法 | 用途 |
| --- | --- |
| `requireAvailable(feature)` | 只检查是否可用并返回配置（含 API Key，不要返回前端） |
| `endpoint(feature, vision)` | 检查可用并返回连接信息 |
| `chat(feature, request)` | 普通对话；`request.tools()` 不为空时是带工具的对话，返回 `LlmResponse.toolCalls()` |
| `stream(feature, request, listener)` | 流式对话，逐段回调 `LlmStreamListener.onDelta`，工具调用的增量在内部累积 |
| `chatJson(feature, request, schema)` | JSON 输出并按 schema 校验，不通过时重试一次 |

::: warning 不要在数据库事务中调用模型
一次调用可能持续几十秒到几分钟，放在事务中会长时间占用数据库连接和行锁。调用模型的 Service 方法不加 `@Transactional`，需要写库时在调用前后各自完成（如问数先保存提问、拿到回答后再保存回答），或用 `TransactionTemplate` 逐条提交。
:::

### OpenAiCompatibleClient

`LlmClient` 的唯一实现，用 JDK `HttpClient`（HTTP/1.1）+ Jackson 实现 OpenAI Chat Completions 协议中用到的部分，**没有引入任何服务商 SDK**：`POST {baseUrl}/chat/completions`，`Authorization: Bearer {apiKey}`，支持 `messages`、`tools` / `tool_calls`、`stream`（SSE，带 `stream_options.include_usage`）、`response_format: json_object`、图片（`image_url` 中放 base64 data URL）。它不关心租户配置，只接收 `LlmEndpoint`；`LlmEndpoint.toString()` 不输出 API Key。

| 项目 | 规则 |
| --- | --- |
| 超时 | 连接 `lemon.ai.connect-timeout`（10 秒）；等待响应 `lemon.ai.read-timeout`（120 秒，非流式为整个回答，流式为收到响应头之前） |
| 流式读取 | 开始输出后超过 `lemon.ai.stream-idle-timeout`（60 秒）没有新数据时视为超时；所有流共用一个守护线程（`ai-stream-watchdog`）每秒检查，超时或用户已停止时关闭输入流，使读取立即结束；`listener.isCancelled()` 为 true 时停止读取，返回已收到的部分（`finishReason = cancelled`） |
| 重试 | 429（余额 / 额度不足的 429 除外）、5xx、连接失败时按指数退避重试，最多 `lemon.ai.max-retries`（2）次，首次等待 `lemon.ai.retry-backoff`（1 秒）后每次翻倍；有 `Retry-After` 时按它等待（最多 30 秒）；**流式请求只在收到数据之前重试** |
| 用量 | 取响应中的 `usage`；服务商没有返回时按字符数估算（输入为请求体长度 / 2，输出为文字长度 / 2），`LlmUsage.estimated = true` |
| JSON 输出 | `chatJson` 在消息最前面加系统提示 `ai.prompt.jsonSchema`（要求只输出一个 JSON 对象并附上 schema），使用 `response_format: json_object`；去掉可能包裹的 ```` ```json ```` 代码块后解析，用 `JsonSchemaValidator` 校验；不通过时把模型的输出和错误列表（`ai.prompt.jsonRetry`）追加到对话中重试一次，仍不通过抛 `ai.error.jsonInvalid`（异常中带两次调用的累计用量） |
| 代理 | 没有显式设置代理，使用 JVM 默认的 `ProxySelector`，即读取 `-Dhttps.proxyHost` / `-Dhttps.proxyPort` / `-Dhttp.nonProxyHosts` 等系统属性，见 [生产环境配置](../deploy/production#ai) |

失败统一抛出 `LlmException`（继承 `BizException`，消息键说明原因，按用户语言返回可读提示）：

| 情况 | 消息键 |
| --- | --- |
| 401 / 403 | `ai.error.invalidApiKey` |
| 402，或 429 且错误内容含 insufficient、quota、balance、余额、欠费等 | `ai.error.insufficientBalance`（不重试） |
| 429 | `ai.error.rateLimited` |
| 错误内容是「模型不存在」（任何状态码） | `ai.error.modelNotFound` |
| 404 | `ai.error.endpointNotFound`（多为接口地址填错） |
| 400 / 422 | `ai.error.badRequest` |
| 5xx | `ai.error.serverError` |
| 连接失败、连接超时 | `ai.error.connectFailed` |
| 等待响应超时、流式读取超时 | `ai.error.timeout` |
| 响应不是合法的 JSON | `ai.error.invalidResponse` |
| 接口地址不合法 | `ai.error.invalidBaseUrl` |

错误提示中会附上服务商返回的错误信息（最多 300 字）；服务商返回的错误体（最多 4096 字）以 WARN 级别写入后端日志。

### JsonSchemaValidator

精简的 JSON Schema 校验器，用于校验模型生成的工具参数和 JSON 输出。支持的关键字与 `AiSchema` 能生成的一致：`type`（可为数组）、`properties`、`required`、`items`、`enum`、`format: date`（yyyy-MM-dd）、`minimum`、`maximum`、`minLength`、`maxLength`、`maxItems`，其他关键字忽略（包括 `additionalProperties`，模型多输出的字段不会报错，契约实现只读取自己需要的字段）。值为 `null` 的非必填属性视为未填写。错误信息按当前语言生成，会回传给模型用于修正。

### 配置：lemon.ai 与「AI 设置」 {#config}

配置分两层，**互不覆盖**：

| 层次 | 内容 | 位置 |
| --- | --- | --- |
| 平台级参数 | 超时、重试、工具轮数、历史条数、线程数、数据整理的批量大小、是否允许内网地址 | `lemon.ai.*`（`AiProperties`），全部有默认值，`application.yml` 中没有配置，按需用配置或环境变量覆盖，见 [配置说明](../start/config#lemon-ai) |
| 按租户的模型配置 | 服务商、接口地址、API Key、对话模型、识图模型、总开关、四个功能开关、每月 token 上限、温度、单次最大输出 token | 「智能 → AI 设置」页面，表 `ai_config`（每个租户一条，`uk_ai_config (tenant_id)`） |

服务商、密钥、模型**只能在页面中配置**，配置文件和环境变量中没有对应项，也没有全局的默认密钥：单租户部署时平台租户在页面中配置一次；SaaS 模式下每个租户各自配置、各自付费。

一次请求实际使用的参数按以下优先级确定：

| 参数 | 优先级（从高到低） |
| --- | --- |
| 接口地址 | 「AI 设置」中填写的接口地址 → 服务商的默认地址（`AiProvider`：DeepSeek `https://api.deepseek.com`、通义千问 `https://dashscope.aliyuncs.com/compatible-mode/v1`、智谱 `https://open.bigmodel.cn/api/paas/v4`、Kimi `https://api.moonshot.cn/v1`、豆包 `https://ark.cn-beijing.volces.com/api/v3`；「其他」`CUSTOM` 没有默认地址，必须填写） |
| 模型 | 请求带图片时用识图模型，否则用对话模型；模型名称不写死在代码中 |
| 温度、最大输出 token | 代码中对单次请求的设置（`LlmRequest.withTemperature` / `withMaxTokens`，如测试连接固定 16 个 token）→ 「AI 设置」中的值（温度默认 0.3）→ 都为空时不传，由服务商决定 |

`AiConfigService.save` / `test` 对输入的整理：去掉空白；接口地址去掉末尾的 `/` 和粘贴进来的 `/chat/completions`；必须是 `http(s)://` 地址；打开总开关时 API Key 和对话模型必填。**SaaS 模式下非平台租户的接口地址不能解析到本机、内网、链路本地地址**（`ai.error.privateNetworkNotAllowed`，防止借「测试连接」探测服务器所在的内网），`lemon.ai.allow-private-network=true` 时放开；平台租户和单租户部署不受限制，可以接入私有化部署的模型。这个检查只在保存和测试连接时按当时的 DNS 解析结果进行。

接口（`AiConfigController`）：`GET /ai/config`、`GET /ai/config/providers`、`GET /ai/config/usage`（`ai:config:list`）；`PUT /ai/config`、`POST /ai/config/test`（`ai:config:edit`，保存记录操作日志）；`GET /ai/config/status`（登录即可，只返回是否已配置、已启用、有无识图模型和各功能是否可用，不含配置内容，业务页面据此决定是否显示 AI 入口）。

### API Key 的存储

- API Key **加密**保存在 `ai_config.api_key`（`VARCHAR(512)`）：`AiKeyCipher` 用 AES-256-GCM 加密，库中为 `enc:` + Base64（12 字节随机 IV + 密文 + 认证标签），同一个 Key 每次保存的密文都不同。加密密钥取 `lemon.ai.secret-key`（环境变量 `LEMON_AI_SECRET_KEY`），为空时取 `lemon.jwt.secret`，经 SHA-256 得到 256 位密钥；
- 读写都经过 `AiConfigService`：`find()` 返回解密后的配置（调用模型时放在 `Authorization` 请求头中），`save()` 保存前加密。升级前保存的明文 Key 在 `find()` 时仍可使用，并当场改写为密文；加密密钥更换后无法解密，Key 视为未设置（「AI 设置」显示未配置、各功能不可用），日志中有警告，管理员重新填写即可；
- 加密只防止数据库备份、只读账号等渠道直接看到 Key；能同时拿到数据库和加密密钥（服务器环境变量）的人仍可解密，二者要分开保管；
- 只写不读：实体字段 `@JsonProperty(access = WRITE_ONLY)`，查询接口只返回 `apiKeySet` 和脱敏的 `apiKeyMask`（保留前 3 位和后 4 位，10 位及以下全部显示为 `******`）；保存时 API Key 为空表示不修改；
- 操作日志：`OperLogAspect.SECRET_FIELDS` 中加入了 `apiKey`，保存「AI 设置」时请求参数中的密钥完全隐藏；
- 测试连接时 API Key 留空则使用已保存的，页面上不需要也看不到原密钥。

### 用量统计与月度上限

- 每次调用模型写一条 `ai_usage`（租户、调用人、功能 `AiFeature`：CHAT / EXTRACT / CLEANSE / REPORT / TEST、模型、输入 / 输出 token、时间）；调用人取当前登录用户，定时生成的报告没有登录用户，记为空；
- 「每月 token 上限」（输入 + 输出）按**自然月**（服务器时区）统计当前租户全部功能的合计，包括测试连接；为空不限；
- **在每次调用之前检查**：本月合计已达到上限时拒绝调用。这是软上限——最后一次调用本身不受限制，问数的一次提问会多次调用模型（每一轮工具调用都检查一次），因此实际用量可能略超上限；
- 服务商没有返回用量时按字符数估算（`estimated`），记录的是估算值；
- 「AI 设置」右侧的本月用量来自 `GET /ai/config/usage`（`AiUsageService.summary`）：合计与上限、按功能汇总、按人员汇总（前 20 名，跨模块只读 JOIN `sys_user` 取姓名），都在数据库中 `GROUP BY`。

### 异步执行与上下文

问数的流式回答、数据整理任务、智能报告都在 ai 模块自己的线程池中执行（不是 Spring 的 `@Async`），提交任务前用 `AiAsyncContext.capture()` 取出请求线程的**租户、登录用户（`SecurityContext` 中的 `Authentication`）和语言**，`wrap` 在执行前设置、结束后清理。因此异步线程中调用的工具、报告来源、整理来源仍在发起人的权限和数据权限下执行，SQL 带上租户条件，提示词和错误信息按发起人的语言生成。

| 线程池 | 线程数 | 队列 | 队列满时 |
| --- | --- | --- | --- |
| 问数（`ai-chat-*`） | `lemon.ai.stream-threads`（16） | 100 | 提示 `ai.error.busy`（「当前提问的人较多，请稍后再试」）；保存提问前先检查，满了不保存，提交时仍被拒绝则删除刚保存的提问，不会留下没有回答的提问 |
| 数据整理 | `lemon.ai.cleanse-threads`（2） | 20 | 任务标记为失败并提示 `ai.error.busy` |
| 智能报告 | 4（代码中固定） | 50 | 报告标记为失败并提示 `ai.error.busy` |

线程池都在进程内：服务重启时进行中的任务中断，数据整理任务和报告在超过 30 分钟没有进展后显示为已中断，可以重新发起。

SSE 流式回答结束时 Servlet 容器会进行一次 ASYNC 分派，此时 JWT 过滤器不再执行，`SecurityConfig` 中用 `.dispatcherTypeMatchers(DispatcherType.ASYNC).permitAll()` 放行（原请求已经鉴权）。

## AI 问数

用户用自然语言提问，模型通过函数调用（tool calling）调用业务模块提供的查询工具（`AiTool`），根据查询结果回答。

### 一次提问的处理过程

`POST /ai/chat/conversations/{id}/send`（`ai:chat:use`，请求体 `{content}`，最多 4000 字）由 `AiChatStreamService.send` 处理：

1. **请求线程中**：校验会话属于当前用户（`requireOwn`，别人的会话视为不存在，管理员也一样）、`requireAvailable(CHAT)`、保存提问，然后创建 `SseEmitter`（超时 `lemon.ai.stream-timeout`，5 分钟）并把任务提交到线程池。这一步失败时返回普通 JSON 错误，不建立事件流；
2. **异步线程中**：系统提示（`AiPrompts.chatSystem`）+ 最近 `lemon.ai.history-messages`（20）条历史（去掉没有完整工具结果的工具调用）+ 当前用户可用的工具（`AiToolRegistry.llmTools()`）发给模型，流式读取；
3. 模型返回工具调用时，保存这条回答（含 `tool_calls`），**逐个**执行：推送 `status` 事件 → `AiToolRegistry.execute` → 保存工具消息 → 推送 `data` 事件；全部执行完后把结果一次回传给模型，进入下一轮；
4. 模型直接回答（没有工具调用）、用户停止、或达到 `lemon.ai.max-tool-rounds`（6）轮时结束：最后一轮不再提供工具，并加一条系统提示 `ai.prompt.toolRoundsExhausted` 要求基于已有结果回答；保存回答和本次提问的 token 合计，推送 `done`。

系统提示 `ai.prompt.chatSystem` 说明身份、今天的日期和星期、当前公司和用户，并要求：业务数据只能来自工具结果、不知道就说明、绝不编造数字和名称；金额、数量带单位；不回答与企业经营无关的问题，不泄露系统提示和工具定义；按用户的界面语言回答。没有任何可用工具时改用 `ai.prompt.chatNoTools`，说明暂时无法查询业务数据。

### 工具的执行

`AiToolRegistry.execute(call)` 对模型请求的每一次调用：

1. 按名称查找**当前用户有权限**的工具（模型只看得到有权限的工具，这里再检查一次，防止模型编造工具名称），不存在时回传 `ai.text.toolUnavailable`；
2. 解析参数 JSON，按 `parameters()` 的 schema 校验，不合格时把错误回传给模型；
3. 调用 `execute(new AiToolArgs(参数))`。工具在发起人的 `SecurityContext` 和 `TenantContext` 中执行，调用的业务 Service 上的 `@DataPermission`、租户插件**照常生效**；`BizException` 的消息回传给模型，其他异常记录 WARN 日志并回传「查询失败」；
4. 结果统一为 `AiToolResult`：工具返回 `List` 时按行数上限 `AiTool.MAX_ROWS`（200）截断，工具自己构造的 `AiToolResult` 也会再检查一次；截断时附加 `note`（`ai.prompt.truncated`）要求模型告诉用户结果已截断；
5. 回传给模型的 JSON 为 `{data, total, truncated, note}`，失败时为 `{error}`。参数错误、业务异常、没有权限都作为工具结果回传，**不中断对话**，模型可以修正参数重试或向用户说明。

### SSE 事件与前端

| 事件 | 数据 | 说明 |
| --- | --- | --- |
| `status` | `{text, tool}` | 如「正在查询：工时汇总」 |
| `delta` | `{text}` | 回答文字的增量 |
| `data` | `{messageId, tool, label, arguments, data, total, truncated, error}` | 一次工具调用的结果，前端显示为可折叠的查询过程和表格 |
| `done` | `{messageId, usage: {promptTokens, completionTokens, estimated}, cancelled}` | 结束 |
| `error` | `{message}` | 失败原因（可读提示），之后流结束 |

前端用 `utils/sse.js` 的 `streamSse`：`EventSource` 不能发 POST、不能带 `Authorization` 头，因此用 `fetch` 发送请求并读取 `text/event-stream`；响应不是事件流时按普通 JSON 处理（401 跳转登录，其他提示错误）。「停止生成」中止 `fetch`，服务端在推送失败时把任务标记为取消，流式读取随即停止，已生成的部分照常保存。

会话与消息：表 `ai_conversation`（用户、标题、时间）、`ai_message`（角色 USER / ASSISTANT / TOOL、文字、`tool_call_id`、`tool_name`、`tool_calls`、`tool_result`、token）。消息历史接口 `GET /ai/chat/conversations/{id}/messages` 不返回 `tool_calls` / `tool_result` 大字段，前端展开某次查询时再用 `GET /ai/chat/messages/{id}/data` 读取表格数据。其他接口：`GET/POST /ai/chat/conversations`、`PUT/DELETE /ai/chat/conversations/{id}`（删除时连同消息一起删除）。

回答用 `utils/markdown.js` 渲染：marked 解析后经 DOMPurify 清理，禁止 `img`、`style`、`form`、`input`、`iframe` 标签和 `style` 属性，链接一律在新窗口打开并加 `rel="noopener noreferrer"`。

## 智能录入

把单据图片、PDF、Excel、文本识别成结构化数据，打开对应业务页面的新增表单并预填，用户核对后由原表单保存。**AI 不保存任何单据，也不保存上传的文件。**

### 后端流程

`AiExtractController`（`ai:extract:use`）：`GET /ai/extract/targets`（当前用户可用的目标）、`POST /ai/extract/detect`、`POST /ai/extract`（multipart：`target`、`text`、`files`）。

1. `registry.require(target)`：目标必须存在且当前用户有目标的权限（一般是单据的新增权限），否则 403；`requireAvailable(EXTRACT)`；
2. `AiDocumentReader.read` 读取输入，全部在内存中处理，请求结束即丢弃：

   | 输入 | 处理 | 限制 |
   | --- | --- | --- |
   | 图片 | 按文件头识别 jpg / png / webp，作为图片发给识图模型 | 最多 5 张，每张 5MB |
   | PDF | openpdf 提取文字；提取不到文字（扫描件）或无法读取（加密、损坏）时提示截图后以图片上传，服务端不渲染 PDF 页面 | 10MB，前 20 页 |
   | txt / csv | 按 UTF-8 解码，不合法时按 GB18030 | 2MB |
   | Excel | 由前端（`utils/aiInput.js`，exceljs 按需加载）解析成制表符分隔的文字后作为文本提交 | 最多 3 个工作表、每个 300 行 |
   | 合计 | 一次最多 6 个文件；文字超过 20000 字时截断并在结果中提示 | |

3. 系统提示 `ai.prompt.extractSystem`（只提取明确出现的信息、看不清填 null、数字不带单位、日期 yyyy-MM-dd、名称照抄、明细逐行）+ 目标的 `instructionKey()`；用户消息中文字内容放在 `"""` 之间，带图片时说明图片属于同一份单据；
4. `AiModelService.chatJson(EXTRACT, ..., target.schema())`：带图片时用识图模型，输出按目标的 schema 校验，不通过重试一次；
5. `target.prefill(模型输出)`：业务模块把名称匹配成 ID、检查数值，返回 `AiPrefill(data, warnings)`；
6. 返回 `{target, label, route, form, data, warnings, extracted, source, truncated, promptTokens, completionTokens}`。

不选目标时先调用 `detect`：把当前用户可用的目标（标识 + 名称）和内容前 3000 字交给模型，返回最多 3 个候选（可能性、依据），由用户确认后再识别；只有一个可用目标时不调用模型。

### AiPrefill 与 AiPrefillBuilder

`AiPrefill.data` 的字段名与前端新增表单、后端新增接口的请求体一致（如 `partnerId`、`items[].materialId`），匹配上的直接给 ID，匹配不上的原文放在 `xxxName` 这类字段中；`warnings` 中每条提示的 `field` 是表单字段路径（`partnerId`、`items[2].materialId`），前端据此给字段加黄色边框。

`framework/ai/AiPrefillBuilder` 是写 `prefill` 的辅助类（只做转换和查询，不写库，提示文字在 framework 资源包 `framework.ai.warn.*`）：

| 方法 | 作用 |
| --- | --- |
| `str` / `dec` | 读取模型输出：字符串去空白（`"null"` 视为空）；数字也接受「1,200.50」「¥12」「12 元」 |
| `list(m, key, field, max)` | 读取明细行，超过 `max` 行时提示 |
| `match(idField, textField, text, kindLabel, exact, search, label)` | 按文字匹配主数据：精确匹配 → 模糊搜索 → 去掉括号中的地区和「有限公司」等后缀再搜索；唯一的模糊结果采用并提示确认，多个或没有时不填 ID、保留原文并提示 |
| `date` | 解析日期（含「2026年1月5日」），距今超过一年时提示 |
| `qty` / `nonNegative` / `price` / `total` / `taxRate` | 数量必须大于 0、过大时提示；金额不能为负；单价与金额 ÷ 数量的一致性；合计与明细之和不一致（超过 1% 或 0.05）时提示；税率 0.13 换算为 13 |
| `required` / `warn` / `put` / `build` | 必填提示、自定义提示、设置字段、生成结果 |

### 前端

- 「智能录入」页面（`views/ai/extract/index.vue`）：选择目标或自动识别，上传 / 拖拽 / 粘贴截图 / 粘贴文字，识别后预览（`AiExtractPreview` 显示模型识别出的字段，字段名称取 `ai.extract.field.*`）和提示，「生成表单」时 `setPendingPrefill` 把结果**只保存在内存中**（不写 sessionStorage / localStorage，刷新即丢弃，10 分钟内有效、只用一次），跳转到 `route?ai=form`；
- 业务页面工具栏的「AI 识别」（`AiExtractButton`）：有 `ai:extract:use`、目标的新增权限、且租户开启了智能录入时显示，在当前页面识别后直接打开表单；
- 业务页面用 `useAiPrefill(form, open, visible)` 接入：挂载时发现 `?ai=form` 就取出结果打开新增表单；`apply` 在 `asPrefilled` 中同步调用 `openCreate`，预填的表单视为已修改（直接关闭要二次确认）；`AiPrefillAlert` 在表单顶部列出提示，`ai.cls(字段)` 给有提示的字段加 `ai-warn` 样式；
- 当前租户各功能是否可用由 `loadAiStatus()` 读取 `/ai/config/status`，各页面共用，在内存中缓存 1 分钟。

已接入：采购订单、销售订单（`components/scm/OrderPage.vue`、`OrderForm.vue`）、供应商、客户、物料、费用报销。

## 数据整理

检查物料、客户、供应商等主数据中的疑似重复、写法不统一、缺失字段，生成修改建议，用户逐条或批量采纳后经业务 Service 修改。**AI 只生成建议，采纳之前不修改任何数据**；疑似重复只建议停用，不自动合并（合并涉及大量业务引用）。

### 任务的执行

`POST /ai/cleanse/tasks`（`ai:cleanse:list` + 数据类型的查看权限）创建任务后，`AiCleanseRunner` 在线程池中执行（带上发起人的上下文，模型调用不在事务中）：

1. **读取候选记录**：`source.page(页码, 500, 关键字)`，最多 `lemon.ai.cleanse-max-records`（2000）条，超出时任务标记 `truncated`，页面提示按关键字分批整理；
2. **疑似重复先由程序分组**（`AiDuplicateFinder`，纯计算）：规范化（NFKC 全角转半角、小写、乘号统一为 x、常见单位中文转英文、去掉空格括号等符号、去掉公司后缀，名称和规格拆词排序）后相同的、税号相同的归为一组；其余要求其中的数字完全相同，去掉数字后字符二元组 Dice 相似度不低于 0.8 的归为一组；每组最多 20 条，最多 `cleanse-max-groups`（100）组。每次 `cleanse-groups-per-call`（10）组交给模型（`ai.prompt.cleanseDuplicate`）判断是否真的重复、建议保留哪条、理由、置信度；
3. **规范化建议**：记录按规范化后的名称排序，每批 `cleanse-batch-size`（40）条交给模型（`ai.prompt.cleanseNormalize`，附上可修改的字段、分类的可选值 `categoryOptions()`、常用计量单位的出现次数），返回 `{suggestions: [{id, field, value, reason, confidence}]}`；可修改的分类、单位、联系人、地址为空且模型没有给出建议的，生成「缺失字段」提示（只能忽略，到资料页面补充）；
4. **逐条校验模型输出**（先经 `chatJson` 的 schema 校验）：记录必须在本批 / 本组中、字段可修改、值非空且不超过 `AiCleanseField.maxLength()`、与原值不同、分类必须是可选值（给出名称时换成取值）、同一记录同一字段只取一条；不合格的丢弃并计入 `discardedCount`。某一步输出始终不合格时跳过该步（`failedSteps`）；额度、连接等错误时任务失败（原因以消息键 + 参数保存，按查看人的语言显示），已生成的建议保留；每一步之前检查任务是否已取消。

同一租户同一数据类型同一时间只能有一个进行中的任务：进行中时 `ai_cleanse_task.running_key` = 数据类型，唯一约束 `(running_key, tenant_id)`，结束时清空；超过 `cleanse-stale-after`（30 分钟）没有进展且不在本实例执行的任务，在下次发起时自动结束。

### 采纳

`POST /ai/cleanse/suggestions/apply`（`ai:cleanse:apply`，操作日志，一次最多 200 条）：

1. 每条建议一个事务（`TransactionTemplate`），一条失败不影响其他，逐条返回结果和失败原因；
2. 检查数据类型的应用权限（`AiCleanseRegistry.canApply`）、建议仍为待处理；
3. 规范化建议先用 `source.get(id)` 比较记录的当前值与生成建议时的原值，**记录已被修改的建议过期**、不再采纳；
4. 规范化建议调用 `AiCleanseRegistry.apply` → `source.apply(AiCleanseChange)`，疑似重复调用 `source.disable(id)`；业务模块在实现中调用本模块 Service 的修改 / 停用方法，与手工修改走同样的校验和变更历史；
5. 成功后按原状态更新为已采纳（并发采纳只有一个成功）。

`POST /ai/cleanse/suggestions/ignore` 只改变建议状态，同样需要应用权限。其他接口：`GET /ai/cleanse/sources`、`GET /ai/cleanse/tasks`、`GET /ai/cleanse/tasks/{id}`、`POST /ai/cleanse/tasks/{id}/cancel`、`GET /ai/cleanse/tasks/{id}/suggestions`；看不到的数据类型的任务视为不存在。

### 导入字段对应

Excel 导入（`components/ImportModal.vue`）上传的表头与模板不一致时显示「AI 对应字段」，归属「数据整理」功能（开关、用量都在 CLEANSE 下）。`POST /ai/import/mapping`（`AiImportController`，需要数据整理的查看权限 `ai:cleanse:list`——会消耗模型用量，不能只要求登录；导入本身仍由各业务接口校验权限，前端没有该权限时不显示按钮）：表头（去掉表示必填的「*」）与模板名称规范化后相同的直接对应，全部对应上时不调用模型；否则把模板字段、表头和前 3 行样例（每格最多 50 字）交给模型，返回的对应逐条校验（表头存在、字段存在、每个字段 / 每列只对应一次）。前端 `components/ai/AiImportMapper.vue` 显示对应关系供用户调整，应用后用 `readExcel(file, columns, 字段 → 表头)` 按对应关系重新读取，继续原有的导入流程。

## 智能报告

按周（周一至周日）/ 按月汇总业务数据，由模型撰写 Markdown 经营报告。**AI 只读数据、撰写文字，不修改任何业务数据。**

### 快照

`AiReportCollector.collect(period, sources)` 在当前用户的权限、数据权限、语言下依次调用有权限的来源（`AiReportRegistry.available()`，按 `order()` 排序），组成发给模型的 JSON：

```json
{
  "period": { "start": "2026-10-01", "end": "2026-10-31", "days": 31 },
  "previousPeriod": { "start": "2026-09-01", "end": "2026-09-30" },
  "sources": [
    { "key": "bi.sales", "label": "销售", "dataScope": "LIMITED", "data": { "...": "来源的快照 record" } },
    { "key": "hr.workforce", "label": "人事", "dataScope": "ALL", "error": "该板块数据获取失败" }
  ]
}
```

- `dataScope`：来源 `requiresAllData()` 为 true 或当前用户有「全部数据」时为 `ALL`，否则为 `LIMITED`，提示词要求模型在该板块注明「按数据权限统计，非全公司口径」；
- 一个来源失败只在该板块写 `error`（`BizException` 的消息或「该板块数据获取失败」），不影响其他来源；
- 上一期由 `AiReportPeriod.previous()` 计算：整月期间为上一个整月，否则为紧挨着的同样天数的期间；同比由来源自己查询；
- 增长率、占比在 Java 中用 `AiReportMetrics.growth` / `percent` 算好（保留 1 位小数，基期为空或 0 时为 null），提示词 `ai.prompt.reportSystem` 明确要求所有数字只能来自快照、不得编造或自行计算，字段名以 `Pct` 结尾的是百分比、以 `Points` 结尾的是百分点，金额单位为元。

### 生成

`POST /ai/report`（`ai:report:generate`，`{periodType, date}`，期间内任一天）：请求线程中检查 `requireAvailable(REPORT)`、期间不在未来、同一用户同一期间没有正在生成的，收集快照并存入 `ai_report.snapshot` 后立即返回报告 ID；后台线程池调用模型（流式读取，避免长回答超过等待时间），完成后保存正文和用量，失败时保存可读原因；页面每几秒轮询状态。选择后台生成而不是流式输出给前端，是因为报告较长（几十秒到两分钟），后台生成不占用连接、关闭页面不会中断，并与定时生成走同一条路径。

**定时生成**（`AiReportJobs`，实现 `JobHandler`，首次启动时自动登记到「定时任务」，按租户逐个执行）：`ai.weeklyReport` 每周一 7:00 生成上周周报（`0 0 7 * * MON`），`ai.monthlyReport` 每月 1 日 7:30 生成上月月报（`0 30 7 1 * *`）。只对开启了智能报告的租户生成，已生成过的不重复；没有登录用户，以系统身份（全部权限、「全部数据」、用户 ID 为空）收集全部来源，按默认语言撰写，在定时任务线程中同步调用模型；成功后给有 `ai:report:list` 权限的用户发站内消息（提醒），消息本身不含数据。

**查看权限**：手动生成的报告按生成人的权限取数，只有生成人能看（管理员也一样）；定时生成的报告包含全公司各板块数据，只有 `ai:report:list` 且数据权限为「全部数据」的用户能看，其他人列表中看不到、详情视为不存在。删除本人生成的或能看到的自动报告需要 `ai:report:generate`。

接口：`GET /ai/report`（列表，不含正文和快照）、`GET /ai/report/sources`、`GET /ai/report/{id}`（含正文）、`GET /ai/report/{id}/snapshot`、`POST /ai/report`、`DELETE /ai/report/{id}`。

### 预警的 AI 分析

`POST /ai/report/alerts/{ruleId}/analysis`（需要 `AiAlertSource.permissions()` 中的任一权限：`bi:decision:list` 或 `bi:cockpit:list`，属于智能报告功能）：`bi/ai/BiAlertAiSource` 给出规则的当前值、阈值、级别、近期趋势、相关明细和相关的报告来源标识，`AiAlertAnalysisService` 再取当前用户有权限的相关来源**近 30 天与前 30 天**的快照，交给模型（`ai.prompt.alertSystem`）给出结论、可能原因、建议措施、需要核实的方向。结果不入库也不缓存，前端在页面打开期间保留上次结果。

## 安全与成本

### 权限与数据权限

- 菜单与接口权限：AI 问数 `ai:chat:use`、智能录入 `ai:extract:use`、数据整理 `ai:cleanse:list` / `ai:cleanse:apply`、智能报告 `ai:report:list` / `ai:report:generate`、AI 设置 `ai:config:list` / `ai:config:edit`，在 Controller 上用 `@PreAuthorize` 声明；
- 每种能力还有自己的权限（工具的 `permission()`、录入目标的新增权限、整理来源的查看 / 应用权限、报告来源的权限），由注册表在列出和使用时各检查一次。只有 AI 问数权限、没有工资查询权限的用户，模型看不到工资工具，伪造调用也会被拒绝；
- 发送给模型的业务数据只来自当前用户有权限、经数据权限过滤的查询：工具、录入目标、整理来源、报告来源都调用业务 Service，`@DataPermission` 和租户条件在异步线程中照常生效（`AiAsyncContext`）；汇总全公司数据、底层查询不按数据权限过滤的报告来源要求「全部数据」；
- 契约约定不返回密码、证件号、银行账号、个人薪资等敏感字段：如工资只按部门汇总且人数少于 3 的部门合并，整理来源不含电话、邮箱、银行账号；
- 会话、手动生成的报告只有本人能看。

### 提示词注入的防范

模型会读到用户上传的单据、主数据中的文字、工具查询结果等不可信内容，这些内容可能夹带「忽略之前的指令」之类的文字。源码中**没有专门的注入检测或内容过滤**，防范依赖以下结构性限制——即使模型被诱导，能做的事也受限：

| 措施 | 实现 |
| --- | --- |
| 模型没有写操作 | 所有 `AiTool` 只查询；录入只返回预填数据，由用户在原表单中核对后保存；整理只生成建议，采纳需要用户确认并有 `ai:cleanse:apply` 和业务修改权限；报告只撰写文字 |
| 能力范围由权限决定 | 只提供当前用户有权限的工具，执行时再次检查权限，模型不能越过提问人的权限和数据权限 |
| 输出必须符合结构 | 工具参数、录入结果、整理建议、导入对应都按 JSON Schema 校验；整理建议另外逐条校验记录范围、可修改字段、长度、分类取值；录入结果中的名称由业务代码重新匹配成 ID |
| 指令与数据分开 | 规则写在 system 消息中；单据内容、主数据、快照放在 user 消息中（录入的文字放在 `"""` 之间），工具结果以 tool 消息回传；问数的系统提示要求不泄露系统提示和工具定义 |
| 渲染安全 | 回答和报告的 Markdown 经 DOMPurify 清理后才渲染，不渲染图片，避免借图片地址自动向外发送数据；链接需要用户点击，在新窗口打开 |
| 输入有上限 | 提问最多 4000 字，录入文字截断到 20000 字，导入样例每格 50 字 |

二次开发时保持这些约束：不要编写会修改数据的工具，不要把模型输出直接写库，也不要让模型输出决定权限或 ID。

### 日志与审计

| 内容 | 记录位置 |
| --- | --- |
| 修改 AI 设置、发起 / 取消整理任务、采纳 / 忽略建议、生成 / 删除报告 | 操作日志（`@OperLog`），API Key 隐藏 |
| 每次模型调用 | `ai_usage`：谁、什么功能、什么模型、多少 token |
| 问数的提问、回答、工具调用和工具结果 | `ai_message`（工具结果是回传给模型的 JSON，即发送出去的业务数据），删除会话时一并删除 |
| 报告的数据快照 | `ai_report.snapshot` |
| 错误 | 后端日志：服务商返回的错误体（WARN）、工具执行异常及参数（WARN）、JSON 输出不合格（INFO）、任务失败；不输出 API Key |

AI 问数、智能录入不记操作日志（它们只读），提问和用量分别在 `ai_message`、`ai_usage` 中。上传给智能录入的文件不落盘、不入库。

### token 消耗控制

- 功能默认全部关闭，由管理员在「AI 设置」中逐项开启；页面提示业务数据会发送给第三方模型服务，打开开关时再次确认；
- 每月 token 上限（按租户），调用前检查；用量按功能、按人统计，便于发现异常使用；
- 单次请求的规模有上限：工具结果最多 200 行、工具轮数最多 6 轮、历史最多 20 条、录入文字 20000 字和 5 张图片、数据整理最多 2000 条记录 / 100 个重复组、报告快照只含汇总值和少量排行；
- 能不调用模型时不调用：录入只有一个可用目标时不做自动判断，导入表头全部能直接对应时不调用模型，疑似重复先由程序分组、只把候选组交给模型；
- 工具列表按名称排序、系统提示结构固定，便于命中服务商的提示词缓存；
- 「单次最大输出 token」限制每次回答的长度。

`/ai/import/mapping` 需要数据整理的查看权限（`ai:cleanse:list`），只有能使用数据整理的用户才能通过导入窗口消耗用量。

## 前端文件

| 文件 | 内容 |
| --- | --- |
| `views/ai/chat/` | `index.vue`（会话与对话）、`ConversationList.vue`、`ChatTurn.vue`（一问一答、查询过程）、`ToolDataTable.vue`（工具数据表格） |
| `views/ai/extract/index.vue` | 智能录入页面 |
| `views/ai/cleanse/` | `index.vue`（任务列表、发起、进度，进行中每 2 秒刷新）、`SuggestionTable.vue`（疑似重复 / 规范化建议） |
| `views/ai/report/` | `index.vue`（列表）、`GenerateModal.vue`（类型、期间、将包含的来源）、`ReportDetail.vue`（正文、复制、下载 .md、打印、快照） |
| `views/ai/settings/` | `index.vue`（AI 设置、测试连接）、`UsagePanel.vue`（本月用量） |
| `views/bi/decision/AlertAnalysisModal.vue` | 预警卡片上的「AI 分析」（租户开启了智能报告时显示） |
| `components/ai/` | `AiExtractInput`、`AiExtractPreview`、`AiExtractProgress`、`AiExtractButton`、`AiPrefillAlert`、`AiImportMapper`、`MarkdownView` |
| `composables/useAiPrefill.js` | 预填接入、`loadAiStatus`、`useAiExtractEnabled` |
| `utils/sse.js`、`utils/markdown.js`、`utils/aiInput.js` | POST + SSE 读取；Markdown 安全渲染；录入输入的解析与前端检查 |
| `locales/<语言>/ai.js` | 界面文字 |

菜单：顶部模块「智能」（`/ai`，菜单 ID 16）下有 AI 问数、智能录入、数据整理、智能报告、AI 设置；内置角色中 AI 问数、智能报告给总经理，智能录入给总经理、采购员、销售员、会计，数据整理给采购员、仓库管理员，AI 设置只给超级管理员。SaaS 模式下「智能」在 `SysFeatureCatalog` 中登记为一个功能模块，租户按套餐开通。
