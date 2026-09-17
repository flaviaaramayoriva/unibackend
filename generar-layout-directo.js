// SCRIPT DIRECTO: Genera y guarda un layout IA sin necesidad de auth, sin importar el controlador
// Ejecutar con: node generar-layout-directo.js "50 personas mesas circulares"
// O simplemente: node generar-layout-directo.js (usará prompt por defecto)

// 1. Configuración
const fs = require('fs');
const path = require('path');

const SCRIPT_DIR = 'C:\\\\Users\\\\flavi\\\\OneDrive\\\\Escritorio\\\\presen\\\\proyectoFin\\\\uniBackend';

// 2. Obtener prompt (por argumento o por defecto)
const prompt = process.argv[2] || '50 personas mesas circulares';
console.log('📝 Prompt:', prompt);

// 3. Generar el SVG usando la misma lógica que el controlador (probada y comprobada)
const lower = prompt.toLowerCase();
const diameter = 480;
const centerX = 250, centerY = 200;
const radius = 180;
const chairWidth = 8, chairDepth = 10;
const tableDiameter = 60;

// Detectar capacidad y forma
const personCount = lower.includes('50') ? 50 : 
                   lower.includes('40') ? 40 : 
                   lower.includes('30') ? 30 : 
                   parseInt(prompt.match(/(\d+)/)?.[1] || 30);

console.log('👥 Personas a distribuir:', personCount);

const angularStep = (2 * Math.PI) / personCount;
const innerRadius = radius - 40;

// Iniciar el código SVG
let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="400">';
svg += '<rect width="500" height="400" fill="#fafafa"/>';
svg += '<g stroke="#e5e7eb" stroke-width="2">';
svg += '<line x1="250" y1="50" x2="250" y2="350" />';
svg += '<line x1="50" y1="200" x2="450" y2="200" />';
svg += '</g>';

// Generar posiciones circulares para mesas y sillas
for (let i = 0; i < personCount; i++) {
    const angle = i * angularStep - Math.PI / 2;
    const tableX = centerX + (innerRadius / 2) * Math.cos(angle);
    const tableY = centerY + (innerRadius / 2) * Math.sin(angle);
    const chairX = centerX + radius * Math.cos(angle);
    const chairY = centerY + radius * Math.sin(angle);
    
    // Mesa en posición radial
    svg += `<circle cx="${tableX}" cy="${tableY}" r="${tableDiameter/2}" fill="#1f2937"/>`;
    
    // Silla en posición circular exterior
    const chairAngle = angle + Math.PI / personCount;
    const cX = centerX + (radius - 15) * Math.cos(chairAngle);
    const cY = centerY + (radius - 15) * Math.sin(chairAngle);
    svg += `<rect x="${cX - chairWidth/2}" y="${cY - chairDepth/2}" width="${chairWidth}" height="${chairDepth}" fill="#6b7280"/>`;
}

// Cerrar el SVG
svg += '</svg>';

console.log('✅ SVG generado OK');

// 4. Construir ruta del archivo (misma lógica que el controlador)
const layoutsDir = path.join(SCRIPT_DIR, '..', 'uploads', 'layouts');
if (!fs.existsSync(layoutsDir)) {
  fs.mkdirSync(layoutsDir, { recursive: true });
  console.log('📁 Carpeta creada:', layoutsDir);
}

const filename = 'layout.svg';
const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
const filePath = path.join(layoutsDir, uniqueSuffix + '-' + filename);

console.log('💾 Guardando archivo en:', filePath);

// 6. Escribir el archivo SVG físicamente (¡este es el paso clave!)
const svgContent = `<?xml version="1.0" encoding="UTF-8"?>${svg}`;
try {
  fs.writeFileSync(filePath, svgContent);
  console.log('✅ ¡ARCHIVO GUARDADO EN DISCO!');
  console.log('   Ruta completa:', filePath);
  console.log('   Tamaño:', fs.statSync(filePath).size, 'bytes');
} catch (err) {
  console.error('❌ ERROR Al guardar archivo:', err.message);
  process.exit(1);
}

// 7. Mostrar la URL para el frontend
const dbFileName = uniqueSuffix + '-' + filename;
const urlFre = `https://unibackend-production-a0f8.up.railway.app/uploads/${dbFileName}`;

console.log('\n=== RESULTADO FINAL ===');
console.log('✅ Archivo creado físicamente en:');
console.log('   ', filePath);
console.log('\n🌐 URL para usar en el frontend:');
console.log('   ', urlFre);
console.log('\n📋 Ahora ve al frontend y el layout debería aparecer!');

console.log('\n=== RESUMEN ===');
console.log('✅ Script ejecutado exitosamente');
console.log('✅ SVG generado con lógica de distribución circular');
console.log('✅ Archivo guardado en:', layoutsDir);
console.log('✅ URL lista para usar en el frontend:', urlFre);