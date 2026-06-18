import {
  StrictMode,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState
} from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowRight,
  BracketsCurly,
  CheckCircle,
  Code,
  Database,
  GitBranch,
  GithubLogo,
  GlobeHemisphereEast,
  Pulse,
  ShieldCheck,
  WarningCircle
} from "@phosphor-icons/react";
import "./styles.css";

type Locale = "en" | "zh";
type ScenarioId = "saas-billing" | "commerce-care" | "developer-docs" | "internal-it";
type Risk = "low" | "medium" | "high";

type ScenarioPack = {
  id: ScenarioId;
  name: string;
  label: string;
  domain: string;
  summary: string;
  channels: string[];
  knowledge: string[];
  tools: string[];
  trigger: string;
  weakSignal: string;
  transcript: Array<{ role: "user" | "ai" | "tool" | "handoff"; text: string }>;
};

type EvolutionResult = {
  source: "local" | "llm";
  title: string;
  score: number;
  risk: Risk;
  generatedScript: string[];
  failureSample: string;
  knowledgePatch: string;
  toolPatch: string;
  nextRun: string;
};

type LlmSettings = {
  enabled: boolean;
  endpoint: string;
  model: string;
  apiKey: string;
};

type SiteCopy = {
  htmlLang: string;
  meta: {
    title: string;
    description: string;
  };
  nav: {
    label: string;
    scenarios: string;
    contracts: string;
    deploy: string;
    repository: string;
    switchLocale: string;
  };
  hero: {
    eyebrow: string;
    title: string;
    body: string;
    run: string;
    running: string;
    publishPath: string;
  };
  console: {
    aria: string;
    activeScenario: string;
    llmAssisted: string;
    localSimulator: string;
    readiness: string;
    risk: string;
    runs: string;
    steps: string[];
    fallbackSuffix: string;
    loadingLabel: string;
  };
  sections: {
    scenariosEyebrow: string;
    scenariosTitle: string;
    workspaceTitle: string;
    settingsTitle: string;
    contractsEyebrow: string;
    contractsTitle: string;
    deployEyebrow: string;
    deployTitle: string;
    deployBody: string;
  };
  patchTitles: {
    failureSample: string;
    knowledgePatch: string;
    toolPatch: string;
    nextRun: string;
  };
  llmForm: {
    toggle: string;
    endpoint: string;
    endpointHelp: string;
    model: string;
    apiKey: string;
    apiKeyPlaceholder: string;
    note: string;
  };
  deploySteps: Array<{ title: string; body: string }>;
  contractItems: string[];
  riskLabels: Record<Risk, string>;
  evolution: {
    title: (scenario: ScenarioPack, run: number) => string;
    probe: (scenario: ScenarioPack) => string;
    weakSignal: (scenario: ScenarioPack) => string;
    expectedPath: (scenario: ScenarioPack) => string;
    failureSample: (scenario: ScenarioPack) => string;
    knowledgePatch: (scenario: ScenarioPack) => string;
    toolPatch: (scenario: ScenarioPack) => string;
    nextRun: (scenario: ScenarioPack) => string;
  };
  errors: {
    generic: string;
    llmApiKey: string;
    llmEndpoint: string;
    llmRequest: (status: number) => string;
    llmNoContent: string;
    llmNotJson: string;
  };
  llmSystemPrompt: string;
  scenarios: ScenarioPack[];
};

const defaultSettings: LlmSettings = {
  enabled: false,
  endpoint: "https://api.openai.com/v1",
  model: "gpt-4.1-mini",
  apiKey: ""
};

