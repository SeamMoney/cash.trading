import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import App from './App';
import { DemoMode } from './components';
import { PolymarketHome, MarketDetail, OutcomeDetail, SearchPage, BreakingPage, MorePage, PortfolioPage, LoginPage, BottomNav, HFTDemoPage } from './polymarket';
import { NetworkProvider } from './contexts/NetworkContext';
import { WalletProvider } from './contexts/WalletContext';
import { TradePollerProvider } from './contexts/TradePollerProvider';

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('SW registered:', registration.scope);
      })
      .catch((error) => {
        console.log('SW registration failed:', error);
      });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <NetworkProvider>
        <WalletProvider>
          <TradePollerProvider>
          <Routes>
            <Route path="/" element={<App />} />
            <Route path="/demo" element={<DemoMode />} />
            <Route path="/demo-day" element={<HFTDemoPage />} />
            <Route path="/polymarket" element={<><PolymarketHome /><BottomNav /></>} />
            <Route path="/polymarket/hft-demo" element={<HFTDemoPage />} />
            <Route path="/polymarket/search" element={<><SearchPage /><BottomNav /></>} />
            <Route path="/polymarket/breaking" element={<><BreakingPage /><BottomNav /></>} />
            <Route path="/polymarket/more" element={<><MorePage /><BottomNav /></>} />
            <Route path="/market/:id" element={<><MarketDetail /><BottomNav /></>} />
            <Route path="/outcome/:marketId/:outcomeId" element={<OutcomeDetail />} />
            <Route path="/portfolio" element={<><PortfolioPage /><BottomNav /></>} />
            <Route path="/portfolio/:userId" element={<><PortfolioPage /><BottomNav /></>} />
            <Route path="/login" element={<LoginPage />} />
            {/* Catch-all route - redirect unknown paths to home */}
            <Route path="*" element={<Navigate to="/polymarket" replace />} />
          </Routes>
          </TradePollerProvider>
        </WalletProvider>
      </NetworkProvider>
    </BrowserRouter>
  </StrictMode>
);
