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
            console.log('Getting stream from YouTube:', videoUrl);
            const yt_info = await play.video_info(videoUrl);
            const stream = await play.stream_from_info(yt_info, {
                quality: 2,
                discordPlayerCompatibility: true
            });

            // Get video duration in seconds
            const duration = yt_info.video_details.durationInSec;
            console.log('Video duration:', duration, 'seconds');

            console.log('Starting FFmpeg conversion');
            let startTime = Date.now();
            let lastProgress = 0;

            const ffmpegProcess = ffmpeg(stream.stream)
                .audioBitrate(96)
                .toFormat('mp3')
                .on('start', () => {
                    console.log('FFmpeg started processing');
                    progressCallback(0);
                })
                .on('progress', (progress) => {
                    // Calculate progress based on timestamp
                    if (progress.timemark) {
                        const time = progress.timemark.split(':');
                        const seconds = (+time[0]) * 60 * 60 + (+time[1]) * 60 + (+time[2]);
                        const percent = Math.min(Math.round((seconds / duration) * 100), 100);
                        
                        // Only update if progress has changed
                        if (percent !== lastProgress) {
                            console.log(`Processing: ${percent}% done (${progress.timemark} / ${duration}s)`);
                            progressCallback(percent);
                            lastProgress = percent;
                        }
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
                    progressCallback(100);
                    
                    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
                        console.log('File successfully saved:', outputPath);
                        resolve(outputPath);
                    } else {
                        reject(new Error('File was not created successfully'));
                    }
                })
                .save(outputPath);

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