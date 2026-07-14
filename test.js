const { execSync } = require('child_process');
const assert = require('assert');

const API = 'http://127.0.0.1:3001';
process.env.SHELL = 'bash';
let pass = 0, fail = 0;

function api(method, path, body = null, token = null) {
  const headers = [];
  headers.push('Content-Type: application/json');
  if (token) headers.push('Authorization: Bearer ' + token);
  let cmd = 'curl -s -X ' + method + ' "' + API + path + '"';
  for (const h of headers) cmd += ' -H "' + h + '"';
  if (body) {
    const escaped = JSON.stringify(body).replace(/"/g, '\\"');
    cmd += ' -d "' + escaped + '"';
  }
  const out = execSync(cmd, { encoding: 'utf8', timeout: 5000, shell: 'bash' });
  try { return JSON.parse(out); } catch { return { _raw: out.substring(0, 200) }; }
}

function check(name, fn) {
  try { fn(); console.log('  \u2713 ' + name); pass++; }
  catch(e) { console.log('  \u2717 ' + name + ': ' + e.message); fail++; }
}

console.log('\n\uD83D\uDD0D SwapConnect Production Tests\n');

check('Health', () => { assert.strictEqual(api('GET', '/api/health').status, 'ok'); });
check('Send OTP', () => { assert.strictEqual(api('POST', '/api/auth/send-otp', { phone: '7777777771' }).success, true); });

let token;
check('Verify OTP + Login', () => {
  const d = api('POST', '/api/auth/verify-otp', { phone: '7777777771', code: '123456', name: 'Ravi' });
  assert.strictEqual(d.success, true); assert.ok(d.token); token = d.token;
});

check('Update Profile', () => {
  const d = api('PATCH', '/api/me', { city: 'Mumbai' }, token);
  assert.strictEqual(d.success, true); assert.strictEqual(d.user.city, 'Mumbai');
});

let swapId;
check('Register Swap', () => {
  const d = api('POST', '/api/swaps', { from_city: 'Mumbai', to_city: 'Delhi', note: 'Test' }, token);
  assert.strictEqual(d.success, true); swapId = d.swap.id;
});

check('View My Swaps', () => { assert.ok(api('GET', '/api/swaps/mine', null, token).swaps.length > 0); });
check('Duplicate Blocked', () => { assert.ok(api('POST', '/api/swaps', { from_city: 'Mumbai', to_city: 'Delhi' }, token).error); });
check('Same City Blocked', () => { assert.ok(api('POST', '/api/swaps', { from_city: 'Mumbai', to_city: 'Mumbai' }, token).error); });
check('City Search', () => { assert.ok(api('GET', '/api/cities/search?q=mum', null, token).cities.includes('Mumbai')); });
check('Stats', () => { assert.ok(api('GET', '/api/stats').users >= 1); });
check('Cancel Swap', () => { assert.strictEqual(api('DELETE', '/api/swaps/' + swapId, null, token).success, true); });

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail > 0 ? 1 : 0);