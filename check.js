// Simple check
const fs = require('fs');
const path = require('path');
const layoutsDir = path.join(__dirname, 'uploads', 'layouts');
console.log('Layouts dir exists:', fs.existsSync(layoutsDir));
if (fs.existsSync(layoutsDir)) {
  const files = fs.readdirSync(layoutsDir);
  console.log('Files in layouts:', files);
}