const ytdl = require('ytdl-core');
const yts = require('yt-search');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

const MUSIC_DIR = path.join(__dirname, 'music');

function ensureMusicDir() {
    if (!fs.existsSync(MUSIC_DIR)) {
        fs.mkdirSync(MUSIC_DIR, { recursive: true });
    }
}

async function downloadYoutubeAudio(videoUrl, filename, progressCallback) {
    return new Promise(async (resolve, reject) => {
        console.log('Starting download process for:', filename);
        ensureMusicDir();
        
        const outputPath = path.join(MUSIC_DIR, `${filename}.mp3`);
        
        if (fs.existsSync(outputPath)) {
            console.log('File already exists:', outputPath);
            resolve(outputPath);
            return;
        }

        try {
            console.log('Getting video info from YouTube:', videoUrl);
            const info = await ytdl.getInfo(videoUrl);
            const audioFormat = info.formats.find(format => format.mimeType.includes('audio/mp4'));
            
            if (!audioFormat) {
                throw new Error('No suitable audio format found');
            }

            console.log('Starting download with format:', audioFormat.mimeType);
            const stream = ytdl.downloadFromInfo(info, { format: audioFormat });
            
            let totalBytes = parseInt(audioFormat.contentLength);
            let downloadedBytes = 0;

            stream.on('data', chunk => {
                downloadedBytes += chunk.length;
                if (totalBytes) {
                    const percent = Math.round((downloadedBytes / totalBytes) * 100);
                    console.log(`Download: ${percent}% (${Math.round(downloadedBytes/1024/1024)}MB/${Math.round(totalBytes/1024/1024)}MB)`);
                    progressCallback(percent);
                }
            });

            console.log('Starting FFmpeg conversion');
            let startTime = Date.now();

            const ffmpegProcess = ffmpeg(stream)
                .audioCodec('libmp3lame')
                .audioBitrate('128k')
                .format('mp3')
                .on('start', () => {
                    console.log('FFmpeg conversion started');
                })
                .on('progress', progress => {
                    console.log('FFmpeg progress:', progress);
                })
                .on('error', (error) => {
                    console.error('FFmpeg error:', error);
                    if (fs.existsSync(outputPath)) {
                        fs.unlinkSync(outputPath);
                    }
                    reject(error);
                })
                .on('end', () => {
                    const duration = (Date.now() - startTime) / 1000;
                    console.log(`Conversion completed: ${filename} (${duration.toFixed(2)}s)`);
                    
                    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
                        console.log('File successfully saved:', outputPath);
                        resolve(outputPath);
                    } else {
                        reject(new Error('File was not created successfully'));
                    }
                });

            // Pipe to output file
            ffmpegProcess.save(outputPath);

        } catch (error) {
            console.error('Error in download process:', error);
            if (fs.existsSync(outputPath)) {
                fs.unlinkSync(outputPath);
            }
            reject(error);
        }
    });
}

async function searchYoutube(query) {
    try {
        console.log('Searching YouTube for:', query);
        const results = await yts(query);
        const videos = results.videos.slice(0, 10).map(video => ({
            title: video.title,
            url: video.url,
            duration: video.duration.timestamp,
            author: video.author.name
        }));
        console.log(`Found ${videos.length} results`);
        return videos;
    } catch (error) {
        console.error('YouTube search error:', error);
        throw error;
    }
}

module.exports = {
    searchYoutube,
    downloadYoutubeAudio,
    MUSIC_DIR
}; 