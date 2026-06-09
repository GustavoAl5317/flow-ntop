import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Form, Input, Button, Alert } from 'antd';
import { LockOutlined, UserOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useAuth } from '../context/AuthContext';

export function LoginPage() {
  const { login, backendOnline } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const from = (location.state as { from?: string } | null)?.from ?? '/';

  async function handleSubmit(values: { username: string; password: string }) {
    setLoading(true);
    setError(null);
    try {
      await login(values.username, values.password);
      navigate(from, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao autenticar');
    } finally {
      setLoading(false);
    }
  }

  if (!backendOnline) {
    return (
      <div style={{
        height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#0a0f1e',
      }}>
        <Alert
          type="warning"
          showIcon
          title="Backend offline"
          description="O servidor FastAPI não está rodando. Inicie com: cd backend && uvicorn main:app --reload --port 8000"
          style={{ maxWidth: 480 }}
        />
      </div>
    );
  }

  return (
    <div style={{
      height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #0a0f1e 0%, #0d1b2e 50%, #0a0f1e 100%)',
    }}>
      <div style={{
        width: 400, padding: 32, borderRadius: 16,
        background: '#0f1629', border: '1px solid #1e2d4a',
        boxShadow: '0 25px 60px #00000080',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{
            display: 'inline-flex', padding: 12, borderRadius: 12,
            background: 'linear-gradient(135deg, #0099bb, #00d4ff)', marginBottom: 12,
          }}>
            <SafetyCertificateOutlined style={{ fontSize: 28, color: '#fff' }} />
          </div>
          <h1 style={{ color: '#e2e8f0', margin: 0, fontSize: 22, fontWeight: 700 }}>
            FLOW <span style={{ color: '#00c8f0' }}>GUARD</span>
          </h1>
          <p style={{ color: '#475569', margin: '6px 0 0', fontSize: 13 }}>
            Painel de Monitoramento DDoS
          </p>
        </div>

        {error && (
          <Alert type="error" title={error ?? undefined} showIcon style={{ marginBottom: 16 }} />
        )}

        <Form layout="vertical" onFinish={handleSubmit} size="large">
          <Form.Item
            name="username"
            rules={[{ required: true, message: 'Informe o usuário' }]}
          >
            <Input
              prefix={<UserOutlined style={{ color: '#475569' }} />}
              placeholder="Usuário"
              style={{ background: '#131c33', borderColor: '#1e2d4a', color: '#e2e8f0' }}
            />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: 'Informe a senha' }]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: '#475569' }} />}
              placeholder="Senha"
              style={{ background: '#131c33', borderColor: '#1e2d4a', color: '#e2e8f0' }}
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
              style={{ background: 'linear-gradient(135deg, #0099bb, #00d4ff)', border: 'none', height: 42 }}
            >
              Entrar
            </Button>
          </Form.Item>
        </Form>
      </div>
    </div>
  );
}
