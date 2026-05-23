const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response('', { status: 200, headers });
  }

  return new Response(JSON.stringify({
    error: 'This legacy Pages Function is retired. Use the authenticated Worker /api/fal-proxy endpoint.',
    code: 'LEGACY_FUNCTION_RETIRED',
  }), { status: 410, headers });
}
