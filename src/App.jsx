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
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: clean
    })
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
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      instructions:
        "You are an expert in power systems, renewable integration, and energy policy. " +
        "Always answer in plain text paragraphs with no markdown headings or bullet characters.",
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: prompt }]
        }
      ]
    })
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

// ---------------------- React App ----------------------

function App() {
  const [nodesMap, setNodesMap] = useState({});
  const [edges, setEdges] = useState([]);
  const embeddingsRef = useRef({});

  const [error, setError] = useState("");
  const [loadingIngest, setLoadingIngest] = useState(false);

  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedNodeSummary, setSelectedNodeSummary] = useState("");
  const [loadingSummary, setLoadingSummary] = useState(false);

  const [ragQuery, setRagQuery] = useState(
    "Why are some regions high-risk for cascading outages when renewables increase?"
  );
  const [ragAnswer, setRagAnswer] = useState("");
  const [ragContexts, setRagContexts] = useState([]);
  const [loadingRag, setLoadingRag] = useState(false);

  const [papersJson, setPapersJson] = useState(
    JSON.stringify(
      [
        {
          id: "arxiv_demo_1",
          title: "Cascading failures in power grids with high renewable penetration",
          summary:
            "This paper studies how increased wind and solar generation can change the propagation of disturbances and cause cascading outages.",
          published: "2021-03-15T00:00:00Z"
        }
      ],
      null,
      2
    )
  );

  const [eventsJson, setEventsJson] = useState(
    JSON.stringify(
      [
        {
          external_id: "event_demo_1",
          name: "2021 monsoon storm blackout",
          description:
            "Widespread outages in the coastal region due to transmission tower failure and flooding.",
          start_time: "2021-07-12T02:00:00Z",
          end_time: "2021-07-12T10:00:00Z",
          region: "Tamil Nadu",
          asset_type: "Transmission",
          severity: 0.9
        }
      ],
      null,
      2
    )
  );

  const [policiesJson, setPoliciesJson] = useState(
    JSON.stringify(
      [
        {
          external_id: "policy_demo_1",
          name: "Solar rooftop subsidy phase II",
          description:
            "Capital subsidy for residential rooftop PV with performance-based incentives for high performance.",
          jurisdiction: "India",
          start_date: "2020-01-01",
          end_date: "2025-12-31",
          category: "Subsidy"
        }
      ],
      null,
      2
    )
  );

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

      let papers = [];
      let events = [];
      let policies = [];
      try {
        papers = JSON.parse(papersJson);
      } catch {
        throw new Error("Papers JSON is invalid.");
      }
      try {
        events = JSON.parse(eventsJson);
      } catch {
        throw new Error("Events JSON is invalid.");
      }
      try {
        policies = JSON.parse(policiesJson);
      } catch {
        throw new Error("Policies JSON is invalid.");
      }

      // papers
      for (const p of papers) {
        const text = `${p.title} - ${p.summary}`;
        const emb = await getEmbedding(text);
        addNode(
          `paper:${p.id}`,
          {
            type: "Paper",
            title: p.title,
            summary: p.summary,
            published: p.published
          },
          emb
        );
      }

      // events
      for (const e of events) {
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
            severity: e.severity ?? 0.5
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
      for (const p of policies) {
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
            category: p.category
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
      for (const p of papers) {
        const pid = `paper:${p.id}`;
        for (const e of events) {
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
        timestamp: d.getTime()
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
        raw: n
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
      score: cosineSim(qEmb, embeddingsRef.current[id])
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

  // ---------- misc ----------

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

  // ---------- render ----------

  return (
    <div className="app-root">
      <header className="app-header">
        <div className="app-header-left">
          <div className="app-kicker">ENERGYVERSE · GRAPH RAG STUDIO</div>
          <div className="app-header-title">Knowledge Graph of Energy Events</div>
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
          <button onClick={ingestAll} disabled={loadingIngest}>
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
                    ctx.fillText(label.slice(0, 22), node.x, node.y + radius + 2);
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
            <div className="card-header">
              <div>
                <div className="card-title">Ingest data into the graph</div>
                <div className="card-subtitle">
                  Paste research papers, grid events and policy JSON.
                </div>
              </div>
            </div>
            <div className="card-body">
              <div className="field-row">
                <div style={{ flex: 1 }}>
                  <div className="label">Papers JSON</div>
                  <textarea
                    value={papersJson}
                    onChange={(e) => setPapersJson(e.target.value)}
                  />
                </div>
              </div>
              <div className="field-row">
                <div style={{ flex: 1 }}>
                  <div className="label">Grid events JSON</div>
                  <textarea
                    value={eventsJson}
                    onChange={(e) => setEventsJson(e.target.value)}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <div className="label">Policies JSON</div>
                  <textarea
                    value={policiesJson}
                    onChange={(e) => setPoliciesJson(e.target.value)}
                  />
                </div>
              </div>
              <div className="small-muted">
                The component calls OpenAI for embeddings directly from the
                browser. Don&apos;t ship this pattern to production with a real
                secret key.
              </div>
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
    </div>
  );
}

export default App;
