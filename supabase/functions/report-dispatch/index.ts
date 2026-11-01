// Fonction Supabase (Deno) : déclenche immédiatement le traitement des signalements sur GitHub.
// Appelée par la base à chaque nouveau signalement (déclencheur public.dispatch_report).
//
// Secrets de la fonction (supabase secrets set …) :
//   DISPATCH_SECRET         secret partagé avec la base (vault : report_dispatch_secret)
//   GITHUB_DISPATCH_TOKEN   jeton GitHub « fine-grained » limité au dépôt, permission Actions : lecture/écriture
//   GITHUB_REPOSITORY       ex. « Hugo801104/grand-savoir »
//
// Le jeton ne permet que de lancer un workflow : il ne donne aucun accès au code ni aux secrets.
// Plusieurs signalements rapprochés ne lancent qu'un traitement (file d'attente GitHub « concurrency »).

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('méthode non autorisée', { status: 405 });
  const secret = Deno.env.get('DISPATCH_SECRET') ?? '';
  const auth = req.headers.get('authorization') ?? '';
  if (!secret || auth !== `Bearer ${secret}`) return new Response('non autorisé', { status: 401 });

  const token = Deno.env.get('GITHUB_DISPATCH_TOKEN');
  const repo = Deno.env.get('GITHUB_REPOSITORY');
  if (!token || !repo) return new Response('configuration incomplète', { status: 500 });

  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/agent-signalements.yml/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'grand-savoir-dispatch',
    },
    body: JSON.stringify({ ref: 'main' }),
  });
  if (!res.ok) return new Response(`GitHub : ${res.status}`, { status: 502 });
  return new Response('ok', { status: 202 });
});
