import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import 'react-toastify/dist/ReactToastify.css';
import './index.css';
import App from './App.tsx';
import { LatexStudioPage } from './pages/LatexStudioPage.tsx';
import { AppTopNav } from './components/AppTopNav.tsx';
import { ConfirmProvider } from './components/ConfirmProvider.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfirmProvider>
      <BrowserRouter>
        <div className="min-h-screen flex flex-col">
          <AppTopNav />
          <div className="flex-1 min-h-0 flex flex-col">
            <Routes>
              <Route path="/" element={<App />} />
              <Route path="/latex-studio" element={<LatexStudioPage />} />
            </Routes>
          </div>
        </div>
      </BrowserRouter>
    </ConfirmProvider>
  </StrictMode>
);
