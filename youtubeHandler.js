const play = require('play-dl');
const yts = require('yt-search');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

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
    return new Promise(async (resolve, reject) => {
        const outputPath = path.join(MUSIC_DIR, `${filename}.mp3`);
        
        if (fs.existsSync(outputPath)) {
            resolve(outputPath);
            return;
        }

        try {
            const stream = await play.stream(videoUrl, { 
                discordPlayerCompatibility: true 
            });

            ffmpeg(stream.stream)
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

        } catch (error) {
            console.error('Error downloading video:', error);
            reject(error);
        }
    });
}

module.exports = {
    searchYoutube,
    downloadYoutubeAudio
}; 