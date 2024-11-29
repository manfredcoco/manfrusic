const play = require('play-dl');
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

async function downloadYoutubeAudio(videoUrl, filename) {
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
            console.log('Getting stream from YouTube:', videoUrl);
            const yt_info = await play.video_info(videoUrl);
            const stream = await play.stream_from_info(yt_info, {
                quality: 2, // Try a lower quality
                discordPlayerCompatibility: true
            });

            console.log('Starting FFmpeg conversion');
            let startTime = Date.now();

            const ffmpegProcess = ffmpeg(stream.stream)
                .audioBitrate(96) // Lower bitrate
                .toFormat('mp3')
                .on('start', () => {
                    console.log('FFmpeg started processing');
                })
                .on('progress', (progress) => {
                    if (progress.percent) {
                        console.log(`Processing: ${Math.round(progress.percent)}% done`);
                    }
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
                    console.log(`Download completed: ${filename} (${duration.toFixed(2)}s)`);
                    
                    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
                        console.log('File successfully saved:', outputPath);
                        resolve(outputPath);
                    } else {
                        reject(new Error('File was not created successfully'));
                    }
                });

            // Set a more generous timeout
            const timeout = setTimeout(() => {
                ffmpegProcess.kill();
                reject(new Error('FFmpeg process timed out'));
            }, 120000); // 2 minutes

            ffmpegProcess
                .save(outputPath)
                .on('end', () => clearTimeout(timeout));

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