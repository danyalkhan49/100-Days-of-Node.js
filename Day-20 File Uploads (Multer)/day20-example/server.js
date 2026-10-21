const express = require('express');
const multer = require('multer');
const path = require('path');

const app = express();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 }
});
app.use('/uploads', express.static('uploads'));

app.post('/upload', upload.single('photo'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'Please upload a file' });
  }

  res.status(201).json({
    success: true,
    message: 'File uploaded',
    filename: req.file.filename,
    size: req.file.size,
    url: `http://localhost:8400/uploads/${req.file.filename}`
  });
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, error: 'File too large. Max 2MB allowed.' });
    }
    return res.status(400).json({ success: false, error: err.message });
  }

  res.status(err.statusCode || 500).json({
    success: false,
    error: err.message || 'Something went wrong'
  });
});

app.listen(8400, () => {
  console.log('Server running on http://localhost:8400');
});