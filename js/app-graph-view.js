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
  zoom: 1,
  panX: 0,
  panY: 0,
  simAlpha: 0.35,
  viewWidth: 800,
  viewHeight: 600,
  _isDragging: false,
  _dragMoved: false,
  _dragStartX: 0,
  _dragStartY: 0,
  _panStartX: 0,
  _panStartY: 0,
  _isHydrating: false,

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
    const spread = Math.min(2000, Math.max(300, Math.sqrt(notes.length || 1) * 45));

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
        x: 400 + (Math.random() - 0.5) * spread,
        y: 300 + (Math.random() - 0.5) * spread,
        vx: 0,
        vy: 0,
        radius: 6
      });
    });

    const links = [];
    const linkSet = new Set();

    const entries = forwardLinks instanceof Map
      ? forwardLinks.entries()
      : Object.entries(forwardLinks);

    for (const [sourcePath, targets] of entries) {
      if (!targets) continue;
      for (const targetPath of targets) {
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
      }
    }

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

  _getWorldBounds(nodes, width, height) {
    if (!nodes || nodes.length <= 80) {
      return { worldWidth: width, worldHeight: height };
    }
    const worldWidth = Math.max(width, Math.sqrt(nodes.length) * 60);
    const worldHeight = Math.max(height, Math.sqrt(nodes.length) * 45);
    return { worldWidth, worldHeight };
  },

  _buildQuadtree(nodes) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x > maxX) maxX = n.x;
      if (n.y > maxY) maxY = n.y;
    }
    const size = Math.max(maxX - minX, maxY - minY, 1) + 2;
    const root = { x: minX - 1, y: minY - 1, size, mass: 0, cx: 0, cy: 0, body: null, children: null };

    const insert = (cell, node, depth) => {
      if (cell.mass === 0 && !cell.children) {
        cell.body = node;
        cell.mass = 1;
        cell.cx = node.x;
        cell.cy = node.y;
        return;
      }

      if (!cell.children) {
        if (depth >= 12) {
          const total = cell.mass + 1;
          cell.cx = (cell.cx * cell.mass + node.x) / total;
          cell.cy = (cell.cy * cell.mass + node.y) / total;
          cell.mass = total;
          cell.body = null;
          return;
        }
        const half = cell.size / 2;
        cell.children = [
          { x: cell.x, y: cell.y, size: half, mass: 0, cx: 0, cy: 0, body: null, children: null },
          { x: cell.x + half, y: cell.y, size: half, mass: 0, cx: 0, cy: 0, body: null, children: null },
          { x: cell.x, y: cell.y + half, size: half, mass: 0, cx: 0, cy: 0, body: null, children: null },
          { x: cell.x + half, y: cell.y + half, size: half, mass: 0, cx: 0, cy: 0, body: null, children: null }
        ];
        const prev = cell.body;
        cell.body = null;
        if (prev) {
          const qIdx = (prev.y >= cell.y + half ? 2 : 0) + (prev.x >= cell.x + half ? 1 : 0);
          insert(cell.children[qIdx], prev, depth + 1);
        }
      }

      const total = cell.mass + 1;
      cell.cx = (cell.cx * cell.mass + node.x) / total;
      cell.cy = (cell.cy * cell.mass + node.y) / total;
      cell.mass = total;

      const half = cell.size / 2;
      const qIdx = (node.y >= cell.y + half ? 2 : 0) + (node.x >= cell.x + half ? 1 : 0);
      insert(cell.children[qIdx], node, depth + 1);
    };

    for (let i = 0; i < nodes.length; i++) {
      insert(root, nodes[i], 0);
    }
    return root;
  },

  stepSimulation(graphData, width = 800, height = 600, alpha = 0.05) {
    if (!graphData || !Array.isArray(graphData.nodes) || graphData.nodes.length === 0) return;
    const { nodes, links } = graphData;
    const kRep = 1500;
    const kAtt = 0.04;
    const targetDist = 70;
    const maxRepDistSq = 350 * 350;
    const { worldWidth, worldHeight } = this._getWorldBounds(nodes, width, height);
    const cx = worldWidth / 2;
    const cy = worldHeight / 2;

    if (nodes.length <= 80) {
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distSq = dx * dx + dy * dy;
          if (distSq > maxRepDistSq) continue;
          const dist = Math.sqrt(distSq) || 1;

          const force = (kRep / (dist * dist)) * alpha;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;

          a.vx -= fx;
          a.vy -= fy;
          b.vx += fx;
          b.vy += fy;
        }
      }
    } else {
      const root = this._buildQuadtree(nodes);
      const theta = 0.75;
      const applyTreeRepulsion = (cell, node) => {
        if (!cell || cell.mass === 0) return;
        if (cell.body === node && !cell.children) return;

        const dx = cell.cx - node.x;
        const dy = cell.cy - node.y;
        const distSq = dx * dx + dy * dy;
        const maxRange = 350 + cell.size * 0.75;
        if (distSq > maxRange * maxRange) return;

        if (!cell.children || (cell.size / (Math.sqrt(distSq) || 1)) < theta) {
          if (distSq > maxRepDistSq && !cell.children) return;
          const dist = Math.sqrt(distSq) || 1;
          const force = (kRep * cell.mass / (dist * dist)) * alpha;
          node.vx -= (dx / dist) * force;
          node.vy -= (dy / dist) * force;
          return;
        }

        for (let q = 0; q < 4; q++) {
          applyTreeRepulsion(cell.children[q], node);
        }
      };

      for (let i = 0; i < nodes.length; i++) {
        applyTreeRepulsion(root, nodes[i]);
      }
    }

    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      const a = nodeMap.get(link.source);
      const b = nodeMap.get(link.target);
      if (!a || !b) continue;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (dist - targetDist) * kAtt * alpha;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    const maxX = Math.max(25, worldWidth - 25);
    const maxY = Math.max(25, worldHeight - 25);
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      node.vx += (cx - node.x) * 0.005 * alpha;
      node.vy += (cy - node.y) * 0.005 * alpha;

      node.vx *= 0.88;
      node.vy *= 0.88;

      node.x += node.vx;
      node.y += node.vy;

      node.x = Math.max(25, Math.min(maxX, node.x));
      node.y = Math.max(25, Math.min(maxY, node.y));
    }
  },

  getNodeColor(workstream, workstreamsList = []) {
    if (!workstream) return '#64748b';
    const idx = workstreamsList.indexOf(workstream);
    if (idx >= 0) return this.workstreamColors[idx % this.workstreamColors.length];
    return '#6366f1';
  },

  openGraphModal() {
    this.activeWorkstream = 'all';
    this.hoveredNodeId = null;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.simAlpha = 0.35;

    this.activeGraphData = this.buildGraphData();
    this.filteredGraphData = this.filterGraph(this.activeGraphData, 'all');
    this.renderWorkstreamPills();

    if (typeof openModal === 'function') {
      openModal('modal-knowledge-graph');
    }
    setTimeout(() => {
      this.initCanvas();
    }, 50);

    const needsIndexHydration = typeof noteGraphIndex !== 'undefined' &&
      (!noteGraphIndex.isHydrated || !noteGraphIndex.includesDiskScan);
    if (needsIndexHydration && typeof rebuildNoteGraphIndex === 'function' && !this._isHydrating) {
      this._isHydrating = true;
      Promise.resolve(rebuildNoteGraphIndex({ fetchDisk: true }))
        .then(() => {
          this._isHydrating = false;
          const modal = typeof document !== 'undefined' ? document.getElementById('modal-knowledge-graph') : null;
          if (modal && !modal.classList.contains('active') && modal.style.display === 'none') return;
          this.activeGraphData = this.buildGraphData();
          this.filteredGraphData = this.filterGraph(this.activeGraphData, this.activeWorkstream);
          this.renderWorkstreamPills();
          this.simAlpha = Math.max(this.simAlpha, 0.35);
          this.ensureLoopRunning();
        })
        .catch(() => {
          this._isHydrating = false;
        });
    }
  },

  closeGraphModal() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (typeof closeModal === 'function') {
      closeModal('modal-knowledge-graph');
    }
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
        this.simAlpha = Math.max(this.simAlpha, 0.25);
        this.ensureLoopRunning();
      };
      container.appendChild(btn);
    });
  },

  _screenToWorld(sx, sy) {
    return {
      x: (sx - this.panX) / this.zoom,
      y: (sy - this.panY) / this.zoom
    };
  },

  _findHitNode(sx, sy) {
    const nodes = this.filteredGraphData?.nodes;
    if (!nodes || nodes.length === 0) return null;
    const { x, y } = this._screenToWorld(sx, sy);
    const pad = 4 / Math.max(0.5, this.zoom);
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const dx = n.x - x;
      const dy = n.y - y;
      const r = n.radius + pad;
      if (dx * dx + dy * dy <= r * r) return n;
    }
    return null;
  },

  ensureLoopRunning() {
    if (this.animFrameId || !this.canvas) return;
    const loop = () => {
      const modal = typeof document !== 'undefined' ? document.getElementById('modal-knowledge-graph') : null;
      if (!this.canvas || (modal && !modal.classList.contains('active') && modal.style.display === 'none')) {
        this.animFrameId = null;
        return;
      }

      if (this.simAlpha >= 0.004) {
        this.stepSimulation(this.filteredGraphData, this.viewWidth, this.viewHeight, this.simAlpha);
        this.simAlpha *= 0.985;
        this.draw();
        this.animFrameId = requestAnimationFrame(loop);
      } else {
        this.draw();
        this.animFrameId = null;
      }
    };
    this.animFrameId = requestAnimationFrame(loop);
  },

  initCanvas() {
    this.canvas = document.getElementById('knowledge-graph-canvas');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');

    const rect = this.canvas.parentElement ? this.canvas.parentElement.getBoundingClientRect() : { width: 800, height: 600 };
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
    this.viewWidth = Math.max(100, rect.width || 800);
    this.viewHeight = Math.max(100, rect.height || 600);
    this.canvas.width = Math.round(this.viewWidth * dpr);
    this.canvas.height = Math.round(this.viewHeight * dpr);

    const nodesCount = this.filteredGraphData?.nodes?.length || 0;
    if (nodesCount > 80) {
      const { worldWidth, worldHeight } = this._getWorldBounds(this.filteredGraphData.nodes, this.viewWidth, this.viewHeight);
      const fitScale = Math.min(this.viewWidth / worldWidth, this.viewHeight / worldHeight, 1);
      this.zoom = Math.max(0.35, fitScale);
      this.panX = (this.viewWidth - worldWidth * this.zoom) / 2;
      this.panY = (this.viewHeight - worldHeight * this.zoom) / 2;
    }

    this.canvas.onwheel = (e) => {
      e.preventDefault();
      const cRect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - cRect.left;
      const sy = e.clientY - cRect.top;
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      const nextZoom = Math.min(4, Math.max(0.2, this.zoom * factor));
      if (nextZoom === this.zoom) return;
      const wx = (sx - this.panX) / this.zoom;
      const wy = (sy - this.panY) / this.zoom;
      this.zoom = nextZoom;
      this.panX = sx - wx * this.zoom;
      this.panY = sy - wy * this.zoom;
      this.draw();
    };

    this.canvas.onmousedown = (e) => {
      this._isDragging = true;
      this._dragMoved = false;
      this._dragStartX = e.clientX;
      this._dragStartY = e.clientY;
      this._panStartX = this.panX;
      this._panStartY = this.panY;
    };

    this.canvas.onmousemove = (e) => {
      if (this._isDragging) {
        const dx = e.clientX - this._dragStartX;
        const dy = e.clientY - this._dragStartY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
          this._dragMoved = true;
          this.panX = this._panStartX + dx;
          this.panY = this._panStartY + dy;
          this.draw();
        }
        return;
      }

      const cRect = this.canvas.getBoundingClientRect();
      const hit = this._findHitNode(e.clientX - cRect.left, e.clientY - cRect.top);
      const nextHover = hit ? hit.id : null;
      if (nextHover !== this.hoveredNodeId) {
        this.hoveredNodeId = nextHover;
        this.canvas.style.cursor = hit ? 'pointer' : 'grab';
        this.draw();
      }
    };

    this.canvas.onmouseup = () => {
      this._isDragging = false;
    };

    this.canvas.onmouseleave = () => {
      this._isDragging = false;
      if (this.hoveredNodeId !== null) {
        this.hoveredNodeId = null;
        this.draw();
      }
    };

    this.canvas.onclick = (e) => {
      if (this._dragMoved) {
        this._dragMoved = false;
        return;
      }
      const cRect = this.canvas.getBoundingClientRect();
      const hit = this._findHitNode(e.clientX - cRect.left, e.clientY - cRect.top);

      if (hit) {
        this.selectedNodeId = hit.id;
        if (typeof openNoteFromCard === 'function') {
          this.closeGraphModal();
          openNoteFromCard(hit.id);
        }
      }
    };

    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.ensureLoopRunning();
  },

  _getResolvedTextColor() {
    if (typeof getComputedStyle === 'function' && typeof document !== 'undefined' && document.documentElement) {
      const val = getComputedStyle(document.documentElement).getPropertyValue('--text').trim();
      if (val) return val;
    }
    return '#333333';
  },

  draw() {
    if (!this.ctx || !this.canvas || !this.filteredGraphData) return;
    const ctx = this.ctx;
    const { nodes, links } = this.filteredGraphData;
    const wsList = this.activeGraphData?.workstreams || [];
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
    const vw = this.viewWidth || this.canvas.width;
    const vh = this.viewHeight || this.canvas.height;
    const textColor = this._getResolvedTextColor();

    ctx.save();
    if (typeof ctx.setTransform === 'function') {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (typeof ctx.setTransform === 'function') {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom, this.zoom);

    const minX = -this.panX / this.zoom - 40;
    const maxX = (vw - this.panX) / this.zoom + 40;
    const minY = -this.panY / this.zoom - 40;
    const maxY = (vh - this.panY) / this.zoom + 40;

    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const hoveredId = this.hoveredNodeId;

    ctx.lineWidth = 1.2 / Math.max(0.5, this.zoom);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';

    for (let i = 0; i < links.length; i++) {
      const l = links[i];
      const a = nodeMap.get(l.source);
      const b = nodeMap.get(l.target);
      if (!a || !b) continue;
      if ((a.x < minX && b.x < minX) || (a.x > maxX && b.x > maxX) ||
          (a.y < minY && b.y < minY) || (a.y > maxY && b.y > maxY)) {
        continue;
      }

      const isHighlighted = hoveredId && (a.id === hoveredId || b.id === hoveredId);
      if (isHighlighted) {
        ctx.save();
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.85)';
        ctx.lineWidth = 2 / Math.max(0.5, this.zoom);
      }
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      if (isHighlighted) {
        ctx.restore();
      }
    }

    const drawAllLabels = nodes.length <= 80 || this.zoom >= 1.25;
    let labelThresholdDegree = 0;
    if (!drawAllLabels) {
      const sortedDegrees = nodes.map(n => n.degree || 0).sort((a, b) => b - a);
      labelThresholdDegree = Math.max(2, sortedDegrees[Math.min(39, sortedDegrees.length - 1)] || 2);
    }

    ctx.lineWidth = 1.5 / Math.max(0.5, this.zoom);
    ctx.font = `${Math.round(11 / Math.min(1, Math.max(0.6, this.zoom)))}px sans-serif`;
    ctx.textAlign = 'center';

    let labelsDrawn = 0;
    const maxLabels = 120;

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.x < minX || n.x > maxX || n.y < minY || n.y > maxY) continue;

      const color = this.getNodeColor(n.workstream, wsList);
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      ctx.strokeStyle = n.id === hoveredId ? '#facc15' : '#ffffff';
      ctx.stroke();

      const isFocusNode = n.id === hoveredId || n.id === this.selectedNodeId;
      const shouldDrawLabel = isFocusNode ||
        (labelsDrawn < maxLabels && (drawAllLabels || (n.degree || 0) >= labelThresholdDegree));

      if (shouldDrawLabel) {
        ctx.fillStyle = textColor;
        const label = n.title.length > 20 ? n.title.slice(0, 18) + '…' : n.title;
        ctx.fillText(label, n.x, n.y + n.radius + 12);
        labelsDrawn++;
      }
    }

    ctx.restore();
  }
};

if (typeof window !== 'undefined') {
  window.KnowledgeGraphViewer = KnowledgeGraphViewer;
}
