import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { ArrowRight, CheckCircle, CreditCard, ShieldCheck, TrendUp } from "@phosphor-icons/react";
import { OpenSupportAI } from "@opensupportai/widget";
import "./styles.css";

const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

function App() {
  useEffect(() => {
    const controller = OpenSupportAI.init({
      apiUrl,
      projectId: "proj_demo",
      publicKey: "pk_demo",
      inboxId: "inbox_default",
      user: {
        id: "demo_user_8462",
        name: "Mina Hart",
        email: "mina.hart@example.com"
      },
      locale: "zh-CN"
    });
    return () => controller.destroy();
  }, []);

  return (
    <main>
      <nav className="nav">
        <div className="brand">
          <img src="/opensupportai-mark.png" alt="" />
          <span>Northstar Billing</span>
        </div>
        <a href="#billing">Account</a>
      </nav>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Demo host app</p>
          <h1>Billing operations with embedded AI support.</h1>
          <p>
            This page behaves like a SaaS customer portal. The support widget in the lower corner is
            powered by the local OpenSupportAI API and demo knowledge base.
          </p>
          <div className="actions">
            <a href="#billing" className="primary">
              View billing <ArrowRight size={16} />
            </a>
            <code>projectId: proj_demo</code>
          </div>
        </div>
        <div className="summary">
          <div>
            <span>Plan</span>
            <strong>Growth Annual</strong>
          </div>
          <div>
            <span>Renewal</span>
            <strong>2026-09-24</strong>
          </div>
          <div>
            <span>Seats</span>
            <strong>47</strong>
          </div>
        </div>
      </section>

      <section className="billing" id="billing">
        <div className="section-title">
          <p className="eyebrow">Billing workspace</p>
          <h2>Customer-facing controls</h2>
        </div>
        <div className="grid">
          <Panel icon={<CreditCard />} title="Subscription">
            <p>
              Growth Annual renews in 99 days. Cancellation keeps access until the current cycle
              ends.
            </p>
            <button>Manage plan</button>
          </Panel>
          <Panel icon={<ShieldCheck />} title="Payment">
            <p>Primary card ending in 8421. Receipts are sent to billing@northstar.example.</p>
            <button>Update method</button>
          </Panel>
          <Panel icon={<TrendUp />} title="Usage">
            <p>API volume is tracking 18.4% below the plan threshold for this cycle.</p>
            <button>View usage</button>
          </Panel>
        </div>
      </section>

      <section className="prompt-strip">
        <CheckCircle size={20} />
        <span>
          Try asking: “请帮我查订单 ORD-2026-1001”, “我的订阅状态是什么？” or “我要转人工”。
        </span>
      </section>
    </main>
  );
}

function Panel(props: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <article className="panel">
      <div className="panel-icon">{props.icon}</div>
      <h3>{props.title}</h3>
      {props.children}
    </article>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
