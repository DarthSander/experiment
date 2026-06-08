// Serverless function: bestelmail OF foto van een bestelbon → gestructureerde orderregels via Claude.
// Tekst (req.body.mail) of afbeelding (req.body.image = base64, req.body.mediaType).
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

const SYSTEM = 'Je zet Nederlandse bestellingen (uit een mail of van een foto van een bestelbon — die handgeschreven of gefaxt kan zijn) om naar gestructureerde orderdata. Antwoord UITSLUITEND met geldige JSON, zonder toelichting, met exact deze vorm: {"klant": string, "leveradres": string, "gewenste_levering": string, "opmerkingen": string (signaleringen voor de orderverwerker: ontbrekende info, spoed, voorwaardelijke wensen, slecht leesbare tekst), "regels": [{"artikel": string, "specificatie": string, "aantal": string, "eenheid": string}]}. Kernregels: (1) Neem ELKE genoemde productregel op in "regels"; laat NOOIT een regel weg, ook niet bij correcties of meerdere leveringen — een weggelaten regel is de ergst mogelijke fout. (2) Bij een correctie ("nee, maak er 40 van") gebruik je de DEFINITIEVE waarde. (3) Bij MEERDERE leveradressen: zet "leveradres" op "Meerdere — zie regels", vermeld het bijbehorende adres in de "specificatie" van elke regel, en meld dit nadrukkelijk in "opmerkingen". (4) Verzin niets dat er niet staat; gebruik "—" voor onbekende velden. (5) Bij iets zonder bestelling (bijv. een klacht) laat je "regels" leeg en leg je dat uit in "opmerkingen". (6) Bij een foto: lees zorgvuldig, ook handschrift; is een waarde onleesbaar of twijfelachtig, zet dan je beste lezing met een "?" en meld het in "opmerkingen" — verzin geen aantallen. (7) "klant" = de bedrijfs-/klantnaam als die ergens staat (in een kop, briefhoofd of "factuur op ..."), met de contactpersoon er eventueel bij tussen haakjes; verwar de ondertekenaar/afzender niet met de bedrijfsnaam.';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'alleen POST' });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'live verwerking uitgeschakeld (geen API-key geconfigureerd)' });
  }

  const body = req.body || {};
  const rawImage = body.image ? String(body.image) : '';
  let userContent;

  if (rawImage) {
    // Accepteer zowel "data:image/...;base64,XXXX" als kale base64.
    const m = rawImage.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s);
    const mediaType = m ? m[1] : (body.mediaType ? String(body.mediaType) : 'image/jpeg');
    const b64 = m ? m[2] : rawImage;
    // Ruwe groottelimiet (~6MB binair ≈ 8MB base64) om misbruik/timeouts te beperken.
    if (b64.length > 8_000_000) {
      return res.status(413).json({ error: 'afbeelding te groot (max ~6MB)' });
    }
    if (!/^image\/(jpeg|png|webp|gif)$/.test(mediaType)) {
      return res.status(400).json({ error: 'beeldformaat niet ondersteund (gebruik JPEG, PNG, WEBP of GIF)' });
    }
    userContent = [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
      { type: 'text', text: 'Dit is een foto van een bestelling (mogelijk handgeschreven of gefaxt). Lees de bestelling en zet hem om naar de gevraagde JSON.' }
    ];
  } else {
    const mail = (body.mail ? String(body.mail) : '').slice(0, 4000);
    if (mail.length < 20) {
      return res.status(400).json({ error: 'mailtekst te kort' });
    }
    userContent = 'Bestelmail:\n\n' + mail;
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
        system: SYSTEM,
        messages: [{ role: 'user', content: userContent }]
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
