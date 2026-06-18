import { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import './index.css';
import { Header }        from './components/Header';
import { Sidebar }       from './components/Sidebar';
import { ConfigPanel }   from './components/ConfigPanel';
import { ProtectedRoute }  from './components/ProtectedRoute';
import { DashboardPage } from './pages/DashboardPage';
import { AlertsPage }    from './pages/AlertsPage';
import { AdvancedQueryPage } from './pages/AdvancedQueryPage';
import { HistoryPage }   from './pages/HistoryPage';
import { ReportsPage }   from './pages/ReportsPage';
import { DetectionPage } from './pages/DetectionPage';
import { NetflowPage }    from './pages/NetflowPage';
import { IPBlocksPage }       from './pages/IPBlocksPage';
import { IPBlockDetailPage }  from './pages/IPBlockDetailPage';
import { InterfacesPage }   from './pages/InterfacesPage';
import { CorrelationPage }  from './pages/CorrelationPage';
import { ExecutivePage }    from './pages/ExecutivePage';
import { LoginPage }        from './pages/LoginPage';
import { useDashboardData } from './hooks/useDashboardData';
import { useThresholdDetection } from './hooks/useThresholdDetection';

function AppLayout() {
  const [showConfig, setShowConfig] = useState(false);
  const { data, loading, error, isLive, lastUpdated, refresh, sources } = useDashboardData();

  useThresholdDetection(data.summary, sources.ifid, isLive);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <Header
        activeAlerts={data.activeAlerts}
        mitigatingAlerts={data.mitigatingAlerts}
        isLive={isLive}
        loading={loading}
        error={error}
        lastUpdated={lastUpdated}
        onRefresh={refresh}
      />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar onSettings={() => setShowConfig(true)} />

        <Routes>
          <Route path="/"          element={<NetflowPage />} />
          <Route path="/alertas"   element={<AlertsPage />} />
          <Route path="/historico" element={<HistoryPage />} />
          <Route path="/consulta"  element={<AdvancedQueryPage />} />
          <Route path="/relatorios" element={<ReportsPage />} />
          <Route path="/deteccao"  element={<DetectionPage />} />
          <Route path="/dashboard-ntopng" element={<DashboardPage />} />
          <Route path="/netflow"    element={<NetflowPage />} />
          <Route path="/ip-blocks"      element={<IPBlocksPage />} />
          <Route path="/ip-blocks/:id"  element={<IPBlockDetailPage />} />
          <Route path="/interfaces"  element={<InterfacesPage />} />
          <Route path="/correlacao"  element={<CorrelationPage />} />
          <Route path="/executivo"   element={<ExecutivePage />} />
        </Routes>
      </div>

      {showConfig && (
        <ConfigPanel onClose={() => setShowConfig(false)} onSave={refresh} />
      )}
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
