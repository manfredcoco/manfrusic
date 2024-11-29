const ytdl = require('ytdl-core');
const yts = require('yt-search');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

let lastSearchResults = [];
const MUSIC_DIR = path.join(__dirname, 'music');

async function searchYoutube(query) {
    try {
        const results = await yts(query);
        return results.videos.slice(0, 10).map(video => ({
            title: video.title,
            url: video.url,
            duration: video.duration.timestamp,
            author: video.author.name
        }));
    } catch (error) {
        console.error('YouTube search error:', error);
        throw error;
    }
}

async function downloadYoutubeAudio(videoUrl, filename) {
    return new Promise((resolve, reject) => {
        const outputPath = path.join(MUSIC_DIR, `${filename}.mp3`);
        
        // Skip if file already exists
        if (fs.existsSync(outputPath)) {
            resolve(outputPath);
            return;
        }

        const stream = ytdl(videoUrl, {
            quality: 'highestaudio',
            filter: 'audioonly'
        });

        ffmpeg(stream)
            .audioBitrate(128)
            .toFormat('mp3')
            .on('end', () => resolve(outputPath))
            .on('error', reject)
            .save(outputPath);
    });
}

function sanitizeFilename(filename) {
    return filename
        .replace(/[^a-z0-9]/gi, '_')
        .toLowerCase()
        .substring(0, 200);
}

module.exports = {
    searchYoutube,
    downloadYoutubeAudio,
    lastSearchResults
}; 