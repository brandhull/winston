function checkPin(request, env) {
  const pin = request.headers.get('X-Pin');
  return pin && pin === env.PIN;
}

export async function onRequestGet({ request, env }) {
  if (!checkPin(request, env)) return new Response('Unauthorized', { status: 401 });

  const baseUrl = env.BASEROW_API_URL || 'https://api.baserow.io';
  const tableId = env.BASEROW_TABLE_ID;
  const token = env.BASEROW_TOKEN;

  const results = [];
  let url = `${baseUrl}/api/database/rows/table/${tableId}/?user_field_names=true&size=200`;

  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Token ${token}` } });
    if (!res.ok) {
      return new Response(await res.text(), { status: res.status });
    }
    const data = await res.json();
    results.push(...data.results);
    // Baserow returns `next` as http:// even when queried over https; that
    // scheme downgrade makes fetch() drop the Authorization header on redirect.
    url = data.next ? data.next.replace(/^http:/, 'https:') : null;
  }

  return new Response(JSON.stringify(results), {
    headers: { 'Content-Type': 'application/json' },
  });
}
