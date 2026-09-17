// Test creating layout IA with SVG generation
const http = require('http');

const data = JSON.stringify({ prompt: '50 personas mesas circulares' });

const options = {
  hostname: 'localhost',
  port: 8081,
  path: '/layouts/ia',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => { body += chunk; });
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response:', body.substring(0, 300));
    
    if (res.statusCode === 201) {
      const layout = JSON.parse(body);
      console.log('url_imagen:', layout.layout.url_imagen);
      console.log('imagenUrl:', layout.layout.imagenUrl);
      
      // Verify file exists
      const fs = require('fs');
      const path = require('path');
      const filePath = path.join('C:\\\\Users\\\\flavi\\\\OneDrive\\\\Escritorio\\\\presen\\\\proyectoFin\\\\uniBackend\\\\uploads', 'layouts', layout.layout.url_imagen);
      console.log('File path:', filePath);
      console.log('File exists:', fs.existsSync(filePath));
      
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        console.log('File content starts with SVG:', content.substring(0, 30));
      }
    }
  });
});

req.write(data);
req.end();