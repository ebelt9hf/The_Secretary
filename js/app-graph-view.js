'use strict';

/**
 * Secretary - Interactive Knowledge Graph Viewer
 * 
 * Renders notes as nodes and backlinks/forward links as edges
 * with force-directed physics layout on HTML5 Canvas.
 */
const KnowledgeGraphViewer = {
  activeGraphData: null,
  filteredGraphData: null,
  animFrameId: null,
  canvas: null,
  ctx: null,
  selectedNodeId: null,
  hoveredNodeId: null,
  activeWorkstream: 'all',

  workstreamColors: [
    '#6366f1', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6',
    '#3b82f6', '#14b8a6', '#f97316', '#06b6d4', '#84cc16'
  ],

  buildGraphData(notesList = [], graphIndex = null) {
    const notes = Array.isArray(notesList) && notesList.length > 0 ? notesList : (typeof manifest !== 'undefined' && Array.isArray(manifest) ? manifest : []);
    const idx = graphIndex || (typeof noteGraphIndex !== 'undefined' ? noteGraphIndex : { forwardLinks: {}, backlinks: {} });
    const forwardLinks = idx.forwardLinks || {};

    const nodeMap = new Map();
    const workstreamsSet = new Set();

    notes.forEach((note) => {
      if (!note || !note.path) return;
      const ws = typeof getNoteWorkstreamName === 'function' ? getNoteWorkstreamName(note) : (note.workstream || '');
      if (ws) workstreamsSet.add(ws);

      nodeMap.set(note.path, {
        id: note.path,
        title: note.title || note.path.split('/').pop() || 'Untitled',
        group: Array.isArray(note.group_tags) && note.group_tags[0] ? note.group_tags[0] : 'General',
        workstream: ws,
        degree: 0,
        x: 400 + (Math.random() - 0.5) * 300,
        y: 300 + (Math.random() - 0.5) * 300,
        vx: 0,
        vy: 0,
        radius: 6
      });
    });

    const links = [];
    const linkSet = new Set();

    Object.keys(forwardLinks).forEach(sourcePath => {
      const targets = forwardLinks[sourcePath] || [];
      targets.forEach(targetPath => {
        if (nodeMap.has(sourcePath) && nodeMap.has(targetPath) && sourcePath !== targetPath) {
          const key = `${sourcePath}->${targetPath}`;
          if (!linkSet.has(key)) {
            linkSet.add(key);
            links.push({ source: sourcePath, target: targetPath });

            const sNode = nodeMap.get(sourcePath);
            const tNode = nodeMap.get(targetPath);
            sNode.degree = (sNode.degree || 0) + 1;
            tNode.degree = (tNode.degree || 0) + 1;
          }
        }
      });
    });

    const nodes = Array.from(nodeMap.values());
    nodes.forEach(n => {
      n.radius = Math.min(18, Math.max(5, 5 + n.degree * 2));
    });

    return {
      nodes,
      links,
      workstreams: (typeof getKnownWorkstreamsList === 'function' && getKnownWorkstreamsList().length > 0)
        ? getKnownWorkstreamsList()
        : Array.from(workstreamsSet).sort()
    };
  },

  filterGraph(graphData, workstream = 'all') {
    if (!graphData) return { nodes: [], links: [] };
    if (!workstream || workstream === 'all') {
      return {
        nodes: [...graphData.nodes],
        links: [...graphData.links]
      };
    }

    const filteredNodes = graphData.nodes.filter(n => (n.workstream || '').toLowerCase() === workstream.toLowerCase());
    const nodeIds = new Set(filteredNodes.map(n => n.id));
    const filteredLinks = graphData.links.filter(l => nodeIds.has(l.source) && nodeIds.has(l.target));

    return {
      nodes: filteredNodes,
      links: filteredLinks
    };
  },

  stepSimulation(graphData, width = 800, height = 600, alpha = 0.05) {
    if (!graphData || !Array.isArray(graphData.nodes)) return;
    const { nodes, links } = graphData;
    const kRep = 1500;
    const kAtt = 0.04;
    const targetDist = 70;
    const cx = width / 2;
    const cy = height / 2;

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (dist > 350) continue;

        let force = (kRep / (dist * dist)) * alpha;
        let fx = (dx / dist) * force;
        let fy = (dy / dist) * force;

        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    links.forEach(link => {
      const a = nodeMap.get(link.source);
      const b = nodeMap.get(link.target);
      if (!a || !b) return;

      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dist = Math.sqrt(dx * dx + dy * dy) || 1;
      let force = (dist - targetDist) * kAtt * alpha;
      let fx = (dx / dist) * force;
      let fy = (dy / dist) * force;

      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    });

    nodes.forEach(node => {
      node.vx += (cx - node.x) * 0.005 * alpha;
      node.vy += (cy - node.y) * 0.005 * alpha;

      node.vx *= 0.88;
      node.vy *= 0.88;

      node.x += node.vx;
      node.y += node.vy;

      node.x = Math.max(25, Math.min(width - 25, node.x));
      node.y = Math.max(25, Math.min(height - 25, node.y));
    });
  },

  getNodeColor(workstream, workstreamsList = []) {
    if (!workstream) return '#64748b';
    const idx = workstreamsList.indexOf(workstream);
    if (idx >= 0) return this.workstreamColors[idx % this.workstreamColors.length];
    return '#6366f1';
  },

  openGraphModal() {
    this.activeGraphData = this.buildGraphData();
    this.filteredGraphData = this.filterGraph(this.activeGraphData, 'all');
    this.renderWorkstreamPills();

    openModal('modal-knowledge-graph');
    setTimeout(() => {
      this.initCanvas();
    }, 50);
  },

  closeGraphModal() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    closeModal('modal-knowledge-graph');
  },

  renderWorkstreamPills() {
    const container = document.getElementById('knowledge-graph-ws-pills');
    if (!container || !this.activeGraphData) return;

    container.innerHTML = '';
    const allWs = ['all', ...this.activeGraphData.workstreams];

    allWs.forEach(ws => {
      const btn = document.createElement('button');
      btn.className = `btn btn-sm ${this.activeWorkstream === ws ? 'btn-primary' : 'btn-secondary'}`;
      btn.style.fontSize = '0.78rem';
      btn.style.padding = '3px 8px';
      btn.title = t('graph.filterByWsTooltip') || 'Filter graph by workstream';
      btn.textContent = ws === 'all' ? (t('common.all') || 'All Workstreams') : ws;
      btn.onclick = () => {
        this.activeWorkstream = ws;
        this.filteredGraphData = this.filterGraph(this.activeGraphData, ws);
        this.renderWorkstreamPills();
      };
      container.appendChild(btn);
    });
  },

  initCanvas() {
    this.canvas = document.getElementById('knowledge-graph-canvas');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');

    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;

    this.canvas.onclick = (e) => {
      const cRect = this.canvas.getBoundingClientRect();
      const x = e.clientX - cRect.left;
      const y = e.clientY - cRect.top;

      const hit = (this.filteredGraphData?.nodes || []).find(n => {
        const dx = n.x - x;
        const dy = n.y - y;
        return Math.sqrt(dx * dx + dy * dy) <= (n.radius + 4);
      });

      if (hit) {
        this.selectedNodeId = hit.id;
        if (typeof openNoteFromCard === 'function') {
          this.closeGraphModal();
          openNoteFromCard(hit.id);
        }
      }
    };

    const loop = () => {
      const modal = document.getElementById('modal-knowledge-graph');
      if (!this.canvas || (modal && !modal.classList.contains('active') && modal.style.display === 'none')) {
        return;
      }
      this.stepSimulation(this.filteredGraphData, this.canvas.width, this.canvas.height);
      this.draw();
      this.animFrameId = requestAnimationFrame(loop);
    };

    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    this.animFrameId = requestAnimationFrame(loop);
  },

  draw() {
    if (!this.ctx || !this.canvas || !this.filteredGraphData) return;
    const ctx = this.ctx;
    const { nodes, links } = this.filteredGraphData;
    const wsList = this.activeGraphData?.workstreams || [];

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    links.forEach(l => {
      const a = nodeMap.get(l.source);
      const b = nodeMap.get(l.target);
      if (!a || !b) return;

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    });

    nodes.forEach(n => {
      const color = this.getNodeColor(n.workstream, wsList);
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      ctx.font = '11px sans-serif';
      ctx.fillStyle = 'var(--text, #333333)';
      ctx.textAlign = 'center';
      const label = n.title.length > 20 ? n.title.slice(0, 18) + '…' : n.title;
      ctx.fillText(label, n.x, n.y + n.radius + 12);
    });
  }
};

if (typeof window !== 'undefined') {
  window.KnowledgeGraphViewer = KnowledgeGraphViewer;
}
