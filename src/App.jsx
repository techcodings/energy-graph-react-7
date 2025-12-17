import React, { useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;

// ---------------------- OpenAI helpers ----------------------

async function getEmbedding(text) {
  const clean = (text || "").replace(/\n/g, " ").trim() || "empty";
  const resp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: clean,
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error("Embedding error: " + errText);
  }
  const data = await resp.json();
  return data.data[0].embedding;
}

async function gptPlainText(prompt) {
  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      instructions:
        "You are an expert in power systems, renewable integration, and energy policy. " +
        "Always answer in plain text paragraphs with no markdown headings or bullet characters.",
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: prompt }],
        },
      ],
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error("GPT error: " + errText);
  }
  const data = await resp.json();
  return (data.output_text || "").trim();
}

// ---------------------- Math helpers ----------------------

function dot(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function norm(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s);
}

function cosineSim(a, b) {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return 0;
  return dot(a, b) / (na * nb);
}

// ---------------------- Demo Data ----------------------

const DEMO_PAPERS = [
  {
    id: "arxiv_demo_1",
    title: "Cascading failures in power grids with high renewable penetration",
    summary:
      "This paper studies how increased wind and solar generation can change the propagation of disturbances and cause cascading outages.",
    published: "2021-03-15",
  },
];

const DEMO_EVENTS = [
  {
    external_id: "event_demo_1",
    name: "2021 monsoon storm blackout",
    description:
      "Widespread outages in the coastal region due to transmission tower failure and flooding.",
    start_time: "2021-07-12T02:00",
    end_time: "2021-07-12T10:00",
    region: "Tamil Nadu",
    asset_type: "Transmission",
    severity: 0.9,
  },
];

const DEMO_POLICIES = [
  {
    external_id: "policy_demo_1",
    name: "Solar rooftop subsidy phase II",
    description:
      "Capital subsidy for residential rooftop PV with performance-based incentives for high performance.",
    jurisdiction: "India",
    start_date: "2020-01-01",
    end_date: "2025-12-31",
    category: "Subsidy",
  },
];

// ---------------------- React App ----------------------