const englishScenarios: ScenarioPack[] = [
  {
    id: "saas-billing",
    name: "SaaS Billing Support",
    label: "Billing and subscriptions",
    domain: "B2B SaaS",
    summary:
      "Covers invoices, renewal dates, seat counts, cancellation policy, order lookup, and handoff decisions.",
    channels: ["Web widget", "Slack inbound", "Chatwoot handoff"],
    knowledge: ["Cancellation policy", "Invoice receipt rules", "Annual plan renewal window"],
    tools: ["demo.order_lookup", "demo.subscription_lookup", "openapi.external_order_lookup"],
    trigger: "Please look up order ORD-2026-1001 and confirm my renewal date.",
    weakSignal: "User asks for refund timing after a failed card update.",
    transcript: [
      { role: "user", text: "Please look up order ORD-2026-1001." },
      { role: "tool", text: "demo.order_lookup returned paid, Growth Annual, billing email." },
      {
        role: "ai",
        text: "The order is paid and the receipt was sent to billing@northstar.example."
      },
      { role: "handoff", text: "Refund review remains a human-reviewed path." }
    ]
  },
  {
    id: "commerce-care",
    name: "Commerce Support Desk",
    label: "Retail after-sales",
    domain: "Online retail",
    summary:
      "Models shipment delays, return windows, damaged item claims, inventory checks, and escalation rules.",
    channels: ["Generic webhook", "Web widget", "Agent assist"],
    knowledge: ["Return window by category", "Damaged item photo policy", "Carrier delay script"],
    tools: ["openapi.shipment_lookup", "openapi.return_eligibility"],
    trigger: "The carrier says my parcel was delivered, but I never received it.",
    weakSignal: "User says a returned item was rejected without a reason.",
    transcript: [
      { role: "user", text: "My espresso machine return was rejected." },
      { role: "ai", text: "I will first check the category return window and rejection reason." },
      { role: "tool", text: "return_eligibility needs order_id and item category." },
      { role: "handoff", text: "Missing order ID becomes a guided clarification script." }
    ]
  },
  {
    id: "developer-docs",
    name: "Developer Docs Support",
    label: "Developer documentation",
    domain: "API platform",
    summary:
      "Tests SDK onboarding, webhook signatures, API errors, version policy, and source-grounded answers.",
    channels: ["Docs widget", "Issue triage", "Chatwoot handoff"],
    knowledge: ["SDK quickstart", "Webhook signature guide", "Public contracts"],
    tools: ["openapi.status_lookup", "openapi.issue_classifier"],
    trigger: "I keep getting 401 while verifying a Slack webhook signature. What should I inspect?",
    weakSignal: "User mixes old v0.8 docs with v1.0 public contract behavior.",
    transcript: [
      { role: "user", text: "My Slack callback returns 401 and the payload is JSON." },
      { role: "ai", text: "First confirm the timestamp, signature header, and signing secret." },
      { role: "ai", text: "If a proxy is involved, preserve the original request body semantics." },
      { role: "handoff", text: "If headers are unavailable, route the case to developer support." }
    ]
  },
  {
    id: "internal-it",
    name: "Internal IT Helpdesk",
    label: "Internal IT",
    domain: "Employee support",
    summary:
      "Covers access requests, device issues, VPN onboarding, policy lookup, and approval handoff.",
    channels: ["Slack inbound", "Generic webhook", "Operations dashboard"],
    knowledge: ["VPN setup", "Device replacement policy", "Access approval matrix"],
    tools: ["openapi.employee_lookup", "openapi.ticket_draft"],
    trigger: "I need temporary access to the finance dashboard. Who should approve it?",
    weakSignal: "User requests access outside their department boundary.",
    transcript: [
      { role: "user", text: "I need temporary access to the finance dashboard." },
      { role: "ai", text: "I can explain the request path, but I cannot grant access directly." },
      { role: "tool", text: "employee_lookup confirms a department mismatch." },
      { role: "handoff", text: "The access request is routed into an approval workflow." }
    ]
  }
];

