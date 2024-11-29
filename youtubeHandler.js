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
            console.log('Getting video info from YouTube:', videoUrl);
            const yt_info = await play.video_info(videoUrl);
            const stream = await play.stream_from_info(yt_info);
            
            let lastProgress = 0;
            const duration = yt_info.video_details.durationInSec;
            
            console.log('Starting FFmpeg direct stream conversion');
            progressCallback(0);

            ffmpeg(stream.stream)
                .format('mp3')
                .audioCodec('libmp3lame')
                .audioBitrate('192k')
                .on('codecData', data => {
                    console.log('Input codec data:', data);
                })
                .on('progress', progress => {
                    if (progress.timemark) {
                        // Convert timemark to seconds
                        const parts = progress.timemark.split(':');
                        const seconds = parseInt(parts[0]) * 3600 + 
                                     parseInt(parts[1]) * 60 + 
                                     parseFloat(parts[2]);
                        
                        // Calculate percentage
                        const percent = Math.min(Math.round((seconds / duration) * 100), 100);
                        
                        if (percent !== lastProgress) {
                            console.log(`Progress: ${percent}% (${progress.timemark} / ${duration}s)`);
                            progressCallback(percent);
                            lastProgress = percent;
                        }
                    }
                })
                .on('end', () => {
                    console.log('Processing finished');
                    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
                        console.log('File successfully saved:', outputPath);
                        progressCallback(100);
                        resolve(outputPath);
                    } else {
                        reject(new Error('Output file is empty or missing'));
                    }
                })
                .on('error', (err) => {
                    console.error('FFmpeg error:', err);
                    reject(err);
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