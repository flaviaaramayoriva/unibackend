const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET;
const BASE = 'https://unibackend-production-a0f8.up.railway.app';

async function call(path, token) {
  const res = await fetch(BASE + path, { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } });
  const text = await res.text();
  console.log('=== ', path, '->', res.status);
  try { return JSON.parse(text); } catch { console.log(text); return text; }
}

(async () => {
  for (const id of [24, 57, 59]) {
    const token = jwt.sign({ idusuario: id }, SECRET, { expiresIn: '1d' });
    console.log('\n########## USUARIO', id, '##########');
    const profile = await call('/profile', token);
    console.log(JSON.stringify(profile, null, 1));
    const comite = await call('/dashboard/my-committee-events', token);
    console.log('events count:', Array.isArray(comite) ? comite.length : comite.events?.length);
    console.log(JSON.stringify(comite, null, 1));
    const aprob = await call('/eventos/aprobados-por-facultad', token);
    const arr = Array.isArray(aprob) ? aprob : aprob.events;
    console.log('aprobados count:', Array.isArray(arr) ? arr.length : 'n/a');
    if (Array.isArray(arr)) {
      arr.slice(0, 8).forEach(e => console.log(' -', e.idevento, e.nombreevento?.slice(0, 40), '| idacademico:', e.idacademico, '| Comite:', (e.Comite||[]).map(m => m.idusuario).join(',')));
    }
  }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });