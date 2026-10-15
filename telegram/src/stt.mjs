// Sesli mesaj → yazı. Claude ses almaz; bu yüzden OpenAI-uyumlu bir
// /audio/transcriptions servisi kullanılır (varsayılan: Groq Whisper, ücretsiz katmanı var).

export async function transcribe(stt, buffer, filename = 'ses.ogg', mime = 'audio/ogg') {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime }), filename);
  form.append('model', stt.model);
  if (stt.language) form.append('language', stt.language);
  form.append('response_format', 'json');
  const res = await fetch(stt.url, {
    method: 'POST',
    headers: { authorization: `Bearer ${stt.key}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Ses çözümleme HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return String(data.text || '').trim();
}