function App() {
  const [nodesMap, setNodesMap] = useState({});
  const [edges, setEdges] = useState([]);
  const embeddingsRef = useRef({});

  const [error, setError] = useState("");
  const [loadingIngest, setLoadingIngest] = useState(false);

  // --- Data State (Now Objects, not JSON strings) ---
  const [activeTab, setActiveTab] = useState("papers");
  const [papers, setPapers] = useState(DEMO_PAPERS);
  const [events, setEvents] = useState(DEMO_EVENTS);
  const [policies, setPolicies] = useState(DEMO_POLICIES);

  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedNodeSummary, setSelectedNodeSummary] = useState("");
  const [loadingSummary, setLoadingSummary] = useState(false);

  const [ragQuery, setRagQuery] = useState(
    "Why are some regions high-risk for cascading outages when renewables increase?"
  );
  const [ragAnswer, setRagAnswer] = useState("");
  const [ragContexts, setRagContexts] = useState([]);
  const [loadingRag, setLoadingRag] = useState(false);

  // ---------- Data Management Handlers ----------

  const resetToDemoData = () => {
    if (window.confirm("Discard changes and reset to default demo data?")) {
      setPapers(DEMO_PAPERS);
      setEvents(DEMO_EVENTS);
      setPolicies(DEMO_POLICIES);
      setError("");
    }
  };

  const updateItem = (category, index, field, value) => {
    if (category === "papers") {
      const newArr = [...papers];
      newArr[index] = { ...newArr[index], [field]: value };
      setPapers(newArr);
    } else if (category === "events") {
      const newArr = [...events];
      newArr[index] = { ...newArr[index], [field]: value };
      setEvents(newArr);
    } else if (category === "policies") {
      const newArr = [...policies];
      newArr[index] = { ...newArr[index], [field]: value };
      setPolicies(newArr);
    }
  };

  const addItem = (category) => {
    const id = Math.random().toString(36).substr(2, 9);
    if (category === "papers") {
      setPapers([
        ...papers,
        { id: `paper_${id}`, title: "", summary: "", published: "" },
      ]);
    } else if (category === "events") {
      setEvents([
        ...events,
        {
          external_id: `evt_${id}`,
          name: "",
          description: "",
          region: "",
          asset_type: "",
          severity: 0.5,
          start_time: "",
          end_time: "",
        },
      ]);
    } else if (category === "policies") {
      setPolicies([
        ...policies,
        {
          external_id: `pol_${id}`,
          name: "",
          description: "",
          jurisdiction: "",
          category: "",
          start_date: "",
          end_date: "",
        },
      ]);
    }
  };

  const deleteItem = (category, index) => {
    if (category === "papers") {
      setPapers(papers.filter((_, i) => i !== index));
    } else if (category === "events") {
      setEvents(events.filter((_, i) => i !== index));
    } else if (category === "policies") {
      setPolicies(policies.filter((_, i) => i !== index));
    }
  };

  // ---------- graph helpers ----------

  const addNode = (id, attrs, embedding) => {
    setNodesMap((prev) => {
      const existing = prev[id] || {};
      const updated = { ...existing, id, ...attrs };
      return { ...prev, [id]: updated };
    });
    if (embedding) {
      embeddingsRef.current[id] = embedding;
    }
  };

  const addEdge = (source, target, relation) => {
    setEdges((prev) => [...prev, { source, target, relation }]);
  };

  const resetGraph = () => {
    setNodesMap({});
    setEdges([]);
    embeddingsRef.current = {};
    setSelectedNodeId(null);
    setSelectedNodeSummary("");
    setRagAnswer("");
    setRagContexts([]);
  };

  // ---------- ingestion ----------

  const ingestAll = async () => {
    if (!OPENAI_API_KEY) {
      setError(
        "VITE_OPENAI_API_KEY is missing. Add it in a .env file at project root."
      );
      return;
    }
    setError("");
    setLoadingIngest(true);
    try {
      resetGraph();

      // No JSON.parse needed, we use state directly!
      const paperList = papers;
      const eventList = events;
      const policyList = policies;

      // papers
      for (const p of paperList) {
        if (!p.title) continue; // skip empty
        const text = `${p.title} - ${p.summary}`;
        const emb = await getEmbedding(text);
        addNode(
          `paper:${p.id}`,
          {
            type: "Paper",
            title: p.title,
            summary: p.summary,
            published: p.published,
          },
          emb
        );
      }

      // events
      for (const e of eventList) {
        if (!e.name) continue;
        const text = `${e.name}. ${e.description}. Region: ${
          e.region || "unknown"
        }. Asset: ${e.asset_type || "unknown"}.`;
        const emb = await getEmbedding(text);
        const nodeId = `event:${e.external_id}`;
        addNode(
          nodeId,
          {
            type: "Event",
            title: e.name,
            summary: e.description,
            start_time: e.start_time,
            end_time: e.end_time,
            region: e.region,
            asset_type: e.asset_type,
            severity: parseFloat(e.severity ?? 0.5),
          },
          emb
        );
        if (e.region) {
          const locId = `location:${e.region}`;
          addNode(locId, { type: "Location", name: e.region });
          addEdge(nodeId, locId, "OCCURS_IN");
        }
      }

      // policies
      for (const p of policyList) {
        if (!p.name) continue;
        const text = `${p.name}. ${p.description}. Jurisdiction: ${
          p.jurisdiction || "unknown"
        }.`;
        const emb = await getEmbedding(text);
        const nodeId = `policy:${p.external_id}`;
        addNode(
          nodeId,
          {
            type: "Policy",
            title: p.name,
            summary: p.description,
            jurisdiction: p.jurisdiction,
            start_date: p.start_date,
            end_date: p.end_date,
            category: p.category,
          },
          emb
        );
        if (p.jurisdiction) {
          const locId = `location:${p.jurisdiction}`;
          addNode(locId, { type: "Location", name: p.jurisdiction });
          addEdge(nodeId, locId, "APPLIES_TO");
        }
      }

      // simple keyword-based link
      for (const p of paperList) {
        const pid = `paper:${p.id}`;
        for (const e of eventList) {
          const eid = `event:${e.external_id}`;
          const lowerTitle = (p.title || "").toLowerCase();
          const lowerDesc = (e.description || "").toLowerCase();
          if (lowerTitle.includes("blackout") && lowerDesc.includes("outage")) {
            addEdge(pid, eid, "MENTIONS_EVENT");
          }
        }
      }
    } catch (err) {
      console.error(err);
      setError(err.message || "Ingestion failed.");
    } finally {
      setLoadingIngest(false);
    }
  };

  // ---------- metrics & timeline ----------

  const metrics = useMemo(() => {
    const ids = Object.keys(nodesMap);
    const deg = {};
    ids.forEach((id) => {
      deg[id] = 0;
    });
    edges.forEach((e) => {
      if (deg[e.source] != null) deg[e.source] += 1;
      if (deg[e.target] != null) deg[e.target] += 1;
    });
    const N = Math.max(ids.length - 1, 1);
    const map = {};
    ids.forEach((id) => {
      const node = nodesMap[id];
      const degreeC = deg[id] / N;
      const baseRisk = node.type === "Event" ? node.severity ?? 0.5 : 0.3;
      const risk = 0.5 * baseRisk + 0.5 * degreeC;
      map[id] = { degree_centrality: degreeC, risk_score: risk };
    });
    return map;
  }, [nodesMap, edges]);

  const timeline = useMemo(() => {
    const items = [];
    Object.values(nodesMap).forEach((n) => {
      const t =
        n.start_time || n.published || n.start_date || n.end_time || n.end_date;
      if (!t) return;
      const d = new Date(t);
      if (isNaN(d.getTime())) return;
      items.push({
        id: n.id,
        type: n.type,
        title: n.title || n.name || n.id,
        time: t,
        summary: n.summary,
        region: n.region || n.jurisdiction,
        timestamp: d.getTime(),
      });
    });
    items.sort((a, b) => a.timestamp - b.timestamp);
    return items;
  }, [nodesMap]);

  // ---------- graph data ----------

  const graphData = useMemo(() => {
    const nodes = Object.values(nodesMap).map((n) => {
      const metric = metrics[n.id] || {};
      const risk = metric.risk_score ?? (n.severity ?? 0.3);
      return {
        id: n.id,
        type: n.type,
        title: n.title || n.name || n.id,
        region: n.region || n.jurisdiction || "",
        severity: n.severity,
        risk,
        raw: n,
      };
    });
    return { nodes, links: edges };
  }, [nodesMap, edges, metrics]);

  // ---------- node inspector ----------

  const handleNodeClick = (node) => {
    if (!node) return;
    setSelectedNodeId(node.id);
    setSelectedNodeSummary("");
    fetchNodeSummary(node.id);
  };

  const fetchNodeSummary = async (nodeId) => {
    const node = nodesMap[nodeId];
    if (!node) return;
    const neighbours = edges
      .filter((e) => e.source === nodeId || e.target === nodeId)
      .map((e) => (e.source === nodeId ? e.target : e.source))
      .map((id) => nodesMap[id])
      .filter(Boolean);

    const neighbourBlock = neighbours
      .map(
        (n) =>
          `id=${n.id}, type=${n.type}, title=${n.title || n.name}, summary=${
            n.summary
          }`
      )
      .join("\n");

    const prompt =
      "Summarize this energy knowledge graph node for an analyst.\n\n" +
      `Node id: ${node.id}\n` +
      `Type: ${node.type}\n` +
      `Title: ${node.title || node.name}\n` +
      `Summary: ${node.summary}\n` +
      `Region/jurisdiction: ${node.region || node.jurisdiction || ""}\n` +
      `Severity (if event): ${node.severity ?? ""}\n\n` +
      "Neighbouring nodes:\n" +
      neighbourBlock +
      "\n\nExplain in plain text: 1) what this node represents, 2) why it might be important or high-risk, " +
      "3) how it connects to surrounding events or policies. Keep it short, 2–3 paragraphs, no markdown.";

    try {
      setLoadingSummary(true);
      const text = await gptPlainText(prompt);
      setSelectedNodeSummary(text);
    } catch (err) {
      console.error(err);
      setSelectedNodeSummary("Failed to generate node summary.");
    } finally {
      setLoadingSummary(false);
    }
  };

  // ---------- RAG QA ----------

  const searchGraph = async (query, topK = 8) => {
    const ids = Object.keys(embeddingsRef.current);
    if (!ids.length) return [];
    const qEmb = await getEmbedding(query);
    const scored = ids.map((id) => ({
      id,
      score: cosineSim(qEmb, embeddingsRef.current[id]),
    }));
    scored.sort((a, b) => b.score - a.score);
    const results = [];
    for (const s of scored.slice(0, topK)) {
      const n = nodesMap[s.id];
      if (!n) continue;
      results.push({ ...n, similarity: s.score });
    }
    return results;
  };

  const submitRagQuery = async () => {
    if (!OPENAI_API_KEY) {
      setError(
        "VITE_OPENAI_API_KEY is missing. Add it in a .env file at project root."
      );
      return;
    }
    if (!ragQuery.trim()) return;
    try {
      setLoadingRag(true);
      setRagAnswer("");
      setRagContexts([]);
      const contexts = await searchGraph(ragQuery, 8);
      const ctxStr = contexts
        .map(
          (c) =>
            `[${c.id}] type=${c.type}, title=${c.title}, time=${
              c.start_time || c.published || c.start_date || ""
            }, region=${c.region || c.jurisdiction || ""}, summary=${
              c.summary
            }`
        )
        .join("\n");
      const prompt =
        "User question:\n" +
        ragQuery +
        "\n\nRelevant graph context (nodes and events):\n" +
        ctxStr +
        "\n\nUsing only this context and your own energy-domain knowledge, do the following: " +
        "1. Give a concise answer (3–6 sentences). " +
        "2. Describe which nodes are high-risk and why, focusing on outages, cascading risks, and policy gaps. " +
        "3. Describe the rough timeline of key events in simple language. " +
        "Keep the answer in plain text paragraphs, no bullet points, no markdown.";

      const text = await gptPlainText(prompt);
      setRagAnswer(text);
      setRagContexts(contexts);
    } catch (err) {
      console.error(err);
      setRagAnswer("Failed to run RAG over the graph.");
    } finally {
      setLoadingRag(false);
    }
  };

  const formatDate = (str) => {
    if (!str) return "";
    const d = new Date(str);
    if (isNaN(d.getTime())) return str;
    return d.toISOString().slice(0, 10);
  };

  const getRiskChipClass = (value) => {
    if (value >= 0.7) return "chip red";
    if (value >= 0.4) return "chip orange";
    return "chip green";
  };

  const nodeCount = Object.keys(nodesMap).length;

  // ---------- render form helper ----------

  const renderFormContent = () => {
    if (activeTab === "papers") {
      return (
        <div className="form-list">
          {papers.map((item, idx) => (
            <div key={idx} className="form-item-card">
              <div className="form-row-split">
                <input
                  type="text"
                  placeholder="Paper Title"
                  value={item.title}
                  onChange={(e) =>
                    updateItem("papers", idx, "title", e.target.value)
                  }
                  className="input-base"
                />
                <input
                  type="date"
                  value={item.published}
                  onChange={(e) =>
                    updateItem("papers", idx, "published", e.target.value)
                  }
                  className="input-base input-date"
                />
              </div>
              <textarea
                placeholder="Paper Abstract/Summary"
                value={item.summary}
                onChange={(e) =>
                  updateItem("papers", idx, "summary", e.target.value)
                }
                className="input-base input-area"
              />
              <button
                className="btn-delete"
                onClick={() => deleteItem("papers", idx)}
              >
                Remove Paper
              </button>
            </div>
          ))}
          <button className="btn-add" onClick={() => addItem("papers")}>
            + Add Paper
          </button>
        </div>
      );
    }

    if (activeTab === "events") {
      return (
        <div className="form-list">
          {events.map((item, idx) => (
            <div key={idx} className="form-item-card">
              <input
                type="text"
                placeholder="Event Name (e.g. Storm Outage)"
                value={item.name}
                onChange={(e) =>
                  updateItem("events", idx, "name", e.target.value)
                }
                className="input-base"
                style={{ fontWeight: "bold" }}
              />
              <textarea
                placeholder="Description of what happened..."
                value={item.description}
                onChange={(e) =>
                  updateItem("events", idx, "description", e.target.value)
                }
                className="input-base input-area"
              />
              <div className="form-row-split">
                <input
                  type="text"
                  placeholder="Region (e.g. Texas)"
                  value={item.region}
                  onChange={(e) =>
                    updateItem("events", idx, "region", e.target.value)
                  }
                  className="input-base"
                />
                <input
                  type="text"
                  placeholder="Asset (e.g. Grid)"
                  value={item.asset_type}
                  onChange={(e) =>
                    updateItem("events", idx, "asset_type", e.target.value)
                  }
                  className="input-base"
                />
              </div>
              <div className="form-row-split">
                <div style={{ flex: 1 }}>
                  <label className="label-mini">Start Time</label>
                  <input
                    type="datetime-local"
                    value={item.start_time}
                    onChange={(e) =>
                      updateItem("events", idx, "start_time", e.target.value)
                    }
                    className="input-base"
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="label-mini">Severity (0-1)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="1"
                    value={item.severity}
                    onChange={(e) =>
                      updateItem("events", idx, "severity", e.target.value)
                    }
                    className="input-base"
                  />
                </div>
              </div>
              <button
                className="btn-delete"
                onClick={() => deleteItem("events", idx)}
              >
                Remove Event
              </button>
            </div>
          ))}
          <button className="btn-add" onClick={() => addItem("events")}>
            + Add Event
          </button>
        </div>
      );
    }

    if (activeTab === "policies") {
      return (
        <div className="form-list">
          {policies.map((item, idx) => (
            <div key={idx} className="form-item-card">
              <input
                type="text"
                placeholder="Policy Name"
                value={item.name}
                onChange={(e) =>
                  updateItem("policies", idx, "name", e.target.value)
                }
                className="input-base"
                style={{ fontWeight: "bold" }}
              />
              <textarea
                placeholder="Policy Details..."
                value={item.description}
                onChange={(e) =>
                  updateItem("policies", idx, "description", e.target.value)
                }
                className="input-base input-area"
              />
              <div className="form-row-split">
                <input
                  type="text"
                  placeholder="Jurisdiction (e.g. USA)"
                  value={item.jurisdiction}
                  onChange={(e) =>
                    updateItem("policies", idx, "jurisdiction", e.target.value)
                  }
                  className="input-base"
                />
                <input
                  type="text"
                  placeholder="Category (e.g. Subsidy)"
                  value={item.category}
                  onChange={(e) =>
                    updateItem("policies", idx, "category", e.target.value)
                  }
                  className="input-base"
                />
              </div>
              <div className="form-row-split">
                <input
                  type="date"
                  value={item.start_date}
                  onChange={(e) =>
                    updateItem("policies", idx, "start_date", e.target.value)
                  }
                  className="input-base"
                />
                 <input
                  type="date"
                  value={item.end_date}
                  onChange={(e) =>
                    updateItem("policies", idx, "end_date", e.target.value)
                  }
                  className="input-base"
                />
              </div>
              <button
                className="btn-delete"
                onClick={() => deleteItem("policies", idx)}
              >
                Remove Policy
              </button>
            </div>
          ))}
          <button className="btn-add" onClick={() => addItem("policies")}>
            + Add Policy
          </button>
        </div>
      );
    }
  };

  return (
    <div className="app-root">
      <header className="app-header">
        <div className="app-header-left">
          <div className="app-kicker">ENERGYVERSE · GRAPH RAG STUDIO</div>
          <div className="app-header-title">
            Knowledge Graph of Energy Events
          </div>
          <div className="app-header-sub">
            Client-side knowledge graph, embeddings and RAG — powered directly
            from this React component.
          </div>
        </div>

        <div className="app-header-right">
          <a
            href="https://energy-verse-portal.netlify.app/?feature=7"
            className="btn-back-to-portal"
            target="_self"
          >
            ← Back to Portal
          </a>
          <span className="badge">
            Nodes: {nodeCount} · Edges: {edges.length}
          </span>
          <button
            onClick={ingestAll}
            disabled={loadingIngest}
            className="primary-btn"
          >
            {loadingIngest ? "Ingesting..." : "Ingest / Rebuild Graph"}
          </button>
        </div>
      </header>

      {error && (
        <div className="error-wrapper">
          <div className="error-text">{error}</div>
        </div>
      )}

      <main className="app-main">
        {/* LEFT column */}
        <section className="column">
          <div className="card card-graph">
            <div className="card-header">
              <div>
                <div className="card-title">Interactive Knowledge Graph</div>
                <div className="card-subtitle">
                  Node color = risk score · size = degree centrality
                </div>
              </div>
            </div>
            <div className="card-body">
              <div className="graph-container">
                <ForceGraph2D
                  graphData={graphData}
                  nodeLabel={(node) =>
                    `${node.title}\n${node.type || ""}${
                      node.region ? " • " + node.region : ""
                    }\nRisk: ${node.risk.toFixed(2)}`
                  }
                  nodeAutoColorBy={(node) => {
                    if (node.type === "Event") return "event";
                    if (node.type === "Policy") return "policy";
                    if (node.type === "Paper") return "paper";
                    return "other";
                  }}
                  nodeCanvasObject={(node, ctx, globalScale) => {
                    const label = node.title;
                    const metric = metrics[node.id] || {};
                    const degree = metric.degree_centrality ?? 0;
                    const radius = 4 + degree * 24;
                    const risk = node.risk ?? 0.3;
                    let color = "#22c55e";
                    if (risk >= 0.7) color = "#f97373";
                    else if (risk >= 0.4) color = "#fb923c";

                    ctx.beginPath();
                    ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
                    ctx.fillStyle = color;
                    ctx.fill();
                    ctx.lineWidth = 1;
                    ctx.strokeStyle = "#020617";
                    ctx.stroke();

                    const fontSize = 10 / globalScale;
                    ctx.font = `${fontSize}px system-ui`;
                    ctx.textAlign = "center";
                    ctx.textBaseline = "top";
                    ctx.fillStyle = "#e5e7eb";
                    ctx.fillText(
                      label.slice(0, 22),
                      node.x,
                      node.y + radius + 2
                    );
                  }}
                  linkDirectionalArrowLength={4}
                  linkDirectionalArrowRelPos={1}
                  linkColor={() => "rgba(148,163,184,0.7)"}
                  linkWidth={1}
                  onNodeClick={handleNodeClick}
                  cooldownTicks={60}
                />
              </div>
            </div>
          </div>

          <div className="card">
            <div
              className="card-header"
              style={{ justifyContent: "space-between" }}
            >
              <div>
                <div className="card-title">Ingest Data</div>
                <div className="card-subtitle">
                  Add items below, then click Ingest to build graph.
                </div>
              </div>
              <button
                onClick={resetToDemoData}
                style={{
                  fontSize: "0.75rem",
                  padding: "4px 8px",
                  background: "#334155",
                }}
              >
                Reset Default Data
              </button>
            </div>

            {/* Custom Tabs UI */}
            <div style={{ display: "flex", borderBottom: "1px solid #334155" }}>
              {["papers", "events", "policies"].map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    background: activeTab === tab ? "#1e293b" : "transparent",
                    color: activeTab === tab ? "#fff" : "#94a3b8",
                    border: "none",
                    borderBottom:
                      activeTab === tab
                        ? "2px solid #3b82f6"
                        : "2px solid transparent",
                    padding: "10px 16px",
                    cursor: "pointer",
                    textTransform: "capitalize",
                    fontWeight: 500,
                    outline: "none",
                  }}
                >
                  {tab}
                </button>
              ))}
            </div>

            <div className="card-body" style={{ padding: "1rem" }}>
              {renderFormContent()}
            </div>
          </div>
        </section>

        {/* RIGHT column */}
        <section className="column">
          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Node Inspector</div>
                <div className="card-subtitle">
                  Click any node in the graph to inspect it.
                </div>
              </div>
              {selectedNodeId && (
                <span className="chip">
                  Selected: <strong>{selectedNodeId}</strong>
                </span>
              )}
            </div>
            <div className="card-body">
              {!selectedNodeId && (
                <div className="small-muted">
                  Click any node in the graph to inspect it.
                </div>
              )}
              {selectedNodeId && (
                <>
                  <div className="field-row" style={{ marginBottom: "0.4rem" }}>
                    <div
                      className={getRiskChipClass(
                        metrics[selectedNodeId]?.risk_score ?? 0.3
                      )}
                    >
                      Risk:{" "}
                      {(metrics[selectedNodeId]?.risk_score ?? 0.3).toFixed(2)}
                    </div>
                    <div className="chip">
                      Degree:{" "}
                      {(
                        metrics[selectedNodeId]?.degree_centrality ?? 0
                      ).toFixed(2)}
                    </div>
                  </div>

                  <div className="node-summary">
                    {loadingSummary
                      ? "Loading node summary..."
                      : selectedNodeSummary || "No summary yet."}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Timeline of events and policies</div>
                <div className="card-subtitle">
                  Derived on the client from node timestamps.
                </div>
              </div>
            </div>
            <div className="card-body">
              {timeline.length === 0 ? (
                <div className="small-muted">
                  Timeline is empty. Ingest some events and policies first.
                </div>
              ) : (
                <ul className="timeline-list">
                  {timeline.map((item) => (
                    <li key={item.id} className="timeline-item">
                      <div className="timeline-title">
                        {item.title}{" "}
                        <span className="small-muted">
                          [{item.type}] {item.region ? "· " + item.region : ""}
                        </span>
                      </div>
                      <div className="timeline-meta">
                        {formatDate(item.time)} · Node: {item.id}
                      </div>
                      {item.summary && (
                        <div className="timeline-summary">
                          {item.summary.slice(0, 180)}
                          {item.summary.length > 180 ? "..." : ""}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">RAG over the graph</div>
                <div className="card-subtitle">
                  Embedding search and GPT answer, fully in-browser.
                </div>
              </div>
            </div>
            <div className="card-body">
              <div className="label">Question</div>
              <textarea
                value={ragQuery}
                onChange={(e) => setRagQuery(e.target.value)}
              />

              <div className="rag-footer-row">
                <div className="small-muted">
                  We retrieve top-k nodes using embeddings, then ask the model
                  with that context.
                </div>
                <button onClick={submitRagQuery} disabled={loadingRag}>
                  {loadingRag ? "Asking Model" : "Run Graph RAG"}
                </button>
              </div>

              {ragAnswer && (
                <>
                  <div className="label" style={{ marginTop: "0.5rem" }}>
                    Answer
                  </div>
                  <div className="rag-answer">{ragAnswer}</div>
                </>
              )}

              {ragContexts.length > 0 && (
                <>
                  <div className="label" style={{ marginTop: "0.4rem" }}>
                    Top supporting nodes
                  </div>
                  <div>
                    {ragContexts.map((c) => (
                      <span key={c.id} className="context-pill">
                        <span>{c.type}</span>
                        <span>·</span>
                        <span>{(c.title || c.name || c.id).slice(0, 22)}</span>
                        <span>·</span>
                        <span>{c.similarity.toFixed(2)}</span>
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </section>
      </main>

      {/* Basic Styles for the new Form UI */}
      <style>{`
        .form-list {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .form-item-card {
          background: #0f172a;
          border: 1px solid #334155;
          padding: 1rem;
          border-radius: 6px;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .form-row-split {
          display: flex;
          gap: 0.5rem;
        }
        .input-base {
          background: #1e293b;
          border: 1px solid #475569;
          color: #e2e8f0;
          padding: 6px 10px;
          border-radius: 4px;
          font-size: 0.9rem;
          flex: 1;
        }
        .input-area {
          resize: vertical;
          min-height: 60px;
        }
        .label-mini {
          font-size: 0.75rem;
          color: #94a3b8;
          display: block;
          margin-bottom: 2px;
        }
        .btn-delete {
          align-self: flex-end;
          background: transparent;
          color: #f87171;
          border: 1px solid #7f1d1d;
          font-size: 0.75rem;
          padding: 2px 8px;
          border-radius: 4px;
          cursor: pointer;
        }
        .btn-delete:hover {
          background: #450a0a;
        }
        .btn-add {
          background: #334155;
          color: white;
          border: 1px dashed #64748b;
          padding: 10px;
          border-radius: 6px;
          cursor: pointer;
          font-weight: 500;
        }
        .btn-add:hover {
          background: #475569;
        }
      `}</style>
    </div>
  );
}

export default App;
