import {
  StrictMode,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
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

type ScenarioId = "saas-billing" | "commerce-care" | "developer-docs" | "internal-it";

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
  risk: "low" | "medium" | "high";
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

const defaultSettings: LlmSettings = {
  enabled: false,
  endpoint: "https://api.openai.com/v1",
  model: "gpt-4.1-mini",
  apiKey: ""
};

const scenarioPacks: ScenarioPack[] = [
  {
    id: "saas-billing",
    name: "SaaS Billing Support",
    label: "账单 / 订阅",
    domain: "B2B SaaS",
    summary:
      "Covers invoices, renewal dates, seat counts, cancellation policy, order lookup, and handoff decisions.",
    channels: ["Widget", "Slack inbound", "Chatwoot handoff"],
    knowledge: ["Cancellation policy", "Invoice receipt rules", "Annual plan renewal window"],
    tools: ["demo.order_lookup", "demo.subscription_lookup", "openapi.external_order_lookup"],
    trigger: "请帮我查订单 ORD-2026-1001，我还想确认续费日期。",
    weakSignal: "User asks for refund timing after a failed card update.",
    transcript: [
      { role: "user", text: "请帮我查订单 ORD-2026-1001" },
      { role: "tool", text: "demo.order_lookup returned paid / Growth Annual / billing email" },
      { role: "ai", text: "订单已支付，收据发送到 billing@northstar.example。" },
      { role: "handoff", text: "Refund request remains a human-reviewed path." }
    ]
  },
  {
    id: "commerce-care",
    name: "Commerce Support Desk",
    label: "电商 / 售后",
    domain: "Online retail",
    summary:
      "Models shipment delays, return windows, damaged item claims, inventory checks, and escalation rules.",
    channels: ["Generic webhook", "Widget", "Agent assist"],
    knowledge: ["Return window by category", "Damaged item photo policy", "Carrier delay script"],
    tools: ["openapi.shipment_lookup", "openapi.return_eligibility"],
    trigger: "包裹显示已签收，但我没有收到，能帮我查物流吗？",
    weakSignal: "User says a returned item was rejected without a reason.",
    transcript: [
      { role: "user", text: "我的咖啡机退货被拒绝了。" },
      { role: "ai", text: "我会先核对品类退货窗口和拒绝原因。" },
      { role: "tool", text: "return_eligibility needs order_id and item category." },
      { role: "handoff", text: "Missing order id becomes a guided clarification script." }
    ]
  },
  {
    id: "developer-docs",
    name: "Developer Docs Support",
    label: "开发者 / 文档",
    domain: "API platform",
    summary:
      "Tests SDK onboarding, webhook signatures, API errors, version policy, and source-grounded answers.",
    channels: ["Docs widget", "GitHub issue triage", "Chatwoot handoff"],
    knowledge: ["SDK quickstart", "Webhook signature guide", "Public contracts"],
    tools: ["openapi.status_lookup", "openapi.issue_classifier"],
    trigger: "我在验证 Slack webhook 签名时一直 401，应该检查什么？",
    weakSignal: "User mixes old v0.8 docs with v1.0 public contract behavior.",
    transcript: [
      { role: "user", text: "Slack callback 401，payload 是 JSON。" },
      { role: "ai", text: "先确认 timestamp、signature header 和 signing secret。" },
      { role: "ai", text: "如果经过代理，确保原始 JSON body 语义没有改变。" },
      { role: "handoff", text: "If headers are unavailable, route to developer support." }
    ]
  },
  {
    id: "internal-it",
    name: "Internal IT Helpdesk",
    label: "内部 IT",
    domain: "Employee support",
    summary:
      "Covers access requests, device issues, VPN onboarding, policy lookup, and approval handoff.",
    channels: ["Slack inbound", "Generic webhook", "Ops dashboard"],
    knowledge: ["VPN setup", "Device replacement policy", "Access approval matrix"],
    tools: ["openapi.employee_lookup", "openapi.ticket_draft"],
    trigger: "我需要临时访问财务看板，审批人是谁？",
    weakSignal: "User requests access outside their department boundary.",
    transcript: [
      { role: "user", text: "我需要临时访问财务看板。" },
      { role: "ai", text: "我可以说明申请流程，但不能直接授予权限。" },
      { role: "tool", text: "employee_lookup confirms department mismatch." },
      { role: "handoff", text: "Access request is routed to approval workflow." }
    ]
  }
];

const scenarioById = scenarioPacks.reduce<Record<ScenarioId, ScenarioPack>>(
  (accumulator, scenario) => {
    accumulator[scenario.id] = scenario;
    return accumulator;
  },
  {} as Record<ScenarioId, ScenarioPack>
);

function App() {
  const [selectedId, setSelectedId] = useState<ScenarioId>("saas-billing");
  const [settings, setSettings] = useState<LlmSettings>(() => loadSettings());
  const [result, setResult] = useState<EvolutionResult>(() =>
    localEvolution(scenarioById["saas-billing"], 0)
  );
  const [runCount, setRunCount] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const scenario = scenarioById[selectedId];
  const contractItems = useMemo(
    () => [
      "Stable /v1 REST API",
      "SDK and Widget initialization",
      "Chatwoot handoff adapter",
      "Generic webhook and Slack inbound",
      "OpenAPI-style business tools"
    ],
    []
  );

  if (!scenario) {
    return null;
  }

  async function runEvolution() {
    setRunning(true);
    setError(undefined);
    const nextRun = runCount + 1;
    setRunCount(nextRun);
    try {
      const nextResult = settings.enabled
        ? await llmEvolution(scenario, settings, nextRun)
        : await delay(localEvolution(scenario, nextRun), 520);
      setResult(nextResult);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Scenario evolution failed");
      setResult(localEvolution(scenario, nextRun));
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
    setResult(localEvolution(nextScenario, runCount));
    setError(undefined);
  }

  return (
    <main className="site-shell">
      <header className="topbar">
        <a className="brand-lockup" href="#lab" aria-label="OpenSupportAI Scenario Lab">
          <img src={`${import.meta.env.BASE_URL}opensupportai.png`} alt="OpenSupportAI" />
        </a>
        <nav aria-label="Primary navigation">
          <a href="#scenarios">Scenarios</a>
          <a href="#contracts">Contracts</a>
          <a href="#deploy">GitHub Pages</a>
          <a href="https://github.com/HiClawBot/OpenSupportAI" target="_blank" rel="noreferrer">
            <GithubLogo size={18} weight="regular" />
            GitHub
          </a>
        </nav>
      </header>

      <section className="lab-stage" id="lab">
        <div className="stage-copy">
          <p className="eyebrow">OpenSupportAI v1.0</p>
          <h1>Scenario Lab for an AI support runtime that can test its own scripts.</h1>
          <p>
            A public website and demo model for support workflows: define a scenario, generate a
            user script, simulate the answer path, score failures, and propose the next knowledge or
            tool patch.
          </p>
          <div className="stage-actions">
            <button className="primary-action" onClick={() => void runEvolution()}>
              <Pulse size={18} />
              {running ? "Running loop" : "Run evolution loop"}
            </button>
            <a className="secondary-action" href="#deploy">
              Publish path
              <ArrowRight size={16} />
            </a>
          </div>
        </div>

        <section className="lab-console" aria-label="Scenario evolution console">
          <div className="console-header">
            <div>
              <span>Active scenario</span>
              <strong>{scenario.name}</strong>
            </div>
            <span className={`source-pill ${result.source === "llm" ? "is-live" : ""}`}>
              {result.source === "llm" ? "LLM assisted" : "Local simulator"}
            </span>
          </div>

          <div className="loop-grid">
            <Metric label="Readiness" value={`${result.score}`} suffix="/100" />
            <Metric label="Risk" value={result.risk} />
            <Metric label="Runs" value={`${runCount}`} />
          </div>

          <ol className="loop-steps">
            {[
              "Generate support script",
              "Simulate retrieval and tools",
              "Score answer quality",
              "Draft next patch"
            ].map((step, index) => (
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

          {running ? <SkeletonResult /> : null}
          {error ? (
            <p className="inline-error">
              <WarningCircle size={18} />
              {error}. Showing deterministic local fallback.
            </p>
          ) : null}
        </section>
      </section>

      <section className="scenario-section" id="scenarios">
        <div className="section-heading">
          <p className="eyebrow">Scenario packs / 应用场景</p>
          <h2>Four starter models for public demos and future evaluations.</h2>
        </div>
        <div className="scenario-grid">
          {scenarioPacks.map((item) => (
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
          <PanelTitle icon={<GitBranch size={22} />} title="Self-evolving script model" />
          <div className="trace">
            {scenario.transcript.map((line, index) => (
              <div className={`trace-line is-${line.role}`} key={`${line.role}-${line.text}`}>
                <span>{index + 1}</span>
                <p>{line.text}</p>
              </div>
            ))}
          </div>
          <div className="patch-grid">
            <PatchBlock title="Failure sample" body={result.failureSample} />
            <PatchBlock title="Knowledge patch" body={result.knowledgePatch} />
            <PatchBlock title="Tool patch" body={result.toolPatch} />
            <PatchBlock title="Next run" body={result.nextRun} />
          </div>
        </div>

        <aside className="settings-panel">
          <PanelTitle icon={<BracketsCurly size={22} />} title="Optional LLM API" />
          <LlmSettingsForm settings={settings} onChange={updateSettings} />
        </aside>
      </section>

      <section className="contract-band" id="contracts">
        <div className="section-heading">
          <p className="eyebrow">Stable surface / 稳定契约</p>
          <h2>What v1.0 promises for builders.</h2>
        </div>
        <div className="contract-list">
          {contractItems.map((item, index) => (
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
          <p className="eyebrow">GitHub Pages / 静态发布</p>
          <h2>Built as a static site, ready for Pages.</h2>
          <p>
            The default lab runs without a backend. LLM mode is opt-in and uses browser-local
            settings, so the repository never stores provider secrets.
          </p>
        </div>
        <div className="deploy-steps">
          <Step
            icon={<Code size={20} />}
            title="Build"
            body="pnpm --filter @opensupportai/site build"
          />
          <Step
            icon={<GlobeHemisphereEast size={20} />}
            title="Deploy"
            body="GitHub Pages workflow uploads apps/site/dist"
          />
          <Step
            icon={<ShieldCheck size={20} />}
            title="Secure"
            body="Keys stay in localStorage or behind your own proxy"
          />
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

function SkeletonResult() {
  return (
    <div className="skeleton-result" aria-label="Loading scenario evolution result">
      <span />
      <span />
      <span />
    </div>
  );
}

function LlmSettingsForm(props: {
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
        <span>Use OpenAI-compatible API for script evolution</span>
      </label>

      <label>
        <span>Endpoint</span>
        <input
          value={props.settings.endpoint}
          onChange={(event) => patch({ endpoint: event.currentTarget.value })}
          placeholder="https://api.openai.com/v1"
        />
        <small>Use your own proxy endpoint if the provider does not allow browser CORS.</small>
      </label>

      <label>
        <span>Model</span>
        <input
          value={props.settings.model}
          onChange={(event) => patch({ model: event.currentTarget.value })}
          placeholder="gpt-4.1-mini"
        />
      </label>

      <label>
        <span>API key</span>
        <input
          value={props.settings.apiKey}
          onChange={(event) => patch({ apiKey: event.currentTarget.value })}
          placeholder="Stored in this browser only"
          type="password"
        />
      </label>

      <p className="form-note">
        <Database size={16} />
        Settings are saved in localStorage. They are never committed to GitHub Pages.
      </p>
    </form>
  );
}

function localEvolution(scenario: ScenarioPack, run: number): EvolutionResult {
  const scoreBase = {
    "saas-billing": 84,
    "commerce-care": 78,
    "developer-docs": 82,
    "internal-it": 75
  } satisfies Record<ScenarioId, number>;
  const score = Math.min(96, scoreBase[scenario.id] + (run % 5) * 3);
  const risk: EvolutionResult["risk"] = score > 88 ? "low" : score > 79 ? "medium" : "high";

  return {
    source: "local",
    title: `${scenario.domain} script evolution run ${run + 1}`,
    score,
    risk,
    generatedScript: [
      `Probe: ${scenario.trigger}`,
      `Weak signal: ${scenario.weakSignal}`,
      `Expected path: retrieve ${scenario.knowledge[0] ?? "policy"} then check ${scenario.tools[0] ?? "tool"}.`
    ],
    failureSample: `${scenario.weakSignal} The current script needs one clearer clarification before handoff.`,
    knowledgePatch: `Add a short article section for "${scenario.weakSignal}" with allowed answer, blocked promise, and handoff note.`,
    toolPatch: `Review ${scenario.tools[0] ?? "primary tool"} metadata: required fields, allowed_hosts, timeout_ms, and answer_template.`,
    nextRun: `Generate 6 variants across ${scenario.channels.join(", ")} and require one negative test for missing identity.`
  };
}

async function llmEvolution(
  scenario: ScenarioPack,
  settings: LlmSettings,
  run: number
): Promise<EvolutionResult> {
  if (!settings.apiKey.trim()) {
    throw new Error("LLM mode requires an API key");
  }
  if (!settings.endpoint.trim()) {
    throw new Error("LLM mode requires an endpoint");
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
          content:
            "Return compact JSON only. Build an OpenSupportAI support scenario evolution result. Do not include secrets."
        },
        {
          role: "user",
          content: JSON.stringify({
            scenario,
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
    throw new Error(`LLM request failed with ${response.status}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("LLM response did not include content");
  }

  const parsed = parseEvolutionJson(content);
  const fallback = localEvolution(scenario, run);
  return {
    ...fallback,
    ...parsed,
    source: "llm",
    generatedScript: Array.isArray(parsed.generatedScript)
      ? parsed.generatedScript.filter((item): item is string => typeof item === "string")
      : fallback.generatedScript
  };
}

function parseEvolutionJson(content: string): Partial<EvolutionResult> {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced?.[1] ?? trimmed;
  const objectStart = candidate.indexOf("{");
  const objectEnd = candidate.lastIndexOf("}");
  if (objectStart < 0 || objectEnd < objectStart) {
    throw new Error("LLM response was not JSON");
  }
  return JSON.parse(candidate.slice(objectStart, objectEnd + 1)) as Partial<EvolutionResult>;
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
