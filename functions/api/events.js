export async function onRequestPost({ request, env }) {
  const body = await request.json();
  if (!body.runId || !body.event?.tool) return Response.json({ error:'Invalid event' }, { status:400 });
  const now = body.event.createdAt || new Date().toISOString();
  await env.GAUNTLET_DB.batch([
    env.GAUNTLET_DB.prepare('INSERT OR IGNORE INTO runs (id,created_at,user_agent) VALUES (?,?,?)').bind(body.runId, now, body.userAgent?.slice(0,500) || null),
    env.GAUNTLET_DB.prepare('INSERT INTO events (run_id,tool_name,args_json,created_at) VALUES (?,?,?,?)').bind(body.runId, body.event.tool, JSON.stringify(body.event.args || {}), now)
  ]);
  return Response.json({ ok:true });
}
