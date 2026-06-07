// Serverless function: bestelmail → gestructureerde orderregels via Claude.
// Zonder ANTHROPIC_API_KEY in de omgeving antwoordt hij netjes dat live verwerking uit staat;
// de frontend valt dan terug op de voorbeeldresultaten.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'alleen POST' });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'live verwerking uitgeschakeld (geen API-key geconfigureerd)' });
  }
  const mail = (req.body && req.body.mail ? String(req.body.mail) : '').slice(0, 4000);
  if (mail.length < 20) {
    return res.status(400).json({ error: 'mailtekst te kort' });
  }

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1200,
        system: 'Je zet Nederlandse bestelmails om naar gestructureerde orderdata. Antwoord UITSLUITEND met geldige JSON, zonder toelichting, met exact deze vorm: {"klant": string, "leveradres": string, "gewenste_levering": string, "opmerkingen": string (signaleringen voor de orderverwerker: ontbrekende info, spoed, voorwaardelijke wensen), "regels": [{"artikel": string, "specificatie": string, "aantal": string, "eenheid": string}]}. Verzin niets dat niet in de mail staat; gebruik "—" voor onbekende velden.',
        messages: [{ role: 'user', content: 'Bestelmail:\n\n' + mail }]
      })
    });
    if (!r.ok) {
      const t = await r.text();
      return res.status(502).json({ error: 'AI-verwerking mislukt', detail: t.slice(0, 200) });
    }
    const data = await r.json();
    const text = (data.content && data.content[0] && data.content[0].text) || '';
    const jsonStart = text.indexOf('{');
    const parsed = JSON.parse(text.slice(jsonStart));
    if (!Array.isArray(parsed.regels)) throw new Error('geen regels');
    return res.status(200).json(parsed);
  } catch (e) {
    return res.status(502).json({ error: 'verwerking mislukt: ' + e.message });
  }
}