const chineseScenarios: ScenarioPack[] = [
  {
    id: "saas-billing",
    name: "订阅账单支持",
    label: "账单与订阅",
    domain: "企业订阅软件",
    summary: "覆盖发票、续费日期、席位数量、取消政策、订单查询和人工转接判断。",
    channels: ["网页组件", "聊天工具入站", "人工客服转接"],
    knowledge: ["取消政策", "发票收据规则", "年度方案续费窗口"],
    tools: ["demo.order_lookup", "demo.subscription_lookup", "openapi.external_order_lookup"],
    trigger: "请帮我查询订单 ORD-2026-1001，并确认续费日期。",
    weakSignal: "用户在银行卡扣款失败后询问退款时效。",
    transcript: [
      { role: "user", text: "请帮我查询订单 ORD-2026-1001。" },
      { role: "tool", text: "demo.order_lookup 返回已支付、年度成长版、账单邮箱。" },
      { role: "ai", text: "订单已支付，收据已发送到 billing@northstar.example。" },
      { role: "handoff", text: "退款审核继续保留人工处理路径。" }
    ]
  },
  {
    id: "commerce-care",
    name: "电商售后支持",
    label: "电商售后",
    domain: "线上零售",
    summary: "建模物流延迟、退货窗口、破损申诉、库存查询和升级规则。",
    channels: ["通用入站接口", "网页组件", "坐席辅助"],
    knowledge: ["按品类划分的退货窗口", "破损商品照片规则", "承运商延迟话术"],
    tools: ["openapi.shipment_lookup", "openapi.return_eligibility"],
    trigger: "物流显示包裹已签收，但我没有收到。",
    weakSignal: "用户表示退货被拒绝，但没有收到原因说明。",
    transcript: [
      { role: "user", text: "我的咖啡机退货被拒绝了。" },
      { role: "ai", text: "我会先核对品类退货窗口和拒绝原因。" },
      { role: "tool", text: "return_eligibility 需要订单编号和商品品类。" },
      { role: "handoff", text: "缺少订单编号时，进入引导式澄清脚本。" }
    ]
  },
  {
    id: "developer-docs",
    name: "开发者文档支持",
    label: "开发者文档",
    domain: "接口平台",
    summary: "测试开发包接入、回调签名、接口错误、版本策略和基于来源的回答。",
    channels: ["文档网页组件", "问题分拣", "人工客服转接"],
    knowledge: ["开发包快速开始", "回调签名指南", "公共契约"],
    tools: ["openapi.status_lookup", "openapi.issue_classifier"],
    trigger: "我验证 Slack 回调签名时一直返回 401，应该检查什么？",
    weakSignal: "用户混用了旧版文档和当前公共契约。",
    transcript: [
      { role: "user", text: "Slack 回调返回 401，请求体是 JSON。" },
      { role: "ai", text: "先确认时间戳、签名请求头和签名密钥。" },
      { role: "ai", text: "如果经过代理，需要保留原始请求体语义。" },
      { role: "handoff", text: "如果无法取得请求头，转交开发者支持。" }
    ]
  },
  {
    id: "internal-it",
    name: "内部信息技术支持",
    label: "内部信息技术",
    domain: "员工支持",
    summary: "覆盖权限申请、设备问题、远程网络接入、政策查询和审批转接。",
    channels: ["聊天工具入站", "通用入站接口", "运维看板"],
    knowledge: ["远程网络设置", "设备更换政策", "权限审批矩阵"],
    tools: ["openapi.employee_lookup", "openapi.ticket_draft"],
    trigger: "我需要临时访问财务看板，审批人是谁？",
    weakSignal: "用户申请了部门边界之外的权限。",
    transcript: [
      { role: "user", text: "我需要临时访问财务看板。" },
      { role: "ai", text: "我可以说明申请流程，但不能直接授予权限。" },
      { role: "tool", text: "employee_lookup 确认申请人与目标部门不一致。" },
      { role: "handoff", text: "权限申请被转入审批流程。" }
    ]
  }
];

