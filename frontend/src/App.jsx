import { useState, useEffect, useCallback } from 'react';
import { KARNATAKA_DISTRICTS_TALUKS, getDistricts, getTaluks } from './data/karnatakaDistrictsTaluks';

const API = 'http://127.0.0.1:3001';

function App() {
  const [step, setStep] = useState('login');
  const [token, setToken] = useState(localStorage.getItem('swaptoken') || '');
  const [user, setUser] = useState(null);
  const [swaps, setSwaps] = useState([]);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState({ text: '', type: '' });

  // Login
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [countdown, setCountdown] = useState(0);

  // Swap form - now using district/taluk
  const [district, setDistrict] = useState('');
  const [taluk, setTaluk] = useState('');
  const [designation, setDesignation] = useState('');
  const [workplace, setWorkplace] = useState('');
  const [taluks, setTaluks] = useState([]);

  useEffect(() => { if (countdown > 0) { const t = setTimeout(() => setCountdown(c => c - 1), 1000); return () => clearTimeout(t); } }, [countdown]);

  const api = useCallback(async (path, opts = {}) => {
    const res = await fetch(`${API}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...opts.headers }
    });
    return res.json();
  }, [token]);

  useEffect(() => {
    if (token) { api('/api/me').then(d => { if (d.user) { setUser(d.user); setStep('home'); loadData(); } else { logout(); } }); }
  }, [token]);

  async function loadData() {
    const [swapData, statData] = await Promise.all([api('/api/swaps/mine'), api('/api/stats')]);
    setSwaps(swapData.swaps || []);
    setMatches(swapData.matches || []);
    setStats(statData);
  }

  function logout() { setToken(''); localStorage.removeItem('swaptoken'); setUser(null); setStep('login'); setSwaps([]); setMatches([]); }

  async function sendOtp(e) {
    e.preventDefault();
    if (phone.length !== 10) return showMsg('Enter 10-digit number', 'error');
    setLoading(true);
    const d = await api('/api/auth/send-otp', { method: 'POST', body: JSON.stringify({ phone }) });
    setLoading(false);
    if (d.success) { setOtpSent(true); setCountdown(30); showMsg('OTP sent! (Pilot: 123456)', 'success'); }
    else showMsg(d.error, 'error');
  }

  async function verifyOtp(e) {
    e.preventDefault();
    setLoading(true);
    const d = await api('/api/auth/verify-otp', { method: 'POST', body: JSON.stringify({ phone, code, name }) });
    setLoading(false);
    if (d.success) { setToken(d.token); localStorage.setItem('swaptoken', d.token); setUser(d.user); setStep('home'); showMsg('Welcome!', 'success'); }
    else showMsg(d.error, 'error');
  }

  // When district changes, load its taluks
  function onDistrictChange(e) {
    const d = e.target.value;
    setDistrict(d);
    setTaluks(getTaluks(d));
    setTaluk('');
  }

  async function registerSwap(e) {
    e.preventDefault();
    if (!district) return showMsg('Select district', 'error');
    if (!taluk) return showMsg('Select taluk', 'error');
    if (!designation) return showMsg('Enter designation', 'error');
    if (!workplace) return showMsg('Enter workplace', 'error');
    setLoading(true);
    const d = await api('/api/swaps', { method: 'POST', body: JSON.stringify({ district, taluk, designation, workplace }) });
    setLoading(false);
    if (d.success) { showMsg('Transfer request registered!', 'success'); loadData(); setDistrict(''); setTaluk(''); setDesignation(''); setWorkplace(''); setTaluks([]); }
    else showMsg(d.error, 'error');
  }

  async function cancelSwap(id) { await api(`/api/swaps/${id}`, { method: 'DELETE' }); loadData(); showMsg('Request removed', 'info'); }

  async function revealMatch(id) { await api(`/api/matches/${id}/reveal`, { method: 'POST' }); loadData(); }

  function showMsg(text, type) { setMsg({ text, type }); setTimeout(() => setMsg({ text: '', type: '' }), 4000); }

  const districts = getDistricts();

  if (step === 'login' && !otpSent) return (
    <div className="screen">
      <div className="hero">
        <h1>🔄 SwapConnect</h1>
        <p>Revenue Department — Taluk-level Transfer Requests</p>
      </div>
      <form onSubmit={sendOtp} className="card">
        <h2>Get Started</h2>
        <label>Phone Number</label>
        <input type="tel" placeholder="10-digit mobile number" value={phone}
          onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} required />
        <button type="submit" disabled={loading || phone.length !== 10}>
          {loading ? 'Sending...' : 'Send OTP →'}
        </button>
      </form>
      {msg.text && <div className={`toast ${msg.type}`}>{msg.text}</div>}
    </div>
  );

  if (step === 'login' && otpSent) return (
    <div className="screen">
      <div className="hero"><h1>🔄 Verify OTP</h1><p>Sent to +91 {phone}</p></div>
      <form onSubmit={verifyOtp} className="card">
        <input type="text" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} />
        <label>OTP (use 123456)</label>
        <input type="text" placeholder="6-digit OTP" value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} required autoFocus />
        <button type="submit" disabled={loading || code.length < 6}>
          {loading ? 'Verifying...' : 'Verify & Enter →'}
        </button>
        {countdown > 0 && <p className="hint">Resend in {countdown}s</p>}
        {countdown === 0 && <button type="button" className="btn-link" onClick={() => { setOtpSent(false); setCode(''); }}>Change number</button>}
      </form>
      {msg.text && <div className={`toast ${msg.type}`}>{msg.text}</div>}
    </div>
  );

  return (
    <div className="screen home">
      <header>
        <div>
          <h1>🔄 SwapConnect</h1>
          <span className="user-badge">👤 {user?.phone}</span>
        </div>
        <button onClick={logout} className="btn-sm">Logout</button>
      </header>

      {msg.text && <div className={`toast ${msg.type}`}>{msg.text}</div>}

      <div className="grid-2">
        <div>
          <div className="card">
            <h2>📋 Register Transfer Request</h2>
            <p className="hint">Revenue/Survey Department — Taluk-level posting</p>
            <form onSubmit={registerSwap}>
              <label>District</label>
              <select value={district} onChange={onDistrictChange} required>
                <option value="">— Select District —</option>
                {districts.map(d => <option key={d} value={d}>{d}</option>)}
              </select>

              <label>Taluk</label>
              <select value={taluk} onChange={e => setTaluk(e.target.value)} required disabled={!district}>
                <option value="">— Select Taluk —</option>
                {taluks.map(t => <option key={t} value={t}>{t}</option>)}
              </select>

              <label>Designation</label>
              <input type="text" placeholder="e.g. Survey Officer, Tehsildar, Revenue Inspector" value={designation}
                onChange={e => setDesignation(e.target.value)} required />

              <label>Working Place</label>
              <input type="text" placeholder="e.g. Taluk Office, Survey Dept, DC Office" value={workplace}
                onChange={e => setWorkplace(e.target.value)} required />

              <button type="submit" disabled={loading || !district || !taluk || !designation || !workplace}>
                {loading ? 'Registering...' : 'Register Request'}
              </button>
            </form>
          </div>
        </div>

        <div>
          {swaps.length > 0 && (
            <div className="card">
              <h2>📋 My Requests ({swaps.length})</h2>
              {swaps.map(s => (
                <div key={s.id} className="swap-row">
                  <span><strong>{s.district}</strong> / <strong>{s.taluk}</strong></span>
                  {s.designation && <span className="note-tag">{s.designation}</span>}
                  <button onClick={() => cancelSwap(s.id)} className="btn-sm btn-danger">✕</button>
                </div>
              ))}
            </div>
          )}

          {matches.length > 0 && (
            <div className="card highlight">
              <h2>🎉 Match Found! ({matches.length})</h2>
              {matches.map(m => (
                <div key={m.id} className="match-card">
                  <div className="match-route">
                    <span>{m.theirDistrict}</span> / <span>{m.theirTaluk}</span>
                  </div>
                  {m.revealed ? (
                    <div className="revealed">
                      <p><strong>{m.theirName || 'Officer'}</strong> — {m.theirDesignation}</p>
                      <p className="phone-display">📞 {m.theirPhone}</p>
                      <p className="hint">Contact directly to proceed with formal transfer process.</p>
                    </div>
                  ) : (
                    <button onClick={() => revealMatch(m.id)} className="btn-green">
                      👁 Reveal Contact Details
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {swaps.length === 0 && matches.length === 0 && (
            <div className="card empty">
              <p>👈 Register a transfer request to find matches</p>
              <p className="hint">Select your district, taluk, designation, and workplace</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;