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
            
            // Get the audio-only format
            const audioFormat = ytdl.filterFormats(info.formats, 'audioonly')[0];
            if (!audioFormat) {
                throw new Error('No audio format found');
            }

            console.log('Audio format selected:', audioFormat.mimeType);
            
            // Create temporary file for download progress tracking
            const tempFile = path.join(MUSIC_DIR, `${filename}.temp`);
            const writeStream = fs.createWriteStream(tempFile);
            
            let downloadedBytes = 0;
            const totalBytes = parseInt(audioFormat.contentLength);
            console.log('Expected file size:', Math.round(totalBytes/1024/1024), 'MB');

            const stream = ytdl.downloadFromInfo(info, { format: audioFormat })
                .on('data', chunk => {
                    downloadedBytes += chunk.length;
                    const percent = Math.min(Math.round((downloadedBytes / totalBytes) * 100), 100);
                    console.log(`Download: ${percent}% (${Math.round(downloadedBytes/1024/1024)}MB/${Math.round(totalBytes/1024/1024)}MB)`);
                    progressCallback(percent);
                })
                .pipe(writeStream);

            // Wait for download to complete
            await new Promise((resolve, reject) => {
                writeStream.on('finish', resolve);
                writeStream.on('error', reject);
            });

            console.log('Download completed, starting conversion');
            progressCallback(50); // Mark 50% at conversion start

            // Convert the temp file to MP3
            await new Promise((resolve, reject) => {
                ffmpeg(tempFile)
                    .audioCodec('libmp3lame')
                    .audioBitrate('128k')
                    .format('mp3')
                    .on('progress', progress => {
                        if (progress.percent) {
                            const percent = Math.min(50 + Math.round(progress.percent / 2), 100);
                            console.log(`Converting: ${progress.percent}% (Total: ${percent}%)`);
                            progressCallback(percent);
                        }
                    })
                    .on('end', () => {
                        console.log('Conversion completed');
                        // Clean up temp file
                        fs.unlink(tempFile, () => {});
                        resolve();
                    })
                    .on('error', (error) => {
                        console.error('FFmpeg error:', error);
                        reject(error);
                    })
                    .save(outputPath);
            });

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
                    fs.unlinkSync(file);
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