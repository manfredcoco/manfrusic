const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;
const MUSIC_DIR = path.join(__dirname, 'music');

// Create music directory if it doesn't exist
if (!fs.existsSync(MUSIC_DIR)) {
    fs.mkdirSync(MUSIC_DIR);
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, MUSIC_DIR);
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});

const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype !== 'audio/mpeg') {
            return cb(new Error('Only MP3 files are allowed!'));
        }
        cb(null, true);
    }
});

// Serve static HTML
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'upload.html'));
});

// Handle file uploads
app.post('/upload', upload.single('mp3File'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }
    res.status(200).send('File uploaded successfully!');
});

// Get list of music files
app.get('/files', (req, res) => {
    fs.readdir(MUSIC_DIR, (err, files) => {
        if (err) {
            return res.status(500).send('Error reading music directory');
        }
        const mp3Files = files.filter(file => file.endsWith('.mp3'));
        res.json(mp3Files);
    });
});

// Delete file
app.delete('/files/:filename', (req, res) => {
    const filename = req.params.filename;
    const filepath = path.join(MUSIC_DIR, filename);
    
    if (!filename.endsWith('.mp3')) {
        return res.status(400).send('Invalid file type');
    }

    fs.unlink(filepath, (err) => {
        if (err) {
            return res.status(500).send('Error deleting file');
        }
        res.send('File deleted successfully');
    });
});

app.listen(port, () => {
    console.log(`Web UI available at http://localhost:${port}`);
}); 