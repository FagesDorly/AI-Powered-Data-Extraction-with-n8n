// Fonction serverless Vercel : relaie le PDF vers le webhook n8n.
// L'URL du webhook est lue dans la variable d'environnement N8N_WEBHOOK_URL.

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée." });
  }

  const target = process.env.N8N_WEBHOOK_URL;
  if (!target) {
    return res.status(500).json({ error: "N8N_WEBHOOK_URL n'est pas configurée sur le serveur." });
  }

  try {
    const body = await readBody(req);
    const headers = { "content-type": req.headers["content-type"] || "application/octet-stream" };
    if (process.env.N8N_AUTH_HEADER) {
      // Optionnel : "Nom-Header: valeur" si le webhook n8n est protégé (Header Auth)
      const i = process.env.N8N_AUTH_HEADER.indexOf(":");
      if (i > 0) headers[process.env.N8N_AUTH_HEADER.slice(0, i).trim()] = process.env.N8N_AUTH_HEADER.slice(i + 1).trim();
    }

    const upstream = await fetch(target, { method: "POST", headers, body });
    const text = await upstream.text();

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `n8n a répondu ${upstream.status}. Vérifiez que le workflow est actif.` });
    }
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
    return res.status(200).send(text);
  } catch (e) {
    return res.status(502).json({ error: "Impossible de joindre n8n." });
  }
};

// On désactive le parsing automatique pour relayer le multipart tel quel.
module.exports.config = { api: { bodyParser: false } };
