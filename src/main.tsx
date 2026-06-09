import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConfigProvider, theme } from 'antd'
import ptBR from 'antd/locale/pt_BR'
import { AuthProvider } from './context/AuthContext'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ConfigProvider
          locale={ptBR}
          theme={{
            algorithm: theme.darkAlgorithm,
            token: { colorBgContainer: '#0d1b2e', colorBorderSecondary: '#1e3a5f' },
          }}
        >
          <App />
        </ConfigProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
