// Copia este archivo como "config.js" y rellena con tus credenciales de Supabase si decides usar la base de datos.
// NOTA: "config.js" está excluido de git por motivos de seguridad en ".gitignore".

// SWITCH DE CONFIGURACIÓN DE ORIGEN DE DATOS:
// - true: Consume las preguntas desde la base de datos de Supabase.
// - false (por defecto): Consume las preguntas desde los archivos locales .js.
const USE_DATABASE = false;

const SUPABASE_URL = "https://tu-proyecto.supabase.co";
const SUPABASE_ANON_KEY = "tu_anon_public_key_aqui";

// Inicializar el cliente Supabase (solo si se activa el uso de base de datos)
const supabaseClient = (USE_DATABASE && window.supabase) ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
