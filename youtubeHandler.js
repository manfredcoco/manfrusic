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
        
        if (fs.existsSync(outputPath)) {
            resolve(outputPath);
            return;
        }

        const stream = ytdl(videoUrl, {
            quality: 'highestaudio',
            filter: 'audioonly',
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': '*/*',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Range': 'bytes=0-'
                }
            }
        });

        stream.on('error', (error) => {
            console.error('YouTube download error:', error);
            reject(error);
        });

        ffmpeg(stream)
            .audioBitrate(128)
            .toFormat('mp3')
            .on('error', (error) => {
                console.error('FFmpeg error:', error);
                reject(error);
            })
            .on('end', () => {
                console.log('Download completed:', filename);
                resolve(outputPath);
            })
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