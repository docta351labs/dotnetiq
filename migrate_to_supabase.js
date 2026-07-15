const fs = require('fs');
const path = require('path');

// 1. Parser simple de archivo .env (sin dependencias externas)
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    console.error('❌ Error: El archivo .env no existe en la raíz del proyecto.');
    console.error('👉 Por favor, copia el archivo ".env.example" como ".env" y configúralo con tus credenciales.');
    process.exit(1);
  }

  const env = {};
  const content = fs.readFileSync(envPath, 'utf8');
  content.split(/\r?\n/).forEach(line => {
    const clean = line.trim();
    if (!clean || clean.startsWith('#')) return;
    const match = clean.match(/^([^=]+)=(.*)$/);
    if (!match) return;
    const key = match[1].trim();
    let val = match[2].trim();
    
    // Quitar comillas si existen
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  });

  return env;
}

const env = loadEnv();
const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Error: SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY no están definidos en el archivo .env');
  process.exit(1);
}

// 2. Función para evaluar y extraer los datos de los archivos locales JS
function extractDataFromJs(fileName, studyVar, quizVar) {
  const filePath = path.join(__dirname, fileName);
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️ Advertencia: El archivo ${fileName} no existe en la ruta. Saltando.`);
    return null;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  
  try {
    // Reemplazamos const con var para evaluar en el scope local y retornamos el objeto estructurado
    const evalScript = content.replace(/const /g, 'var ') + `\n; ({ studyData: ${studyVar}, quizQuestions: ${quizVar} });`;
    const data = eval(evalScript);
    return data;
  } catch (error) {
    console.error(`❌ Error al analizar el archivo JS ${fileName}:`, error.message);
    return null;
  }
}

// 3. Función para realizar peticiones HTTP a la API de Supabase (PostgREST)
async function supabaseRequest(endpoint, method, body = null, queryParams = '') {
  const url = `${SUPABASE_URL}/rest/v1/${endpoint}${queryParams}`;
  const headers = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };

  const options = {
    method,
    headers
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  return response.json().catch(() => null);
}

// 4. Proceso principal de migración
async function runMigration() {
  console.log('🚀 Iniciando migración de datos a Supabase...');
  console.log(`📍 Proyecto Supabase: ${SUPABASE_URL}\n`);

  const levels = [
    {
      name: 'semisenior',
      file: 'questions_semisenior.js',
      studyVar: 'semiseniorStudyData',
      quizVar: 'semiseniorQuizQuestions'
    },
    {
      name: 'senior',
      file: 'questions_senior.js',
      studyVar: 'seniorStudyData',
      quizVar: 'seniorQuizQuestions'
    },
    {
      name: 'principal',
      file: 'questions_principal.js',
      studyVar: 'principalStudyData',
      quizVar: 'principalQuizQuestions'
    }
  ];

  for (const lvl of levels) {
    console.log(`--------------------------------------------------`);
    console.log(`📦 Procesando nivel: ${lvl.name.toUpperCase()}`);
    console.log(`--------------------------------------------------`);

    const data = extractDataFromJs(lvl.file, lvl.studyVar, lvl.quizVar);
    if (!data) continue;

    const { studyData, quizQuestions } = data;

    // A. Preparar filas para la tabla study_questions
    const studyRows = [];
    studyData.forEach(cat => {
      cat.questions.forEach(q => {
        studyRows.push({
          level: lvl.name,
          category: cat.category,
          question: q.q,
          answer: q.a
        });
      });
    });

    // B. Preparar filas para la tabla quiz_questions
    const quizRows = quizQuestions.map(q => ({
      level: lvl.name,
      question: q.q,
      options: q.options,
      correct_index: q.correctIndex,
      explanation: q.explanation
    }));

    try {
      // C. Limpiar registros previos de este nivel en Supabase (para evitar duplicados)
      console.log(`🧹 Eliminando registros previos de '${lvl.name}'...`);
      await supabaseRequest('study_questions', 'DELETE', null, `?level=eq.${lvl.name}`);
      await supabaseRequest('quiz_questions', 'DELETE', null, `?level=eq.${lvl.name}`);

      // D. Insertar nuevas preguntas de estudio en bloque (bulk insert)
      if (studyRows.length > 0) {
        console.log(`📤 Subiendo ${studyRows.length} preguntas de estudio...`);
        await supabaseRequest('study_questions', 'POST', studyRows);
        console.log(`✅ Preguntas de estudio subidas exitosamente.`);
      }

      // E. Insertar preguntas de quiz en bloque
      if (quizRows.length > 0) {
        console.log(`📤 Subiendo ${quizRows.length} preguntas de cuestionario...`);
        await supabaseRequest('quiz_questions', 'POST', quizRows);
        console.log(`✅ Cuestionario subido exitosamente.`);
      }

    } catch (error) {
      console.error(`❌ Error durante la migración del nivel ${lvl.name}:`, error.message);
    }
    console.log('');
  }

  console.log('🎉 ¡Proceso de migración terminado!');
}

runMigration();
