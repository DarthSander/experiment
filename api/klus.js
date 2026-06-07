// Ontvangt een ingezonden klus van de one-pager en mailt 'm naar Sams Gmail via Resend.
// Volledig onder eigen beheer: geen derde-partij-formulierdienst, geen e-mailadres in de HTML.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'alleen POST' });
  }
  // Strip eventuele BOM/whitespace die via env-tooling in de waarde kan sluipen.
  const apiKey = (process.env.RESEND_API_KEY || '').replace(/[^\x21-\x7E]/g, '');
  if (!apiKey) {
    return res.status(503).json({ error: 'e-mailbezorging niet geconfigureerd' });
  }

  const body = req.body || {};
  const naam = String(body.naam || '').slice(0, 200).trim();
  const email = String(body.email || '').slice(0, 200).trim();
  const klus = String(body.klus || '').slice(0, 5000).trim();
  // honeypot tegen bots
  if (body._honey) return res.status(200).json({ success: true });

  if (!naam || !email || !klus) {
    return res.status(400).json({ error: 'vul je naam, e-mailadres en klus in' });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'controleer je e-mailadres' });
  }

  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const html =
    '<h2>Nieuwe klus via sam-experiment.vercel.app</h2>' +
    '<p><strong>Naam/bedrijf:</strong> ' + esc(naam) + '</p>' +
    '<p><strong>E-mail:</strong> ' + esc(email) + '</p>' +
    '<p><strong>Klus:</strong></p><p>' + esc(klus).replace(/\n/g, '<br>') + '</p>';

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Sam experiment <onboarding@resend.dev>',
        to: ['sam.experiment.dbsoftware@gmail.com'],
        reply_to: email,
        subject: 'Nieuwe klus van ' + naam,
        html: html
      })
    });
    if (!r.ok) {
      const t = await r.text();
      return res.status(502).json({ error: 'versturen mislukt', detail: t.slice(0, 200) });
    }
    return res.status(200).json({ success: true });
  } catch (e) {
    return res.status(502).json({ error: 'versturen mislukt: ' + e.message });
  }
}
