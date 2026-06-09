import { useState } from 'react';
import { X, CheckCircle, XCircle, Loader, Shield, Key, Layers, Globe, AlertCircle } from 'lucide-react';
import { getConfig, saveConfig, testConnection } from '../services/ntopngApi';
import type { NtopInterface } from '../types/ntopng';

interface Props {
  onClose: () => void;
  onSave:  () => void;   // called after saving so the hook refetches
}

type TestStatus = 'idle' | 'testing' | 'ok' | 'fail';

export function ConfigPanel({ onClose, onSave }: Props) {
  const cfg = getConfig();

  const [token,  setToken]  = useState(cfg.token);
  const [ifid,   setIfid]   = useState(String(cfg.ifid));
  const [baseUrl, setBaseUrl] = useState(cfg.baseUrl);

  const [testStatus,   setTestStatus]   = useState<TestStatus>('idle');
  const [testMessage,  setTestMessage]  = useState('');
  const [testIfaces,   setTestIfaces]   = useState<NtopInterface[]>([]);

  async function handleTest() {
    // Temporarily apply config so testConnection() uses the current form values
    saveConfig({ token, ifid: Number(ifid), baseUrl });
    setTestStatus('testing');
    setTestMessage('');
    setTestIfaces([]);

    try {
      const ifaces = await testConnection();
      setTestStatus('ok');
      setTestIfaces(ifaces);
      setTestMessage(`Conectado! ${ifaces.length} interface(s) encontrada(s).`);
    } catch (err) {
      setTestStatus('fail');
      setTestMessage(err instanceof Error ? err.message : String(err));
    }
  }

  function handleSave() {
    saveConfig({ token, ifid: Number(ifid), baseUrl });
    onSave();
    onClose();
  }

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Panel */}
      <div
        className="rounded-2xl p-6 w-full max-w-lg relative"
        style={{ background: '#0f1629', border: '1px solid #1e2d4a', boxShadow: '0 25px 60px #00000080' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg" style={{ background: '#00c8f018' }}>
              <Shield size={18} style={{ color: '#00c8f0' }} />
            </div>
            <div>
              <h2 className="font-bold text-sm" style={{ color: '#e2e8f0' }}>Configurações da API</h2>
              <p className="text-xs" style={{ color: '#475569' }}>ntopng REST v6.5 · flow-ntop.aquitelecom.com</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg transition-colors border-0 cursor-pointer"
            style={{ background: 'transparent', color: '#334155' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#94a3b8')}
            onMouseLeave={e => (e.currentTarget.style.color = '#334155')}
          >
            <X size={16} />
          </button>
        </div>

        {/* Cloudflare Access notice */}
        <div className="rounded-lg p-3 mb-4 flex gap-2"
          style={{ background: '#f59e0b10', border: '1px solid #f59e0b33' }}>
          <AlertCircle size={14} style={{ color: '#f59e0b', flexShrink: 0, marginTop: 1 }} />
          <div>
            <p className="text-xs font-semibold mb-1" style={{ color: '#f59e0b' }}>
              Cloudflare Access detectado
            </p>
            <p className="text-xs leading-relaxed" style={{ color: '#94a3b8' }}>
              O servidor está protegido pelo Cloudflare Zero Trust. Para que o proxy funcione,
              adicione o cookie <code className="font-mono" style={{ color: '#00c8f0' }}>CF_Authorization</code> no arquivo <code className="font-mono" style={{ color: '#00c8f0' }}>.env</code>:
            </p>
            <ol className="text-xs mt-1.5 flex flex-col gap-1" style={{ color: '#64748b' }}>
              <li>1. Abra <strong style={{ color: '#94a3b8' }}>flow-ntop.aquitelecom.com</strong> no Chrome</li>
              <li>2. DevTools → Application → Cookies → o domínio</li>
              <li>3. Copie o valor de <code className="font-mono" style={{ color: '#00c8f0' }}>CF_Authorization</code></li>
              <li>4. Cole em <code className="font-mono" style={{ color: '#00c8f0' }}>CF_AUTHORIZATION=</code> no <code>.env</code> e reinicie o servidor</li>
            </ol>
          </div>
        </div>

        {/* Fields */}
        <div className="flex flex-col gap-4">

          {/* Base URL */}
          <Field
            icon={<Globe size={14} style={{ color: '#475569' }} />}
            label="URL do Servidor ntopng"
            hint="Use o endereço do seu servidor"
          >
            <input
              type="text"
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
              placeholder="https://flow-ntop.aquitelecom.com"
              className="w-full rounded-lg px-3 py-2 text-xs font-mono outline-none transition-colors"
              style={{
                background: '#131c33',
                border: '1px solid #1e2d4a',
                color: '#e2e8f0',
              }}
              onFocus={e  => (e.currentTarget.style.borderColor = '#00c8f0')}
              onBlur={e   => (e.currentTarget.style.borderColor = '#1e2d4a')}
            />
          </Field>

          {/* Token */}
          <Field
            icon={<Key size={14} style={{ color: '#475569' }} />}
            label="Token de API ntopng"
            hint="Disponível em Admin → Preferências → Token"
          >
            <input
              type="password"
              value={token}
              onChange={e => setToken(e.target.value)}
              placeholder="••••••••••••••••"
              className="w-full rounded-lg px-3 py-2 text-xs font-mono outline-none transition-colors"
              style={{
                background: '#131c33',
                border: '1px solid #1e2d4a',
                color: '#e2e8f0',
              }}
              onFocus={e  => (e.currentTarget.style.borderColor = '#00c8f0')}
              onBlur={e   => (e.currentTarget.style.borderColor = '#1e2d4a')}
            />
          </Field>

          {/* Interface ID */}
          <Field
            icon={<Layers size={14} style={{ color: '#475569' }} />}
            label="Interface padrão (ifid)"
            hint="ID da interface a monitorar — veja o resultado do teste abaixo"
          >
            <input
              type="number"
              min={0}
              value={ifid}
              onChange={e => setIfid(e.target.value)}
              placeholder="1"
              className="w-full rounded-lg px-3 py-2 text-xs font-mono outline-none transition-colors"
              style={{
                background: '#131c33',
                border: '1px solid #1e2d4a',
                color: '#e2e8f0',
              }}
              onFocus={e  => (e.currentTarget.style.borderColor = '#00c8f0')}
              onBlur={e   => (e.currentTarget.style.borderColor = '#1e2d4a')}
            />
          </Field>

          {/* Test result */}
          {testStatus !== 'idle' && (
            <div
              className="rounded-lg p-3 flex flex-col gap-2"
              style={{
                background: testStatus === 'ok'
                  ? '#10b98110' : testStatus === 'fail'
                  ? '#ff3b3b10' : '#00c8f010',
                border: `1px solid ${
                  testStatus === 'ok' ? '#10b98133'
                  : testStatus === 'fail' ? '#ff3b3b33'
                  : '#00c8f033'
                }`,
              }}
            >
              <div className="flex items-center gap-2">
                {testStatus === 'testing' && <Loader size={13} className="animate-spin" style={{ color: '#00c8f0' }} />}
                {testStatus === 'ok'      && <CheckCircle size={13} style={{ color: '#10b981' }} />}
                {testStatus === 'fail'    && <XCircle size={13} style={{ color: '#ff3b3b' }} />}
                <span className="text-xs font-mono" style={{
                  color: testStatus === 'ok' ? '#10b981'
                    : testStatus === 'fail' ? '#ff3b3b'
                    : '#00c8f0',
                }}>
                  {testStatus === 'testing' ? 'Testando conexão…' : testMessage}
                </span>
              </div>

              {testStatus === 'ok' && testIfaces.length > 0 && (
                <div className="flex flex-col gap-1">
                  {testIfaces.map(iface => (
                    <div key={iface.id} className="flex items-center justify-between">
                      <span className="font-mono text-xs" style={{ color: '#94a3b8' }}>
                        <span style={{ color: '#00c8f0' }}>ifid:{iface.id}</span> · {iface.ifname}
                      </span>
                      <span className="text-xs" style={{ color: '#475569' }}>
                        {(iface.speed / 1000).toFixed(0)} Gbps
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Buttons */}
        <div className="flex items-center justify-between mt-6">
          <button
            onClick={handleTest}
            disabled={!token.trim() || testStatus === 'testing'}
            className="px-4 py-2 rounded-lg text-xs font-semibold border-0 cursor-pointer transition-all"
            style={{
              background: token.trim() ? '#00c8f018' : '#1e2d4a',
              color:      token.trim() ? '#00c8f0'   : '#334155',
              border:     `1px solid ${token.trim() ? '#00c8f033' : '#1e2d4a'}`,
              cursor:     token.trim() && testStatus !== 'testing' ? 'pointer' : 'not-allowed',
            }}
          >
            Testar Conexão
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-semibold border-0 cursor-pointer"
              style={{ background: '#1e2d4a', color: '#94a3b8' }}
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 rounded-lg text-xs font-semibold border-0 cursor-pointer"
              style={{ background: 'linear-gradient(135deg, #0099bb, #00d4ff)', color: '#fff' }}
            >
              Salvar e Aplicar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Helper sub-component ─────────────────────────────────────────────────────

function Field({
  icon, label, hint, children,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        {icon}
        <label className="text-xs font-medium" style={{ color: '#94a3b8' }}>{label}</label>
      </div>
      {children}
      <p className="text-xs mt-1" style={{ color: '#334155' }}>{hint}</p>
    </div>
  );
}
