import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist' },
  // .cache bị app ghi liên tục (autosave) → Vite không được theo dõi, nếu không sẽ lỗi EBUSY / reload liên tục
  server: { watch: { ignored: ['**/.cache/**'] } },
});
