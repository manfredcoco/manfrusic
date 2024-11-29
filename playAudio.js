require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { 
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    NoSubscriberBehavior,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    entersState,
    getVoiceConnection
} = require('@discordjs/voice');
const { join } = require('path');
const fs = require('fs');
const Fuse = require('fuse.js');

if (!process.env.BOT_TOKEN) {
    console.error('BOT_TOKEN is not set in environment variables');
    process.exit(1);
}

const SERVER_ID = '904546782426570792';
const VOICE_CHANNEL_ID = '1311869888498765884';
const MUSIC_DIR = join(__dirname, 'music');
let currentVolume = 1;
let currentPlayer = null;
let playlist = [];
let fuseSearch;
let lastSearchResults = [];
let isConnected = false; // Track connection state
let isSkipping = false;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessages
    ]
});

function stopCurrentPlayback() {
    if (currentPlayer) {
        currentPlayer.stop();
        currentPlayer = null;
    }
}

async function setupVoiceConnection() {
    if (isConnected) {
        console.log('Already connected, stopping current playback');
        stopCurrentPlayback();
        return getVoiceConnection(SERVER_ID);
    }

    // Destroy any existing connections
    const existingConnection = getVoiceConnection(SERVER_ID);
    if (existingConnection) {
        existingConnection.destroy();
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    const connection = joinVoiceChannel({
        channelId: VOICE_CHANNEL_ID,
        guildId: SERVER_ID,
        adapterCreator: client.guilds.cache.get(SERVER_ID).voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false
    });

    try {
        await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
        isConnected = true;
        return connection;
    } catch (error) {
        connection.destroy();
        isConnected = false;
        throw error;
    }
}

function initializeSearch() {
    // Create searchable items with both filename and cleaned name
    const searchItems = playlist.map(filename => ({
        filename,
        cleanName: filename
            .replace('.mp3', '')
            .replace(/_/g, ' ')
            .replace(/-/g, ' - ')
    }));

    // Configure Fuse.js options
    const options = {
        keys: ['filename', 'cleanName'],
        includeScore: true,
        threshold: 0.4,
        minMatchCharLength: 2
    };

    // Initialize with empty array if no items
    fuseSearch = new Fuse(searchItems.length > 0 ? searchItems : [{ filename: '', cleanName: '' }], options);
}

function loadPlaylist() {
    // Create music directory if it doesn't exist
    if (!fs.existsSync(MUSIC_DIR)) {
        fs.mkdirSync(MUSIC_DIR);
    }

    playlist = fs.readdirSync(MUSIC_DIR)
        .filter(file => file.endsWith('.mp3'));
    
    // Initialize fuseSearch even with empty playlist
    initializeSearch();
}

function shufflePlaylist() {
    for (let i = playlist.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [playlist[i], playlist[j]] = [playlist[j], playlist[i]];
    }
}

async function startPlayback(initialConnection = null, message = null) {
    try {
        if (currentPlayer) {
            currentPlayer.removeAllListeners();
            if (!isSkipping) {
                currentPlayer.stop();
            }
            currentPlayer = null;
        }

        const player = createAudioPlayer({
            behaviors: {
                noSubscriber: NoSubscriberBehavior.Play,
                maxMissedFrames: 200
            }
        });
        currentPlayer = player;

        const connection = initialConnection || await setupVoiceConnection();

        // Get random song from playlist
        if (playlist.length === 0) {
            loadPlaylist();
            if (playlist.length === 0) {
                console.log('No MP3 files found in music directory');
                if (message) {
                    message.reply('No songs available. Please add some MP3 files first.');
                }
                return;
            }
        }
        const songPath = join(MUSIC_DIR, playlist[0]);
        playlist.push(playlist.shift()); // Move first song to end

        const resource = createAudioResource(songPath, {
            inlineVolume: true,
            inputType: 'mp3',
            silencePaddingFrames: 5,
            highWaterMark: 1024 * 1024 * 50
        });
        
        resource.volume?.setVolume(currentVolume);
        connection.subscribe(player);

        // Remove existing listeners before adding new ones
        connection.removeAllListeners(VoiceConnectionStatus.Disconnected);
        
        // Handle connection state changes
        connection.on(VoiceConnectionStatus.Disconnected, async () => {
            try {
                await Promise.race([
                    entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                    entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                ]);
            } catch (error) {
                connection.destroy();
                isConnected = false;
                stopCurrentPlayback();
            }
        });

        // Remove any existing listeners before adding new ones
        player.removeAllListeners();

        player.on(AudioPlayerStatus.Playing, () => {
            console.log('Audio playback started');
        });

        player.on(AudioPlayerStatus.Idle, () => {
            console.log('Song finished, playing next song');
            if (!isSkipping) {
                setTimeout(() => {
                    startPlayback(connection, message).catch(console.error);
                }, 1000);
            }
        });

        player.on('error', error => {
            console.error('Player error:', error);
            player.play(resource);
        });

        player.play(resource);

    } catch (error) {
        console.error('Setup error:', error);
        isConnected = false;
        cleanup();
    }
}

function cleanup() {
    stopCurrentPlayback();
    const connection = getVoiceConnection(SERVER_ID);
    if (connection) {
        connection.destroy();
    }
    isConnected = false;
    client.destroy();
    process.exit(0);
}

// Handle process termination
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Handle unhandled errors
process.on('unhandledRejection', (error) => {
    console.error('Unhandled rejection:', error);
    cleanup();
});

client.once('ready', () => {
    console.log('Bot is ready');
    loadPlaylist(); // Load the playlist on startup
});

// Connect with retry logic
async function connectWithRetry(attempts = 3) {
    for (let i = 0; i < attempts; i++) {
        try {
            await client.login(process.env.BOT_TOKEN);
            return;
        } catch (error) {
            if (i === attempts - 1) throw error;
            console.log(`Login attempt ${i + 1} failed, retrying in 5 seconds...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

connectWithRetry().catch(error => {
    console.error('Failed to connect after multiple attempts:', error);
    process.exit(1);
});

// Add command handling
client.on('messageCreate', async (message) => {
    if (!message.content.startsWith('!')) return;

    const command = message.content.toLowerCase().split(' ')[0];
    const args = message.content.split(' ').slice(1);

    switch (command) {
        case '!volume':
            const newVolume = parseFloat(args[0]);
            if (isNaN(newVolume) || newVolume < 0 || newVolume > 2) {
                message.reply('Please provide a valid volume between 0 and 2');
                return;
            }
            currentVolume = newVolume;
            if (currentPlayer) {
                currentPlayer.state.resource.volume?.setVolume(currentVolume);
                message.reply(`Volume set to ${currentVolume}`);
            }
            break;

        case '!connect':
            if (isConnected) {
                message.reply('Already connected! Use !disconnect first if you want to reconnect.');
                return;
            }
            try {
                console.log('Attempting to connect...');
                const connection = await setupVoiceConnection();
                console.log('Connection established');
                loadPlaylist();
                await startPlayback(connection, message);
                message.reply('Connected and started playlist!');
            } catch (error) {
                console.error('Connect error:', error);
                message.reply('Failed to connect to voice channel');
                isConnected = false;
            }
            break;

        case '!disconnect':
            stopCurrentPlayback();
            const connection = getVoiceConnection(SERVER_ID);
            if (connection) {
                connection.destroy();
                isConnected = false;
                message.reply('Disconnected from voice channel!');
            } else {
                message.reply('Not currently connected to any voice channel!');
            }
            break;

        case '!skip':
            if (!isConnected || !currentPlayer) {
                message.reply('Nothing is currently playing!');
                return;
            }
            try {
                const connection = getVoiceConnection(SERVER_ID);
                if (!connection) {
                    message.reply('No active connection found!');
                    return;
                }
                isSkipping = true;
                currentPlayer.stop();
                await startPlayback(connection, message);
                message.reply('Skipped to next song!');
            } catch (error) {
                console.error('Skip error:', error);
                message.reply('Failed to skip song');
            } finally {
                isSkipping = false;
            }
            break;

        case '!search':
            if (args.length === 0) {
                message.reply('Please provide a search term');
                return;
            }
            
            if (playlist.length === 0) {
                message.reply('No songs available. Please add some MP3 files first.');
                return;
            }
            
            const searchTerm = args.join(' ');
            const results = fuseSearch.search(searchTerm);
            
            if (results.length === 0) {
                message.reply('No matches found');
                return;
            }

            // Store the results for later use
            lastSearchResults = results;

            // Get top 5 results
            const topResults = results.slice(0, 5).map((result, index) => 
                `${index + 1}. ${result.item.cleanName} (Match: ${Math.round((1 - result.score) * 100)}%)`
            );

            message.reply(`Top matches:\n${topResults.join('\n')}\n\nUse !play <number> to play a song`);
            break;

        case '!play':
            if (args.length === 0) {
                message.reply('Please provide a number from the search results');
                return;
            }

            const selection = parseInt(args[0]) - 1;
            
            if (isNaN(selection) || selection < 0 || selection >= lastSearchResults.length) {
                message.reply('Invalid selection. Please search first using !search');
                return;
            }

            const selectedSong = lastSearchResults[selection].item.filename;
            let voiceConnection = getVoiceConnection(SERVER_ID);
            if (!voiceConnection) {
                voiceConnection = await setupVoiceConnection();
            }
            
            if (await playSpecificSong(selectedSong, voiceConnection)) {
                message.reply(`Now playing: ${lastSearchResults[selection].item.cleanName}`);
            } else {
                message.reply('Failed to play the selected song');
            }
            break;
    }
});

async function playSpecificSong(songFilename, connection = null) {
    try {
        if (!connection) {
            connection = await setupVoiceConnection();
        }

        const player = createAudioPlayer({
            behaviors: {
                noSubscriber: NoSubscriberBehavior.Play,
                maxMissedFrames: 200
            }
        });
        currentPlayer = player;

        const songPath = join(MUSIC_DIR, songFilename);
        const resource = createAudioResource(songPath, {
            inlineVolume: true,
            inputType: 'mp3',
            silencePaddingFrames: 5,
            highWaterMark: 1024 * 1024 * 50
        });
        
        resource.volume?.setVolume(currentVolume);
        connection.subscribe(player);

        // Add the same event handlers as in startPlayback()
        connection.on(VoiceConnectionStatus.Disconnected, async () => {
            try {
                await Promise.race([
                    entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                    entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                ]);
            } catch (error) {
                connection.destroy();
                startPlayback(connection).catch(console.error);
            }
        });

        player.on(AudioPlayerStatus.Playing, () => {
            console.log('Audio playback started');
        });

        player.on(AudioPlayerStatus.Idle, () => {
            console.log('Song finished, playing next song');
            startPlayback(connection).catch(console.error);
        });

        player.on('error', error => {
            console.error('Player error:', error);
            player.play(resource);
        });

        player.play(resource);
        return true;

    } catch (error) {
        console.error('Playback error:', error);
        return false;
    }
} 