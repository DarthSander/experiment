// Serverless function: bestelmail → gestructureerde orderregels via Claude.
// Zonder ANTHROPIC_API_KEY in de omgeving antwoordt hij netjes dat live verwerking uit staat;
// de frontend valt dan terug op de voorbeeldresultaten.

// Haalt het eerste complete JSON-object uit een tekst (negeert tekst ervoor/erna,
// en accurate haakjes-balancering negeert { } binnen strings).
function extractJson(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); }
        catch { return null; }
      }
    }
  }
  return null;
}

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
        system: 'Je zet Nederlandse bestelmails om naar gestructureerde orderdata. Antwoord UITSLUITEND met geldige JSON, zonder toelichting, met exact deze vorm: {"klant": string, "leveradres": string, "gewenste_levering": string, "opmerkingen": string (signaleringen voor de orderverwerker: ontbrekende info, spoed, voorwaardelijke wensen), "regels": [{"artikel": string, "specificatie": string, "aantal": string, "eenheid": string}]}. Kernregels: (1) Neem ELKE in de mail genoemde productregel op in "regels"; laat NOOIT een regel weg, ook niet bij correcties of meerdere leveringen — een weggelaten regel is de ergst mogelijke fout. (2) Bij een correctie ("nee, maak er 40 van") gebruik je de DEFINITIEVE waarde. (3) Bij MEERDERE leveradressen: zet "leveradres" op "Meerdere — zie regels", vermeld het bijbehorende adres in de "specificatie" van elke regel, en meld dit nadrukkelijk in "opmerkingen". (4) Verzin niets dat niet in de mail staat; gebruik "—" voor onbekende velden. (5) Bij een mail zonder bestelling (bijv. een klacht) laat je "regels" leeg en leg je dat uit in "opmerkingen".',
        messages: [{ role: 'user', content: 'Bestelmail:\n\n' + mail }]
      })
    });
    if (!r.ok) {
      const t = await r.text();
      return res.status(502).json({ error: 'AI-verwerking mislukt', detail: t.slice(0, 200) });
    }
    const data = await r.json();
    const text = (data.content && data.content[0] && data.content[0].text) || '';
    const parsed = extractJson(text);
    if (!parsed || !Array.isArray(parsed.regels)) throw new Error('geen geldige orderregels in AI-antwoord');
    return res.status(200).json(parsed);
  } catch (e) {
    return res.status(502).json({ error: 'verwerking mislukt: ' + e.message });
  }
}
