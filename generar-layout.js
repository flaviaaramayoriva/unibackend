// SCRIPT DIRECTO: Genera y guarda un layout IA sin necesidad de auth ni reiniciar servidor
// Ejecutar con: node generar-layout.js "50 personas mesas circulares"

// Obtener el prompt del argumento o usar uno por defecto
const prompt = process.argv[2] || '50 personas mesas circulares';

const fs = require('fs');
const path = require('path');

// __dirname es la carpeta del script (uniBackend)
const SCRIPT_DIR = 'C:\\\\Users\\\\flavi\\\\OneDrive\\\\Escritorio\\\\presen\\\\proyectoFin\\\\uniBackend';

// 1. Importar el módulo completo del controlador
const layoutsController = require('./controllers/layoutsController');

// 2. Acceder a la función generarSVGLayout
// La función está definida al final del archivo layoutsController.js
// Usamos el nombre de la función tal como está definida
if (typeof layoutsController.generarSVGLayout === 'function') {
  console.log('✅ Encontrada función generarSVGLayout en el módulo');
} else {
  console.log('⚠️ Buscando función en la propiedad...');
}

// 3. Generar el código SVG usando la función del controlador
console.log(`🔧 Generando layout IA para: "${prompt}"`);
const svgCode = layoutsController.generarSVGLayout(prompt);

if (!svgCode || !svgCode.startsWith('<svg')) {
  console.error('❌ No se pudo generar el SVG. Prompt:', prompt);
  process.exit(1);
}

console.log('✅ SVG generado exitosamente');
console.log('   Tamaño:', svgCode.length, 'caracteres');

// 4. Construir la ruta del archivo (igual que hace el controlador)
const layoutsDir = path.join(SCRIPT_DIR, '..', 'uploads', 'layouts');
if (!fs.existsSync(layoutsDir)) {
  fs.mkdirSync(layoutsDir, { recursive: true });
  console.log('📁 Carpeta creada:', layoutsDir);
}

// Nombre de archivo único (misma lógica que el controlador)
const filename = 'layout.svg';
const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
const filePath = path.join(layoutsDir, uniqueSuffix + '-' + filename);

console.log('💾 Guardando archivo en:', filePath);

// 5. Escribir el archivo SVG físicamente
const svgContent = `<?xml version="1.0" encoding="UTF-8"?>${svgCode}`;
try {
  fs.writeFileSync(filePath, svgContent);
  console.log('✅ ARCHIVO GUARDADO CORRECTAMENTE');
  console.log('   Tamaño en disco:', fs.statSync(filePath).size, 'bytes');
} catch (err) {
  console.error('❌ ERROR Al guardar archivo:', err.message);
  process.exit(1);
}

// 6. Mostrar la URL para el frontend
const dbFileName = uniqueSuffix + '-' + filename;
const urlImagen = `https://unibackend-production-a0f8.up.railway.app/uploads/${dbFileName}`;

console.log('\n=== RESULTADO ===');
console.log('📄 Archivo guardado:', dbFileName);
console.log('🌐 URL para frontend:', urlImagen);
console.log('📂 Ubicación física:', filePath);
console.log('\n�现在你可以 ir al frontend y el layout should aparecer en blanco ya que el archivo existe');
console.log('   O proverbar directamente en el navegador:', urlImagen);

// 7. Estadísticas finales
console.log('\n=== RESUMEN ===');
console.log('✅ Script completado exitosamente');
console.log('✅ Archivo SVG generado y guardado en disco');
console.log('✅ URL lista para usar en el frontend');