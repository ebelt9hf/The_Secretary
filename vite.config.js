import { defineConfig } from 'vite';
import { resolve } from 'path';
import fs from 'fs';

function cleanDistAssets() {
  return {
    name: 'clean-dist-assets',
    buildStart() {
      const assetsDir = resolve(__dirname, 'dist/assets');
      if (fs.existsSync(assetsDir)) {
        fs.rmSync(assetsDir, { recursive: true, force: true });
      }
    }
  };
}

function copyStaticAssets() {
  return {
    name: 'copy-static-assets',
    closeBundle() {
      if (fs.existsSync('js')) {
        fs.cpSync('js', 'dist/js', { recursive: true });
      }
      if (fs.existsSync('css')) {
        fs.cpSync('css', 'dist/css', { recursive: true });
      }
      if (fs.existsSync('icon.svg')) {
        fs.copyFileSync('icon.svg', 'dist/icon.svg');
      }
      if (fs.existsSync('dist/app.html')) {
        fs.copyFileSync('dist/app.html', 'dist/index.html');
      }
    }
  };
}

function devAppHtmlRewrite() {
  return {
    name: 'dev-app-html-rewrite',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/' || req.url === '/index.html') {
          req.url = '/app.html';
        }
        next();
      });
    }
  };
}

function htmlPartialsPlugin() {
  const includeRegex = /<include\s+src=["']([^"']+)["']\s*(?:\/>|><\/include>)/g;

  function processHtml(html, basePath, depth = 0) {
    if (depth > 10) return html;
    return html.replace(includeRegex, (match, src) => {
      const filePath = resolve(basePath, src);
      if (fs.existsSync(filePath)) {
        const partialContent = fs.readFileSync(filePath, 'utf-8');
        return processHtml(partialContent, basePath, depth + 1);
      }
      console.warn(`[html-partials-plugin] Partial not found: ${src}`);
      return match;
    });
  }

  return {
    name: 'html-partials-plugin',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return processHtml(html, __dirname);
      }
    },
    handleHotUpdate({ file, server }) {
      if (file.includes('/templates/')) {
        server.ws.send({ type: 'full-reload' });
      }
    }
  };
}

export default defineConfig({
  root: '.',
  base: './',
  plugins: [cleanDistAssets(), htmlPartialsPlugin(), copyStaticAssets(), devAppHtmlRewrite()],
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'app.html'),
        noteWindow: resolve(__dirname, 'note-window.html'),
        secretaryWindow: resolve(__dirname, 'secretary-window.html')
      }
    }
  },
  server: {
    port: 5173,
    open: '/app.html'
  }
});
