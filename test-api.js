// Test script to create layout IA
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
    console.log('========== RESULT ========');
    console.log('Status:', res.statusCode);
    console.log('Response:', body);
    
    if (res.statusCode === 201) {
      const layout = JSON.parse(body);
      console.log('\n--- Layout Data ---');
      console.log('url_imagen:', layout.layout.url_imagen);
      console.log('imagenUrl:', layout.layout.imagenUrl);
      
      // Verify file exists
      const fs = require('fs');
      const path = require('path');
      const filePath = path.join('C:\\\\Users\\\\flavi\\\\OneDrive\\\\Escritorio\\\\presen\\\\proyectoFin\\\\uniBackend\\\\uploads', 'layouts', layout.layout.url_imagen);
      console.log('\n--- File Check ---');
      console.log('Full file path:', filePath);
      console.log('File exists:', fs.existsSync(filePath));
      
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        console.log('File size:', content.length, 'bytes');
        console.log('Content starts with:', content.substring(0, 50));
        
        // Test: try to fetch this URL
        console.log('\n--- URL Test ---');
        const http = require('http');
        const urlOptions = {
          hostname: 'localhost',
          port: 8081,
          path: '/uploads/' + layout.layout.url_imagen,
          method: 'GET'
        };
        const urlReq = http.request(urlOptions, (urlRes) => {
          let urlBody = '';
          urlRes.on('data', (chunk) => { urlBody += chunk; });
          urlRes.on('end', () => {
            console.log('URL Status:', urlRes.statusCode);
            console.log('URL Content-Type:', urlRes.headers['content-type']);
            console.log('URL Body length:', urlBody.length);
            if (urlBody.length > 0) {
              console.log('URL Content preview:', urlBody.substring(0, 100));
            }
          });
        });
        urlReq.end();
      }
    }
  });
});

req.write(data);
req.end();