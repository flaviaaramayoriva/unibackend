// DEFINTIVE TEST: Check if layout IA creates physical files
const fs = require('fs');
const path = require('path');

// Usar la ruta exacta del controlador
const CONTROLADOR_DIR = 'C:\\\\Users\\\\flavi\\\\OneDrive\\\\Escritorio\\\\presen\\\\proyectoFin\\\\uniBackend';
const layoutsDir = path.join(__dirname, '..', 'uploads', 'layouts');

console.log('=== TEST DEFINITIVO DE GUARDADO DE ARCHIVOS ===');
console.log('1. Directorio layoutsDir:', layoutsDir);
console.log('   Existe:', fs.existsSync(layoutsDir));

if (!fs.existsSync(layoutsDir)) {
  console.log('   => Creando carpeta...');
  fs.mkdirSync(layoutsDir, { recursive: true });
  console.log('   => Carpeta creada');
}

console.log('2. Simulando generador SVG...');
const svgCode = '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"500\" height=\"400\"><rect/></svg>';

console.log('3. Construyendo filepath como hace el controlador...');
const filename = 'layout.svg';
const uniqueSuffix = '1789589787314-432582545';
const filePath = path.join(layoutsDir, uniqueSuffix + '-' + filename);

console.log('   filePath:', filePath);
console.log('   Existe antes:', fs.existsSync(filePath));

console.log('4. Intentando escribir archivo (como hace el controlador)...');
try {
  const svgContent = '<?xml version=\"1.0\" encoding=\"UTF-8\"?>' + svgCode;
  console.log('   Content length:', svgContent.length, 'bytes');
  fs.writeFileSync(filePath, svgContent);
  console.log('   => ESCRITURA EXITOSA');
  console.log('   => Archivo existe:', fs.existsSync(filePath));
  
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    console.log('   => Contenido leído OK, length:', content.length);
    console.log('   => Empieza con:', content.substring(0, 30));
  }
} catch (err) {
  console.log('   => ESCRITURA FALLÓ:');
  console.log('   => Error:', err.message);
}

console.log('5. Limpiando archivo de prueba...');
try {
  fs.unlinkSync(filePath);
  console.log('   => Archivo de prueba eliminado');
} catch(e) {
  console.log('   => Error limpiando:', e.message);
}

console.log('=== TEST COMPLETADO ===');