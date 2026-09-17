// Test exact path from layoutsController.js
const fs = require('fs');
const path = require('path');

// Simular __dirname como en el controlador
const CONTROLADOR_DIR = 'C:\\Users\\flavi\\OneDrive\\Escritorio\\presen\\proyectoFin\\uniBackend';
console.log('__dirname:', __dirname);

const layoutsDir = path.join(__dirname, '..', 'uploads', 'layouts');
console.log('layoutsDir computed:', layoutsDir);
console.log('Exists:', fs.existsSync(layoutsDir));

if (!fs.existsSync(layoutsDir)) {
  fs.mkdirSync(layoutsDir, { recursive: true });
  console.log('Directory created');
}

const filename = 'layout.svg';
const uniqueSuffix = '1789589787314-432582545';
const filePath = path.join(layoutsDir, uniqueSuffix + '-' + filename);
console.log('filePath:', filePath);
console.log('File exists before write:', fs.existsSync(filePath));

// Write the file
try {
  const svgContent = '<?xml version="1.0" encoding="UTF-8"?><svg/> </svg>';
  fs.writeFileSync(filePath, svgContent);
  console.log('Write SUCCESS - file created');
  console.log('File exists after write:', fs.existsSync(filePath));
  
  // Read back
  const content = fs.readFileSync(filePath, 'utf8');
  console.log('Content read OK:', content.includes('svg'));
  
  // Clean up
  fs.unlinkSync(filePath);
  console.log('Test file cleaned up');
} catch (err) {
  console.error('ERROR writing file:', err.message);
}