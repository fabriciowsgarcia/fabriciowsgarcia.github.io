import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

// Campos que o app realmente usa. Qualquer outro campo enviado é descartado.
const ARRAY_KEYS = ['banks', 'events', 'goals', 'scenarios', 'cashflow'];
const OBJECT_KEYS = ['actuals', 'general', 'monthlyEdits'];
// O Firestore limita cada documento a 1 MiB; deixamos uma folga.
const MAX_BYTES = 900 * 1024;

// Inicializa o Firebase Admin sob demanda (evita quebrar o carregamento do módulo
// quando a variável de ambiente está ausente ou inválida).
function getServices() {
  if (!getApps().length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (!raw) throw new Error('Variável FIREBASE_SERVICE_ACCOUNT_KEY não definida.');
    const key = JSON.parse(raw);
    // A Vercel costuma gravar as quebras de linha da chave privada como "\\n".
    if (key.private_key) key.private_key = key.private_key.replace(/\\n/g, '\n');
    initializeApp({ credential: cert(key) });
  }
  return { db: getFirestore(), auth: getAuth() };
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Valida o formato e o tamanho do corpo. Retorna null se for inválido.
function sanitize(body) {
  if (!isPlainObject(body)) return null;
  const clean = {};
  for (const key of ARRAY_KEYS) {
    if (!(key in body)) continue;
    if (!Array.isArray(body[key])) return null;
    clean[key] = body[key];
  }
  for (const key of OBJECT_KEYS) {
    if (!(key in body)) continue;
    if (!isPlainObject(body[key])) return null;
    clean[key] = body[key];
  }
  if (Buffer.byteLength(JSON.stringify(clean)) > MAX_BYTES) return null;
  return clean;
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');

  if (request.method !== 'GET' && request.method !== 'POST') {
    response.setHeader('Allow', 'GET, POST');
    return response.status(405).json({ error: 'Método não permitido.' });
  }

  let db, auth;
  try {
    ({ db, auth } = getServices());
  } catch (error) {
    console.error('Falha ao inicializar o Firebase Admin:', error);
    return response.status(500).json({ error: 'Erro de configuração do servidor.' });
  }

  const header = request.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return response.status(401).json({ error: 'Token de autenticação ausente.' });
  }

  let uid;
  try {
    ({ uid } = await auth.verifyIdToken(header.slice('Bearer '.length)));
  } catch (error) {
    console.error('Token inválido:', error.code || error.message);
    return response.status(401).json({ error: 'Token de autenticação inválido ou expirado.' });
  }

  const docRef = db.collection('users').doc(uid);

  if (request.method === 'GET') {
    try {
      const snap = await docRef.get();
      return response.status(200).json(snap.exists ? snap.data() : {});
    } catch (error) {
      console.error('Erro ao ler documento:', error);
      return response.status(500).json({ error: 'Falha ao carregar os dados.' });
    }
  }

  // POST
  const data = sanitize(request.body);
  if (!data) {
    return response.status(400).json({ error: 'Dados inválidos ou grandes demais.' });
  }
  try {
    await docRef.set({ ...data, updatedAt: FieldValue.serverTimestamp() });
    return response.status(200).json({ ok: true });
  } catch (error) {
    console.error('Erro ao salvar documento:', error);
    return response.status(500).json({ error: 'Falha ao salvar os dados.' });
  }
}
