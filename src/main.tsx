import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import './styles/onyx-theme.css';
import { setupMonaco } from './components/monacoSetup';
import { useUiStore } from './stores/uiStore';
import { App } from './App';

// 首帧前写入主题，避免亮暗闪烁
document.documentElement.setAttribute('data-theme', useUiStore.getState().theme);
setupMonaco();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
