const path = require('path');
const fs = require('fs');
const { generarSVGLayout } = require('./controllers/layoutsController');

const prompts = {
  aula: 'distribución de aula para 50 personas en un salón de conferencias',
  patio: 'layout de patio exterior para 50 personas, evento al aire libre en el patio',
  circular: 'mesas redondas circulares para 50 personas banquete'
};

const dir = path.join(__dirname, 'uploads', 'layouts');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

for (const [estilo, prompt] of Object.entries(prompts)) {
  const svg = '<?xml version="1.0" encoding="UTF-8"?>' + generarSVGLayout(prompt);
  const file = `${estilo}-50.svg`;
  fs.writeFileSync(path.join(dir, file), svg);
  console.log('✅', file, svg.length, 'bytes');
}