// Importa as ferramentas necessárias do Firebase Admin SDK
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

// --- INÍCIO DA CONFIGURAÇÃO SEGURA ---
let serviceAccount;
try {
  // Lê a chave de serviço diretamente da variável de ambiente da Vercel.
  // O conteúdo deve ser o JSON completo, como uma string.
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
} catch (error) {
  console.error("ERRO CRÍTICO: Falha ao analisar a chave de serviço do Firebase. Verifique a variável de ambiente na Vercel.", error);
  // Se a chave falhar, não podemos continuar.
}
// --- FIM DA CONFIGURAÇÃO SEGURA ---


// Inicializa o app do Firebase Admin (apenas se ainda não foi inicializado)
if (serviceAccount && !getApps().length) {
  initializeApp({
    credential: cert(serviceAccount)
  });
}

// Pega as instâncias do banco de dados e da autenticação
const db = getFirestore();
const auth = getAuth();

// A função principal que lida com os pedidos
export default async function handler(request, response) {
  // Verifica se a chave de serviço foi carregada corretamente
  if (!serviceAccount) {
      return response.status(500).send('Erro de configuração do servidor: Chave do Firebase não encontrada.');
  }

  // Verifica se o usuário enviou um token de autenticação
  if (!request.headers.authorization || !request.headers.authorization.startsWith('Bearer ')) {
    return response.status(401).send('Authorization token missing or invalid.');
  }

  const idToken = request.headers.authorization.split('Bearer ')[1];
  let decodedToken;

  // Verifica se o token é válido e pega o ID do usuário
  try {
    decodedToken = await auth.verifyIdToken(idToken);
  } catch (error) {
    console.error('Error verifying auth token:', error);
    return response.status(403).send('Invalid authentication token.');
  }
  
  const userId = decodedToken.uid;
  const docRef = db.collection('users').doc(userId);

  // Se for um pedido GET, carrega os dados
  if (request.method === 'GET') {
    try {
      const docSnap = await docRef.get();
      if (docSnap.exists) {
        return response.status(200).json(docSnap.data());
      } else {
        // Se não houver dados, retorna um objeto vazio
        return response.status(200).json({});
      }
    } catch (error) {
      console.error('Error getting document:', error);
      return response.status(500).send('Failed to retrieve data.');
    }
  }

  // Se for um pedido POST, salva os dados
  if (request.method === 'POST') {
    try {
      const dataToSave = request.body;
      await docRef.set(dataToSave);
      return response.status(200).send('Data saved successfully.');
    } catch (error) {
      console.error('Error setting document:', error);
      return response.status(500).send('Failed to save data.');
    }
  }

  // Se for qualquer outro tipo de pedido, retorna um erro
  return response.status(405).send('Method Not Allowed');
}