const siteCopy: Record<Locale, SiteCopy> = {
  en: {
    htmlLang: "en",
    meta: {
      title: "OpenSupportAI Scenario Lab",
      description:
        "OpenSupportAI is an open-source, embeddable AI support runtime with scenario evolution demos."
    },
    nav: {
      label: "Primary navigation",
      scenarios: "Scenarios",
      contracts: "Contracts",
      deploy: "Pages",
      repository: "Repository",
      switchLocale: "Chinese"
    },
    hero: {
      eyebrow: "OpenSupportAI v1.0",
      title: "Scenario Lab for an AI support runtime that can test its own scripts.",
      body: "A public website and demo model for support workflows: define a scenario, generate a user script, simulate the answer path, score failures, and propose the next knowledge or tool patch.",
      run: "Run evolution loop",
      running: "Running loop",
      publishPath: "Publish path"
    },
    console: {
      aria: "Scenario evolution console",
      activeScenario: "Active scenario",
      llmAssisted: "LLM assisted",
      localSimulator: "Local simulator",
      readiness: "Readiness",
      risk: "Risk",
      runs: "Runs",
      steps: [
        "Generate support script",
        "Simulate retrieval and tools",
        "Score answer quality",
        "Draft next patch"
      ],
      fallbackSuffix: "Showing deterministic local fallback.",
      loadingLabel: "Loading scenario evolution result"
    },
    sections: {
      scenariosEyebrow: "Scenario packs",
      scenariosTitle: "Four starter models for public demos and future evaluations.",
      workspaceTitle: "Self-evolving script model",
      settingsTitle: "Optional LLM API",
      contractsEyebrow: "Stable surface",
      contractsTitle: "What v1.0 promises for builders.",
      deployEyebrow: "Static publishing",
      deployTitle: "Built as a static site, ready for Pages.",
      deployBody:
        "The default lab runs without a backend. LLM mode is opt-in and uses browser-local settings, so the repository never stores provider secrets."
    },
    patchTitles: {
      failureSample: "Failure sample",
      knowledgePatch: "Knowledge patch",
      toolPatch: "Tool patch",
      nextRun: "Next run"
    },
    llmForm: {
      toggle: "Use OpenAI-compatible API for script evolution",
      endpoint: "Endpoint",
      endpointHelp: "Use your own proxy endpoint if the provider does not allow browser CORS.",
      model: "Model",
      apiKey: "API key",
      apiKeyPlaceholder: "Stored in this browser only",
      note: "Settings are saved in localStorage. They are never committed to GitHub Pages."
    },
    deploySteps: [
      { title: "Build", body: "pnpm --filter @opensupportai/site build" },
      { title: "Deploy", body: "Pages workflow uploads apps/site/dist" },
      { title: "Secure", body: "Keys stay in localStorage or behind your own proxy" }
    ],
    contractItems: [
      "Stable /v1 REST API",
      "SDK and Widget initialization",
      "Chatwoot handoff adapter",
      "Generic webhook and Slack inbound",
      "OpenAPI-style business tools"
    ],
    riskLabels: {
      low: "Low",
      medium: "Medium",
      high: "High"
    },
    evolution: {
      title: (scenario, run) => `${scenario.domain} script evolution run ${run + 1}`,
      probe: (scenario) => `Probe: ${scenario.trigger}`,
      weakSignal: (scenario) => `Weak signal: ${scenario.weakSignal}`,
      expectedPath: (scenario) =>
        `Expected path: retrieve ${scenario.knowledge[0] ?? "policy"} then check ${scenario.tools[0] ?? "tool"}.`,
      failureSample: (scenario) =>
        `${scenario.weakSignal} The current script needs one clearer clarification before handoff.`,
      knowledgePatch: (scenario) =>
        `Add a short article section for "${scenario.weakSignal}" with allowed answer, blocked promise, and handoff note.`,
      toolPatch: (scenario) =>
        `Review ${scenario.tools[0] ?? "primary tool"} metadata: required fields, allowed_hosts, timeout_ms, and answer_template.`,
      nextRun: (scenario) =>
        `Generate 6 variants across ${scenario.channels.join(", ")} and require one negative test for missing identity.`
    },
    errors: {
      generic: "Scenario evolution failed",
      llmApiKey: "LLM mode requires an API key",
      llmEndpoint: "LLM mode requires an endpoint",
      llmRequest: (status) => `LLM request failed with ${status}`,
      llmNoContent: "LLM response did not include content",
      llmNotJson: "LLM response was not JSON"
    },
    llmSystemPrompt:
      "Return compact JSON only. Build an OpenSupportAI support scenario evolution result. All visible strings must be English. Do not include secrets.",
    scenarios: englishScenarios
  },
  zh: {
    htmlLang: "zh-CN",
    meta: {
      title: "OpenSupportAI 场景实验室",
      description: "OpenSupportAI 是一套开源、可嵌入的智能客服运行时，包含场景进化演示。"
    },
    nav: {
      label: "主导航",
      scenarios: "应用场景",
      contracts: "稳定契约",
      deploy: "静态发布",
      repository: "代码仓库",
      switchLocale: "英文版"
    },
    hero: {
      eyebrow: "OpenSupportAI v1.0",
      title: "可自测脚本的智能客服运行时场景实验室。",
      body: "这是面向客服流程的公开官网和演示模型：定义场景、生成用户脚本、模拟回答路径、评分失败点，并提出下一轮知识库或工具配置补丁。",
      run: "运行进化循环",
      running: "正在运行",
      publishPath: "发布路径"
    },
    console: {
      aria: "场景进化控制台",
      activeScenario: "当前场景",
      llmAssisted: "模型辅助",
      localSimulator: "本地模拟",
      readiness: "可用度",
      risk: "风险",
      runs: "轮次",
      steps: ["生成客服脚本", "模拟检索和工具", "评分回答质量", "草拟下一次补丁"],
      fallbackSuffix: "已显示确定性本地回退结果。",
      loadingLabel: "正在生成场景进化结果"
    },
    sections: {
      scenariosEyebrow: "应用场景",
      scenariosTitle: "四套用于公开演示和后续评估的起始模型。",
      workspaceTitle: "脚本自进化模型",
      settingsTitle: "可选模型接口",
      contractsEyebrow: "稳定边界",
      contractsTitle: "v1.0 面向构建者承诺的能力。",
      deployEyebrow: "静态发布",
      deployTitle: "以静态站点构建，可直接发布到页面托管。",
      deployBody:
        "默认实验室不依赖后端。模型模式为可选项，并使用浏览器本地设置，因此仓库不会保存服务商密钥。"
    },
    patchTitles: {
      failureSample: "失败样本",
      knowledgePatch: "知识库补丁",
      toolPatch: "工具补丁",
      nextRun: "下一轮"
    },
    llmForm: {
      toggle: "使用兼容 OpenAI 的接口生成脚本进化结果",
      endpoint: "接口地址",
      endpointHelp: "如果服务商不允许浏览器跨域，请使用自己的代理接口。",
      model: "模型",
      apiKey: "接口密钥",
      apiKeyPlaceholder: "仅保存在当前浏览器",
      note: "设置保存在 localStorage 中，不会提交到 GitHub Pages。"
    },
    deploySteps: [
      { title: "构建", body: "pnpm --filter @opensupportai/site build" },
      { title: "部署", body: "页面工作流上传 apps/site/dist" },
      { title: "安全", body: "密钥保存在 localStorage 或你自己的代理之后" }
    ],
    contractItems: [
      "稳定的 /v1 REST API",
      "开发包和网页组件初始化",
      "人工客服转接适配器",
      "通用入站接口和聊天工具入站",
      "开放接口风格的业务工具"
    ],
    riskLabels: {
      low: "低",
      medium: "中",
      high: "高"
    },
    evolution: {
      title: (scenario, run) => `${scenario.domain}脚本进化第 ${run + 1} 轮`,
      probe: (scenario) => `测试问题：${scenario.trigger}`,
      weakSignal: (scenario) => `薄弱信号：${scenario.weakSignal}`,
      expectedPath: (scenario) =>
        `预期路径：先检索${scenario.knowledge[0] ?? "政策"}，再检查${scenario.tools[0] ?? "工具"}。`,
      failureSample: (scenario) =>
        `${scenario.weakSignal} 当前脚本需要在转人工前补充一个更清晰的澄清问题。`,
      knowledgePatch: (scenario) =>
        `为“${scenario.weakSignal}”新增短文档，写清允许回答、禁止承诺和转人工说明。`,
      toolPatch: (scenario) =>
        `复核 ${scenario.tools[0] ?? "主工具"} 的元数据：必填字段、允许主机、超时时间和回答模板。`,
      nextRun: (scenario) =>
        `围绕${scenario.channels.join("、")}生成 6 个变体，并加入一个缺少身份信息的反向测试。`
    },
    errors: {
      generic: "场景进化失败",
      llmApiKey: "模型模式需要接口密钥",
      llmEndpoint: "模型模式需要接口地址",
      llmRequest: (status) => `模型请求失败，状态码 ${status}`,
      llmNoContent: "模型响应没有返回内容",
      llmNotJson: "模型响应不是 JSON"
    },
    llmSystemPrompt:
      "只返回紧凑 JSON。生成 OpenSupportAI 客服场景进化结果。所有可见字符串必须使用简体中文。不要包含密钥。",
    scenarios: chineseScenarios
  }
};

