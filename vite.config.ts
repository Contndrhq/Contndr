import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'


function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

// Build stamp surfaced in the bundle so support can match a customer ticket
// to a specific deploy. Vercel injects VERCEL_GIT_COMMIT_SHA automatically;
// locally we fall back to "dev".
const BUILD_SHA = process.env.VERCEL_GIT_COMMIT_SHA || process.env.BUILD_SHA || 'dev';
const BUILD_TIME = new Date().toISOString();

export default defineConfig({
  plugins: [
    figmaAssetResolver(),
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  define: {
    __BUILD_SHA__: JSON.stringify(BUILD_SHA),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
