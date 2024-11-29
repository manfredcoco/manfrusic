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
        const tempFile = path.join(MUSIC_DIR, `${filename}.temp`);
        
        if (fs.existsSync(outputPath)) {
            console.log('File already exists:', outputPath);
            resolve(outputPath);
            return;
        }

        try {
            console.log('Getting video info from YouTube:', videoUrl);
            const yt_info = await play.video_info(videoUrl);
            const stream = await play.stream_from_info(yt_info, {
                quality: 2, // lower quality for faster download
                discordPlayerCompatibility: true
            });

            // Get video duration for progress calculation
            const duration = yt_info.video_details.durationInSec;
            console.log('Video duration:', duration, 'seconds');

            console.log('Starting download...');
            progressCallback(0);
            
            // First download to temp file
            const writeStream = fs.createWriteStream(tempFile);
            let downloadedSize = 0;
            
            stream.stream
                .on('data', chunk => {
                    downloadedSize += chunk.length;
                    // Estimate progress based on typical audio bitrate
                    const estimatedTotal = duration * 128 * 1024 / 8; // Assuming 128kbps
                    const percent = Math.min(Math.round((downloadedSize / estimatedTotal) * 50), 50);
                    console.log(`Download progress: ${percent}% (${Math.round(downloadedSize/1024/1024)}MB)`);
                    progressCallback(percent);
                })
                .pipe(writeStream);

            // Wait for download to complete
            await new Promise((resolve, reject) => {
                writeStream.on('finish', resolve);
                writeStream.on('error', (error) => {
                    console.error('Write stream error:', error);
                    reject(error);
                });
            });

            console.log('Download completed, starting conversion');
            progressCallback(50);

            // Convert to MP3
            await new Promise((resolve, reject) => {
                ffmpeg(tempFile)
                    .toFormat('mp3')
                    .audioCodec('libmp3lame')
                    .audioBitrate('192k')
                    .on('progress', (progress) => {
                        if (progress.percent) {
                            const percent = Math.min(50 + Math.round(progress.percent / 2), 100);
                            console.log(`Converting: ${progress.percent}% (Total: ${percent}%)`);
                            progressCallback(percent);
                        }
                    })
                    .on('end', () => {
                        console.log('Conversion completed');
                        resolve();
                    })
                    .on('error', (error) => {
                        console.error('Conversion error:', error);
                        reject(error);
                    })
                    .save(outputPath);
            });

            // Clean up temp file
            try {
                fs.unlinkSync(tempFile);
            } catch (error) {
                console.error('Failed to delete temp file:', error);
            }

            if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
                console.log('File successfully saved:', outputPath);
                progressCallback(100);
                resolve(outputPath);
            } else {
                throw new Error('File was not created successfully');
            }

        } catch (error) {
            console.error('Error in download process:', error);
            // Clean up any partial files
            [outputPath, tempFile].forEach(file => {
                if (fs.existsSync(file)) {
                    try {
                        fs.unlinkSync(file);
                    } catch (e) {
                        console.error('Failed to delete file:', file, e);
                    }
                }
            });
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