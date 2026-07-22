export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGIN || '*';
    const cors = {
      'Access-Control-Allow-Origin': allowed === '*' ? '*' : (origin === allowed ? origin : allowed),
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store',
      'Vary': 'Origin'
    };
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors});
    if (request.method !== 'GET') return json({status:'error',message:'GET only'},405,cors);
    if (!env.TWELVE_DATA_API_KEY) return json({status:'error',message:'TWELVE_DATA_API_KEY secret missing'},500,cors);

    const u = new URL(request.url);
    const mode = u.searchParams.get('mode') === 'price' ? 'price' : 'eod';
    const symbol = String(u.searchParams.get('symbol') || 'SOXL').toUpperCase();
    const date = String(u.searchParams.get('date') || '');
    if (symbol !== 'SOXL') return json({status:'error',message:'Only SOXL is allowed'},400,cors);
    if (mode === 'eod' && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({status:'error',message:'Valid date required'},400,cors);

    const api = new URL('https://api.twelvedata.com/' + mode);
    api.searchParams.set('symbol', symbol);
    api.searchParams.set('dp', '8');
    if (mode === 'eod') api.searchParams.set('date', date);
    const res = await fetch(api.toString(), {
      headers: {'Authorization': 'apikey ' + env.TWELVE_DATA_API_KEY, 'Accept': 'application/json'},
      cf: {cacheTtl: 0, cacheEverything: false}
    });
    const body = await res.text();
    return new Response(body, {status: res.status, headers: {...cors, 'Content-Type':'application/json; charset=utf-8'}});
  }
};
function json(value,status,headers){return new Response(JSON.stringify(value),{status,headers:{...headers,'Content-Type':'application/json; charset=utf-8'}});}