function App() {
  const initialLocale = getInitialLocale();
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [selectedId, setSelectedId] = useState<ScenarioId>("saas-billing");
  const [settings, setSettings] = useState<LlmSettings>(() => loadSettings());
  const [runCount, setRunCount] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const copy = siteCopy[locale];
  const scenarioById = useMemo(() => toScenarioMap(copy.scenarios), [copy.scenarios]);
  const [result, setResult] = useState<EvolutionResult>(() =>
    localEvolution(firstScenario(siteCopy[initialLocale]), 0, siteCopy[initialLocale])
  );

  useEffect(() => {
    document.documentElement.lang = copy.htmlLang;
    document.title = copy.meta.title;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute("content", copy.meta.description);
    saveLocale(locale);
  }, [copy, locale]);

  const scenario = scenarioById[selectedId] ?? firstScenario(copy);
  const deployIcons: ReactNode[] = [
    <Code size={20} />,
    <GlobeHemisphereEast size={20} />,
    <ShieldCheck size={20} />
  ];

  async function runEvolution() {
    setRunning(true);
    setError(undefined);
    const nextRun = runCount + 1;
    setRunCount(nextRun);
    try {
      const nextResult = settings.enabled
        ? await llmEvolution(scenario, settings, nextRun, copy)
        : await delay(localEvolution(scenario, nextRun, copy), 520);
      setResult(nextResult);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : copy.errors.generic);
      setResult(localEvolution(scenario, nextRun, copy));
    } finally {
      setRunning(false);
    }
  }

  function updateSettings(next: LlmSettings) {
    setSettings(next);
    saveSettings(next);
  }

  function selectScenario(id: ScenarioId) {
    const nextScenario = scenarioById[id];
    if (!nextScenario) {
      return;
    }
    setSelectedId(id);
    setResult(localEvolution(nextScenario, runCount, copy));
    setError(undefined);
  }

  function changeLocale(nextLocale: Locale) {
    const nextCopy = siteCopy[nextLocale];
    const nextScenario = toScenarioMap(nextCopy.scenarios)[selectedId] ?? firstScenario(nextCopy);
    updateUrlLocale(nextLocale);
    setLocale(nextLocale);
    setSelectedId(nextScenario.id);
    setResult(localEvolution(nextScenario, runCount, nextCopy));
    setError(undefined);
  }

  return (
    <main className="site-shell">
      <header className="topbar">
        <a className="brand-lockup" href="#lab" aria-label={copy.meta.title}>
          <img src={`${import.meta.env.BASE_URL}opensupportai.png`} alt="OpenSupportAI" />
        </a>
        <nav aria-label={copy.nav.label}>
          <a href="#scenarios">{copy.nav.scenarios}</a>
          <a href="#contracts">{copy.nav.contracts}</a>
          <a href="#deploy">{copy.nav.deploy}</a>
          <button
            className="language-action"
            onClick={() => changeLocale(locale === "en" ? "zh" : "en")}
            type="button"
          >
            {copy.nav.switchLocale}
          </button>
          <a href="https://github.com/HiClawBot/OpenSupportAI" target="_blank" rel="noreferrer">
            <GithubLogo size={18} weight="regular" />
            {copy.nav.repository}
          </a>
        </nav>
      </header>

      <section className="lab-stage" id="lab">
        <div className="stage-copy">
          <p className="eyebrow">{copy.hero.eyebrow}</p>
          <h1>{copy.hero.title}</h1>
          <p>{copy.hero.body}</p>
          <div className="stage-actions">
            <button className="primary-action" onClick={() => void runEvolution()}>
              <Pulse size={18} />
              {running ? copy.hero.running : copy.hero.run}
            </button>
            <a className="secondary-action" href="#deploy">
              {copy.hero.publishPath}
              <ArrowRight size={16} />
            </a>
          </div>
        </div>

        <section className="lab-console" aria-label={copy.console.aria}>
          <div className="console-header">
            <div>
              <span>{copy.console.activeScenario}</span>
              <strong>{scenario.name}</strong>
            </div>
            <span className={`source-pill ${result.source === "llm" ? "is-live" : ""}`}>
              {result.source === "llm" ? copy.console.llmAssisted : copy.console.localSimulator}
            </span>
          </div>

          <div className="loop-grid">
            <Metric label={copy.console.readiness} value={`${result.score}`} suffix="/100" />
            <Metric label={copy.console.risk} value={copy.riskLabels[result.risk]} />
            <Metric label={copy.console.runs} value={`${runCount}`} />
          </div>

          <ol className="loop-steps">
            {copy.console.steps.map((step, index) => (
              <li key={step} style={{ "--delay": `${index * 80}ms` } as CSSProperties}>
                <span>{index + 1}</span>
                {step}
              </li>
            ))}
          </ol>

          <div className="result-block">
            <h2>{result.title}</h2>
            <ul>
              {result.generatedScript.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>

          {running ? <SkeletonResult label={copy.console.loadingLabel} /> : null}
          {error ? (
            <p className="inline-error">
              <WarningCircle size={18} />
              {error}. {copy.console.fallbackSuffix}
            </p>
          ) : null}
        </section>
      </section>

      <section className="scenario-section" id="scenarios">
        <div className="section-heading">
          <p className="eyebrow">{copy.sections.scenariosEyebrow}</p>
          <h2>{copy.sections.scenariosTitle}</h2>
        </div>
        <div className="scenario-grid">
          {copy.scenarios.map((item) => (
            <button
              className={`scenario-card ${item.id === selectedId ? "is-selected" : ""}`}
              key={item.id}
              onClick={() => selectScenario(item.id)}
            >
              <span>{item.label}</span>
              <strong>{item.name}</strong>
              <small>{item.summary}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="workspace">
        <div className="workspace-main">
          <PanelTitle icon={<GitBranch size={22} />} title={copy.sections.workspaceTitle} />
          <div className="trace">
            {scenario.transcript.map((line, index) => (
              <div className={`trace-line is-${line.role}`} key={`${line.role}-${line.text}`}>
                <span>{index + 1}</span>
                <p>{line.text}</p>
              </div>
            ))}
          </div>
          <div className="patch-grid">
            <PatchBlock title={copy.patchTitles.failureSample} body={result.failureSample} />
            <PatchBlock title={copy.patchTitles.knowledgePatch} body={result.knowledgePatch} />
            <PatchBlock title={copy.patchTitles.toolPatch} body={result.toolPatch} />
            <PatchBlock title={copy.patchTitles.nextRun} body={result.nextRun} />
          </div>
        </div>

        <aside className="settings-panel">
          <PanelTitle icon={<BracketsCurly size={22} />} title={copy.sections.settingsTitle} />
          <LlmSettingsForm copy={copy} settings={settings} onChange={updateSettings} />
        </aside>
      </section>

      <section className="contract-band" id="contracts">
        <div className="section-heading">
          <p className="eyebrow">{copy.sections.contractsEyebrow}</p>
          <h2>{copy.sections.contractsTitle}</h2>
        </div>
        <div className="contract-list">
          {copy.contractItems.map((item, index) => (
            <div className="contract-row" key={item}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{item}</strong>
              <CheckCircle size={20} />
            </div>
          ))}
        </div>
      </section>

      <section className="deploy-band" id="deploy">
        <div>
          <p className="eyebrow">{copy.sections.deployEyebrow}</p>
          <h2>{copy.sections.deployTitle}</h2>
          <p>{copy.sections.deployBody}</p>
        </div>
        <div className="deploy-steps">
          {copy.deploySteps.map((step, index) => (
            <Step icon={deployIcons[index] ?? <Code size={20} />} key={step.title} {...step} />
          ))}
        </div>
      </section>
    </main>
  );
}

function Metric(props: { label: string; value: string; suffix?: string }) {
  return (
    <div className="metric">
      <span>{props.label}</span>
      <strong>
        {props.value}
        {props.suffix ? <small>{props.suffix}</small> : null}
      </strong>
    </div>
  );
}

function PanelTitle(props: { icon: ReactNode; title: string }) {
  return (
    <div className="panel-title">
      {props.icon}
      <h2>{props.title}</h2>
    </div>
  );
}

function PatchBlock(props: { title: string; body: string }) {
  return (
    <article className="patch-block">
      <span>{props.title}</span>
      <p>{props.body}</p>
    </article>
  );
}

function Step(props: { icon: ReactNode; title: string; body: string }) {
  return (
    <article className="deploy-step">
      {props.icon}
      <strong>{props.title}</strong>
      <p>{props.body}</p>
    </article>
  );
}

function SkeletonResult(props: { label: string }) {
  return (
    <div className="skeleton-result" aria-label={props.label}>
      <span />
      <span />
      <span />
    </div>
  );
}

function LlmSettingsForm(props: {
  copy: SiteCopy;
  settings: LlmSettings;
  onChange: (settings: LlmSettings) => void;
}) {
  function patch(next: Partial<LlmSettings>) {
    props.onChange({
      ...props.settings,
      ...next
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }

  return (
    <form className="llm-form" onSubmit={submit}>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={props.settings.enabled}
          onChange={(event) => patch({ enabled: event.currentTarget.checked })}
        />
        <span>{props.copy.llmForm.toggle}</span>
      </label>

      <label>
        <span>{props.copy.llmForm.endpoint}</span>
        <input
          value={props.settings.endpoint}
          onChange={(event) => patch({ endpoint: event.currentTarget.value })}
          placeholder="https://api.openai.com/v1"
        />
        <small>{props.copy.llmForm.endpointHelp}</small>
      </label>

      <label>
        <span>{props.copy.llmForm.model}</span>
        <input
          value={props.settings.model}
          onChange={(event) => patch({ model: event.currentTarget.value })}
          placeholder="gpt-4.1-mini"
        />
      </label>

      <label>
        <span>{props.copy.llmForm.apiKey}</span>
        <input
          value={props.settings.apiKey}
          onChange={(event) => patch({ apiKey: event.currentTarget.value })}
          placeholder={props.copy.llmForm.apiKeyPlaceholder}
          type="password"
        />
      </label>

      <p className="form-note">
        <Database size={16} />
        {props.copy.llmForm.note}
      </p>
    </form>
  );
}

function localEvolution(scenario: ScenarioPack, run: number, copy: SiteCopy): EvolutionResult {
  const scoreBase = {
    "saas-billing": 84,
    "commerce-care": 78,
    "developer-docs": 82,
    "internal-it": 75
  } satisfies Record<ScenarioId, number>;
  const score = Math.min(96, scoreBase[scenario.id] + (run % 5) * 3);
  const risk: Risk = score > 88 ? "low" : score > 79 ? "medium" : "high";

  return {
    source: "local",
    title: copy.evolution.title(scenario, run),
    score,
    risk,
    generatedScript: [
      copy.evolution.probe(scenario),
      copy.evolution.weakSignal(scenario),
      copy.evolution.expectedPath(scenario)
    ],
    failureSample: copy.evolution.failureSample(scenario),
    knowledgePatch: copy.evolution.knowledgePatch(scenario),
    toolPatch: copy.evolution.toolPatch(scenario),
    nextRun: copy.evolution.nextRun(scenario)
  };
}

async function llmEvolution(
  scenario: ScenarioPack,
  settings: LlmSettings,
  run: number,
  copy: SiteCopy
): Promise<EvolutionResult> {
  if (!settings.apiKey.trim()) {
    throw new Error(copy.errors.llmApiKey);
  }
  if (!settings.endpoint.trim()) {
    throw new Error(copy.errors.llmEndpoint);
  }

  const response = await fetch(`${settings.endpoint.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: copy.llmSystemPrompt
        },
        {
          role: "user",
          content: JSON.stringify({
            scenario,
            language: copy.htmlLang,
            requiredKeys: [
              "title",
              "score",
              "risk",
              "generatedScript",
              "failureSample",
              "knowledgePatch",
              "toolPatch",
              "nextRun"
            ]
          })
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(copy.errors.llmRequest(response.status));
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(copy.errors.llmNoContent);
  }

  const parsed = parseEvolutionJson(content, copy);
  return mergeEvolution(localEvolution(scenario, run, copy), parsed);
}

function mergeEvolution(
  fallback: EvolutionResult,
  parsed: Partial<EvolutionResult>
): EvolutionResult {
  return {
    ...fallback,
    title: typeof parsed.title === "string" ? parsed.title : fallback.title,
    score:
      typeof parsed.score === "number"
        ? Math.max(0, Math.min(100, Math.round(parsed.score)))
        : fallback.score,
    risk: normalizeRisk(parsed.risk) ?? fallback.risk,
    generatedScript: Array.isArray(parsed.generatedScript)
      ? parsed.generatedScript.filter((item): item is string => typeof item === "string")
      : fallback.generatedScript,
    failureSample:
      typeof parsed.failureSample === "string" ? parsed.failureSample : fallback.failureSample,
    knowledgePatch:
      typeof parsed.knowledgePatch === "string" ? parsed.knowledgePatch : fallback.knowledgePatch,
    toolPatch: typeof parsed.toolPatch === "string" ? parsed.toolPatch : fallback.toolPatch,
    nextRun: typeof parsed.nextRun === "string" ? parsed.nextRun : fallback.nextRun,
    source: "llm"
  };
}

function parseEvolutionJson(content: string, copy: SiteCopy): Partial<EvolutionResult> {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced?.[1] ?? trimmed;
  const objectStart = candidate.indexOf("{");
  const objectEnd = candidate.lastIndexOf("}");
  if (objectStart < 0 || objectEnd < objectStart) {
    throw new Error(copy.errors.llmNotJson);
  }
  return JSON.parse(candidate.slice(objectStart, objectEnd + 1)) as Partial<EvolutionResult>;
}

function normalizeRisk(value: unknown): Risk | undefined {
  return value === "low" || value === "medium" || value === "high" ? value : undefined;
}

function toScenarioMap(scenarios: ScenarioPack[]) {
  return scenarios.reduce<Record<ScenarioId, ScenarioPack>>(
    (accumulator, scenario) => {
      accumulator[scenario.id] = scenario;
      return accumulator;
    },
    {} as Record<ScenarioId, ScenarioPack>
  );
}

function firstScenario(copy: SiteCopy): ScenarioPack {
  const scenario = copy.scenarios[0];
  if (!scenario) {
    throw new Error("Site copy requires at least one scenario.");
  }
  return scenario;
}

function getInitialLocale(): Locale {
  if (typeof window === "undefined") {
    return "en";
  }
  const urlLocale = new URLSearchParams(window.location.search).get("lang");
  if (urlLocale === "zh" || urlLocale === "en") {
    return urlLocale;
  }
  const storedLocale = localStorage.getItem("opensupportai.site.locale");
  if (storedLocale === "zh" || storedLocale === "en") {
    return storedLocale;
  }
  return "en";
}

function updateUrlLocale(locale: Locale) {
  if (typeof window === "undefined") {
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.set("lang", locale);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function loadSettings(): LlmSettings {
  if (typeof localStorage === "undefined") {
    return defaultSettings;
  }
  try {
    const value = localStorage.getItem("opensupportai.site.llm");
    if (!value) {
      return defaultSettings;
    }
    return {
      ...defaultSettings,
      ...(JSON.parse(value) as Partial<LlmSettings>)
    };
  } catch {
    return defaultSettings;
  }
}

function saveSettings(settings: LlmSettings) {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.setItem("opensupportai.site.llm", JSON.stringify(settings));
}

function saveLocale(locale: Locale) {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.setItem("opensupportai.site.locale", locale);
}

function delay<T>(value: T, ms: number): Promise<T> {
  return new Promise((resolve) => {
    window.setTimeout(() => resolve(value), ms);
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
